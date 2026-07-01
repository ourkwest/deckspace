// Screen navigation / state machine
// Manages transitions between lobby screens and the game.

import { splashScreen, hostSetupScreen, joinScreen, sessionScreen, loadingScreen, errorScreen, renderSessionQR } from './screens.js';
import { generateSessionId, sessionIdToString, sessionIdToKey } from './session-id.js';
import { createHost, joinSession, getPlayerToken } from './network.js';
import { loadSetup } from './loader.js';

const RECENT_URLS_KEY = 'deckspace-recent-urls';
const MAX_RECENT = 5;

export function createNavigation(uiContainer, gameContainer, onGameStart) {
  let currentScreen = 'splash';
  let state = {
    name: '',
    setupUrl: '',
    adj1: '', adj2: '', animal: '',
    error: '',
  };
  let sessionState = { sessionId: null, sessionKey: null, players: [], isHost: false, setupName: '', playerRange: '' };
  let network = null;
  let loadedSetup = null;

  function show(screen) {
    currentScreen = screen;
    gameContainer.style.display = screen === 'game' ? 'block' : 'none';
    uiContainer.style.display = screen === 'game' ? 'none' : 'flex';
    if (screen !== 'game') renderScreen();
  }

  function renderScreen() {
    let html = '';
    if (currentScreen === 'splash') html = splashScreen();
    else if (currentScreen === 'host-setup') html = hostSetupScreen({ ...state, recentUrls: getRecentUrls() });
    else if (currentScreen === 'join') html = joinScreen(state);
    else if (currentScreen === 'session') html = sessionScreen(sessionState);
    else if (currentScreen === 'loading') html = loadingScreen(state.loadingMessage || 'Loading...');
    else if (currentScreen === 'error') html = errorScreen(state.error);
    uiContainer.innerHTML = html;
    bindEvents();
    if (currentScreen === 'session') renderSessionQR(uiContainer, sessionState.sessionKey);
  }

  function bindEvents() {
    uiContainer.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => handleAction(btn.dataset.action));
    });

    const nameInput = uiContainer.querySelector('#player-name');
    if (nameInput) nameInput.addEventListener('input', e => { state.name = e.target.value.trim(); updateButtons(); });

    const urlInput = uiContainer.querySelector('#setup-url');
    if (urlInput) urlInput.addEventListener('input', e => { state.setupUrl = e.target.value.trim(); state.error = ''; updateButtons(); });

    // Recent URL links
    uiContainer.querySelectorAll('[data-url]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        state.setupUrl = a.dataset.url;
        const input = uiContainer.querySelector('#setup-url');
        if (input) input.value = state.setupUrl;
        state.error = '';
        updateButtons();
      });
    });

    // Session ID selects
    ['sel-adj1', 'sel-adj2', 'sel-animal'].forEach(id => {
      const el = uiContainer.querySelector('#' + id);
      if (el) el.addEventListener('change', () => {
        state.adj1 = uiContainer.querySelector('#sel-adj1')?.value || '';
        state.adj2 = uiContainer.querySelector('#sel-adj2')?.value || '';
        state.animal = uiContainer.querySelector('#sel-animal')?.value || '';
        updateButtons();
      });
    });
  }

  function updateButtons() {
    const hostBtn = uiContainer.querySelector('[data-action="start-host"]');
    if (hostBtn) hostBtn.disabled = !state.name || !state.setupUrl;

    const joinBtn = uiContainer.querySelector('[data-action="join-session"]');
    if (joinBtn) joinBtn.disabled = !state.name || !state.adj1 || !state.adj2 || !state.animal;
  }

  function handleAction(action) {
    if (action === 'host') show('host-setup');
    else if (action === 'join') show('join');
    else if (action === 'back') { destroyNetwork(); show('splash'); }
    else if (action === 'start-host') startHost();
    else if (action === 'join-session') joinGame();
    else if (action === 'play') startPlay();
  }

  async function startHost() {
    state.loadingMessage = 'Loading setup file...';
    show('loading');

    try {
      loadedSetup = await loadSetup(state.setupUrl);
      saveRecentUrl(state.setupUrl);
    } catch (err) {
      state.error = err.message + (err.details?.length ? '\n' + err.details.join('\n') : '');
      show('host-setup');
      return;
    }

    const id = generateSessionId();
    const key = sessionIdToKey(id);
    const { raw: setup } = loadedSetup;

    sessionState = {
      sessionId: sessionIdToString(id),
      sessionKey: key,
      players: [{ name: state.name, peerId: 'host' }],
      isHost: true,
      setupName: setup.name,
      playerRange: `${setup.players.min}-${setup.players.max}`,
    };

    network = createHost(key, {
      onReady: () => {
        history.replaceState(null, '', `?session=${key}`);
        show('session');
      },
      onPlayerJoin: (peerId, info) => {
        sessionState.players.push({ peerId, ...info });
        network.broadcastPlayers(sessionState.players);
        renderScreen();
      },
      onPlayerDisconnect: (peerId) => {
        // Mark as disconnected but keep in list
        renderScreen();
      },
      onPlayerReconnect: (newPeerId, oldPeerId, info) => {
        // Update peer ID in player list
        const player = sessionState.players.find(p => p.peerId === oldPeerId);
        if (player) player.peerId = newPeerId;
        network.broadcastPlayers(sessionState.players);
        onGameStart?.onPlayerReconnect?.(newPeerId, oldPeerId);
        renderScreen();
      },
      onPlayerLeave: (peerId) => {
        sessionState.players = sessionState.players.filter(p => p.peerId !== peerId);
        network.broadcastPlayers(sessionState.players);
        renderScreen();
      },
      onAction: (peerId, action) => {
        onGameStart?.onAction?.(peerId, action);
      },
      onError: err => console.error('Host error:', err),
    }, { name: state.name });
  }

  function joinGame() {
    destroyNetwork();
    const key = `${state.adj1}-${state.adj2}-${state.animal}`.toLowerCase();
    const playerInfo = { name: state.name };
    const playerToken = getPlayerToken();

    sessionState = {
      sessionId: `${state.adj1} ${state.adj2} ${state.animal}`,
      sessionKey: key,
      players: [],
      isHost: false,
      setupName: '',
      playerRange: '',
    };

    network = joinSession(key, playerInfo, playerToken, {
      onReady: () => show('session'),
      onPlayerList: (players) => {
        sessionState.players = players;
        renderScreen();
      },
      onGameStart: (data) => {
        show('game');
        onGameStart?.start?.(network, sessionState, data);
      },
      onFullState: (data) => onGameStart?.onFullState?.(data),
      onDelta: (data) => onGameStart?.onDelta?.(data),
      onDisconnect: () => {
        // Don't immediately show error — auto-reconnect will try
      },
      onReconnecting: (attempt, max) => {
        state.loadingMessage = `Reconnecting... (${attempt}/${max})`;
        if (currentScreen !== 'game') show('loading');
      },
      onError: err => {
        state.error = err.message;
        show('error');
      },
    });
  }

  function startPlay() {
    const { raw: setup, deck } = loadedSetup;
    const playerCount = sessionState.players.length;

    if (playerCount < setup.players.min) {
      state.error = `Need at least ${setup.players.min} players`;
      renderScreen();
      return;
    }
    if (playerCount > setup.players.max) {
      state.error = `Maximum ${setup.players.max} players`;
      renderScreen();
      return;
    }

    show('game');

    // Prepare deck metadata for guests (card faces, backs, size)
    const deckMeta = {
      name: deck.name,
      size: deck.size,
      back: deck.back,
      cards: deck.cards.map(c => ({ face: c.face, back: c.back, tags: c.tags })),
    };

    const initData = {
      setup: setup,
      deckMeta,
      players: sessionState.players,
    };

    network.startGame(initData);
    onGameStart?.start?.(network, sessionState, { setup, deck, players: sessionState.players, isHost: true });
  }

  function destroyNetwork() {
    if (network) { network.destroy(); network = null; }
    loadedSetup = null;
  }

  // --- URL history ---

  function getRecentUrls() {
    try {
      return JSON.parse(localStorage.getItem(RECENT_URLS_KEY) || '[]');
    } catch { return []; }
  }

  function saveRecentUrl(url) {
    const urls = getRecentUrls().filter(u => u !== url);
    urls.unshift(url);
    localStorage.setItem(RECENT_URLS_KEY, JSON.stringify(urls.slice(0, MAX_RECENT)));
  }

  // --- URL params (join via shared link) ---

  function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('session')) {
      const parts = params.get('session').split('-');
      if (parts.length === 3) {
        const cap = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
        state.adj1 = cap(parts[0]);
        state.adj2 = cap(parts[1]);
        state.animal = cap(parts[2]);
        state.name = 'Player ' + (2 + Math.floor(Math.random() * 98));
        show('join');
        return;
      }
    }
    show('splash');
  }

  checkUrlParams();

  return {
    show,
    getNetwork: () => network,
    getSessionState: () => sessionState,
    getLoadedSetup: () => loadedSetup,
  };
}
