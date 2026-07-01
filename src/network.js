// Network layer — host-authoritative, adapted from p0
// Star topology: host holds state, guests send action requests.

import Peer from 'peerjs';

const PEER_ID_PREFIX = 'ds-';

/**
 * Create a host network session.
 * @param {string} sessionKey
 * @param {Object} callbacks
 * @param {Object} hostInfo - { name }
 * @returns {Object}
 */
export function createHost(sessionKey, callbacks, hostInfo) {
  const peerId = PEER_ID_PREFIX + sessionKey;
  const peer = new Peer(peerId);
  const connections = new Map(); // peerId -> { conn, playerInfo, playerToken }

  peer.on('open', () => callbacks.onReady?.());

  peer.on('connection', conn => {
    conn.on('open', () => {
      // Wait for join message
    });

    conn.on('data', data => {
      if (data.type === 'join') {
        // Check for reconnection
        let existingPeerId = null;
        if (data.playerToken) {
          for (const [id, info] of connections) {
            if (info.playerToken === data.playerToken && info.disconnected) {
              existingPeerId = id;
              break;
            }
          }
        }

        if (existingPeerId) {
          // Reconnection
          const old = connections.get(existingPeerId);
          connections.delete(existingPeerId);
          connections.set(conn.peer, { conn, playerInfo: data.playerInfo, playerToken: data.playerToken, disconnected: false });
          callbacks.onPlayerReconnect?.(conn.peer, existingPeerId, data.playerInfo);
        } else {
          // New player
          connections.set(conn.peer, { conn, playerInfo: data.playerInfo, playerToken: data.playerToken, disconnected: false });
          callbacks.onPlayerJoin?.(conn.peer, data.playerInfo);
        }
      } else if (data.type === 'action') {
        callbacks.onAction?.(conn.peer, data.action);
      }
    });

    conn.on('close', () => {
      const info = connections.get(conn.peer);
      if (info) {
        info.disconnected = true;
        info.disconnectedAt = Date.now();
        callbacks.onPlayerDisconnect?.(conn.peer);
      }
    });
  });

  peer.on('error', err => callbacks.onError?.(err));

  return {
    getLocalId() { return peer.id; },

    /** Send state update to a specific player */
    sendToPlayer(peerId, message) {
      const info = connections.get(peerId);
      if (info?.conn && !info.disconnected) {
        info.conn.send(message);
      }
    },

    /** Broadcast a message to all connected players */
    broadcast(message) {
      for (const { conn, disconnected } of connections.values()) {
        if (!disconnected) conn.send(message);
      }
    },

    /** Broadcast player list */
    broadcastPlayers(players) {
      this.broadcast({ type: 'players', players });
    },

    /** Signal game start */
    startGame(initData) {
      this.broadcast({ type: 'start', ...initData });
    },

    /** Get connected (non-disconnected) player count */
    getPlayerCount() {
      let count = 1; // host
      for (const { disconnected } of connections.values()) {
        if (!disconnected) count++;
      }
      return count;
    },

    /** Get all player peer IDs (including disconnected) */
    getAllPlayerIds() {
      return ['host', ...connections.keys()];
    },

    /** Clean up stale disconnected players (older than timeout) */
    cleanDisconnected(timeoutMs = 60000) {
      const now = Date.now();
      for (const [id, info] of connections) {
        if (info.disconnected && now - info.disconnectedAt > timeoutMs) {
          connections.delete(id);
          callbacks.onPlayerLeave?.(id);
        }
      }
    },

    destroy() { peer.destroy(); },
  };
}

/**
 * Join an existing host session with auto-reconnect support.
 * @param {string} sessionKey
 * @param {Object} playerInfo - { name }
 * @param {string} playerToken - Persistent token for reconnection
 * @param {Object} callbacks
 * @returns {Object}
 */
export function joinSession(sessionKey, playerInfo, playerToken, callbacks) {
  let peer = null;
  let conn = null;
  let destroyed = false;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 10;
  const RECONNECT_BASE_DELAY = 1000; // ms, doubles each attempt

  function connect() {
    if (destroyed) return;

    const peerId = PEER_ID_PREFIX + sessionKey + '-' + Math.random().toString(36).slice(2, 8);
    peer = new Peer(peerId);

    peer.on('open', () => {
      conn = peer.connect(PEER_ID_PREFIX + sessionKey, { reliable: true });

      conn.on('open', () => {
        reconnectAttempts = 0;
        conn.send({ type: 'join', playerInfo, playerToken });
        callbacks.onReady?.();
      });

      conn.on('data', data => {
        if (data.type === 'players') {
          callbacks.onPlayerList?.(data.players);
        } else if (data.type === 'start') {
          callbacks.onGameStart?.(data);
        } else if (data.type === 'state') {
          callbacks.onFullState?.(data);
        } else if (data.type === 'delta') {
          callbacks.onDelta?.(data);
        } else if (data.type === 'error') {
          callbacks.onError?.(new Error(data.message));
        }
      });

      conn.on('close', () => {
        conn = null;
        if (!destroyed) {
          callbacks.onDisconnect?.();
          scheduleReconnect();
        }
      });
    });

    peer.on('error', err => {
      if (destroyed) return;
      if (err.type === 'peer-unavailable' || err.type === 'network' || err.type === 'disconnected') {
        scheduleReconnect();
      } else {
        callbacks.onError?.(err);
      }
    });

    peer.on('disconnected', () => {
      if (!destroyed) scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    if (destroyed || reconnectTimer) return;
    reconnectAttempts++;

    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      callbacks.onError?.(new Error('Unable to reconnect after multiple attempts'));
      return;
    }

    const delay = RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1);
    callbacks.onReconnecting?.(reconnectAttempts, MAX_RECONNECT_ATTEMPTS);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      // Destroy old peer and create fresh connection
      if (peer) { try { peer.destroy(); } catch {} }
      peer = null;
      conn = null;
      connect();
    }, Math.min(delay, 30000));
  }

  connect();

  return {
    getLocalId() { return peer?.id; },

    /** Send an action request to the host */
    sendAction(action) {
      if (conn) conn.send({ type: 'action', action });
    },

    destroy() {
      destroyed = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (peer) { try { peer.destroy(); } catch {} }
      peer = null;
      conn = null;
    },
  };
}

/**
 * Get or create a persistent player token for reconnection.
 * Stored in sessionStorage so it persists across page refreshes in the same tab.
 * @returns {string}
 */
export function getPlayerToken() {
  let token = sessionStorage.getItem('deckspace-player-token');
  if (!token) {
    token = crypto.randomUUID();
    sessionStorage.setItem('deckspace-player-token', token);
  }
  return token;
}
