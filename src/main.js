// Deckspace — main entry point

import { createNavigation } from './navigation.js';
import { createGameState, moveCards, flipCards, clonePlace, canPlayerAccess, computeChecksum } from './state.js';
import { computePlayerView, serializeView, computeViewDelta, applyViewDelta } from './view.js';
import { createBoard, renderBoard } from './board.js';
import { createInteraction, renderActionBar, bindActionBar } from './interaction.js';

const ui = document.getElementById('ui');
const game = document.getElementById('game');

let gameState = null;
let deck = null;
let deckInfo = null; // { size, back, cards } — for rendering
let network = null;
let isHost = false;
let localPlayerId = null;
let allPlayerIds = [];
let playerViews = new Map(); // peerId -> last serialized view
let localView = null; // Serialized view for local display
let boardLayout = null;
let interaction = null;

function handleAction(peerId, action) {
  if (!gameState || !isHost) return;

  if (action.type === 'move') {
    const fromPlace = gameState.places.get(action.from);
    const toPlace = gameState.places.get(action.to);
    if (!fromPlace || !toPlace) return;
    if (!canPlayerAccess(fromPlace, peerId, 'out')) return;
    if (!canPlayerAccess(toPlace, peerId, 'in')) return;

    const delta = moveCards(gameState, action.cardIds, action.from, action.to, action.position, action.flip);
    if (delta) broadcastState();
  } else if (action.type === 'flip') {
    const place = gameState.places.get(action.placeId);
    if (!place) return;
    // For flip, allow if player can access the place at all
    if (!canPlayerAccess(place, peerId, 'out')) return;

    const delta = flipCards(gameState, action.cardIds, action.placeId, action.faceUp);
    if (delta) broadcastState();
  } else if (action.type === 'clone') {
    const delta = clonePlace(gameState, action.placeId);
    if (delta) broadcastState();
  }
}

function sendAction(action) {
  if (isHost) {
    // Apply locally
    handleAction(localPlayerId, action);
    updateLocalView();
    renderGame();
  } else if (network) {
    network.sendAction(action);
  }
}

function broadcastState() {
  if (!network || !isHost) return;

  // Update local view
  updateLocalView();
  renderGame();

  // Send personalized views to each guest
  for (const peerId of allPlayerIds) {
    if (peerId === 'host') continue;

    const view = computePlayerView(gameState, peerId, deck);
    const serialized = serializeView(view, gameState.version);

    const prevView = playerViews.get(peerId);
    const delta = computeViewDelta(prevView, serialized);

    if (delta) {
      delta.checksum = computeChecksum(gameState);
      network.sendToPlayer(peerId, { type: 'delta', ...delta });
    }

    playerViews.set(peerId, serialized);
  }
}

function updateLocalView() {
  if (!gameState || !isHost) return;
  const view = computePlayerView(gameState, localPlayerId, deck);
  localView = serializeView(view, gameState.version);
  // Attach configs for rendering
  for (const [id, place] of gameState.places) {
    if (localView.places[id]) {
      localView.places[id].config = place.config;
    }
  }
}

function startGame(net, sessionState, initData) {
  network = net;
  isHost = initData.isHost ?? false;
  allPlayerIds = initData.players.map(p => p.peerId);

  if (isHost) {
    deck = initData.deck;
    deckInfo = {
      size: deck.size,
      back: deck.back,
      cards: deck.cards.map(c => ({ face: c.face, back: c.back, tags: c.tags })),
    };
    localPlayerId = 'host';
    gameState = createGameState(initData.setup, deck, allPlayerIds);

    // Send initial full state to each guest
    for (const peerId of allPlayerIds) {
      if (peerId === 'host') continue;
      const view = computePlayerView(gameState, peerId, deck);
      const serialized = serializeView(view, gameState.version);
      // Attach configs
      for (const [id, place] of gameState.places) {
        if (serialized.places[id]) {
          serialized.places[id].config = place.config;
        }
      }
      network.sendToPlayer(peerId, { type: 'state', ...serialized });
      playerViews.set(peerId, serialized);
    }

    updateLocalView();
  } else {
    localPlayerId = net.getLocalId();
    deckInfo = initData.deckMeta || null;
    localView = { places: {}, version: 0 };
  }

  initBoard();
  renderGame();
}

function onFullState(data) {
  localView = { places: data.places, version: data.version };
  renderGame();
}

function onDelta(data) {
  if (localView) {
    localView = applyViewDelta(localView, data);
  }
  renderGame();
}

function onPlayerReconnect(newPeerId, oldPeerId) {
  if (!gameState || !isHost || !network) return;

  // Update player ID in our tracking
  const oldView = playerViews.get(oldPeerId);
  if (oldView) {
    playerViews.delete(oldPeerId);
  }

  // Update allPlayerIds
  const idx = allPlayerIds.indexOf(oldPeerId);
  if (idx !== -1) allPlayerIds[idx] = newPeerId;

  // Send full state to reconnected player
  const view = computePlayerView(gameState, newPeerId, deck);
  const serialized = serializeView(view, gameState.version);
  for (const [id, place] of gameState.places) {
    if (serialized.places[id]) {
      serialized.places[id].config = place.config;
    }
  }
  network.sendToPlayer(newPeerId, { type: 'state', ...serialized });
  playerViews.set(newPeerId, serialized);
}

function initBoard() {
  boardLayout = createBoard(game);
  interaction = createInteraction({
    sendAction,
    getViewData: () => localView,
    getLocalPlayerId: () => localPlayerId,
    getDeckInfo: () => deckInfo,
    rerender: renderGame,
  });
}

function renderGame() {
  if (!boardLayout || !localView || !interaction) return;

  const interactionState = interaction.getState();

  if (interactionState.mode === 'zoomed' || interactionState.mode === 'selecting-destination') {
    renderZoomedView();
  } else {
    renderOverview();
  }
}

function renderOverview() {
  // Remove zoomed view if present
  const existingZoom = game.querySelector('.board-zoomed');
  if (existingZoom) existingZoom.remove();
  const existingBar = game.querySelector('.action-bar');
  if (existingBar) existingBar.remove();

  game.classList.remove('zoomed');
  boardLayout.tableArea.style.display = '';
  boardLayout.playerArea.style.display = '';

  renderBoard(boardLayout, localView, localPlayerId, allPlayerIds, deckInfo, {
    onPlaceTap: (placeId) => interaction.onPlaceTap(placeId),
    onCardTap: (cardId, placeId) => interaction.onCardTap(cardId, placeId),
  });
}

function renderZoomedView() {
  const interactionState = interaction.getState();
  const placeId = interactionState.zoomedPlaceId;
  const placeData = localView.places?.[placeId];

  if (!placeData) {
    interaction.cancelAction();
    return;
  }

  // Hide overview
  boardLayout.tableArea.style.display = 'none';
  boardLayout.playerArea.style.display = 'none';
  game.classList.add('zoomed');

  // Remove existing zoom elements
  let zoomContainer = game.querySelector('.board-zoomed');
  if (!zoomContainer) {
    zoomContainer = document.createElement('div');
    zoomContainer.className = 'board-zoomed';
    game.appendChild(zoomContainer);
  }

  // If selecting destination, show all places as targets
  if (interactionState.mode === 'selecting-destination') {
    renderDestinationPicker(zoomContainer);
  } else {
    renderZoomedPlace(zoomContainer, placeId, placeData, interactionState);
  }

  // Render action bar
  let barContainer = game.querySelector('.action-bar-container');
  if (!barContainer) {
    barContainer = document.createElement('div');
    barContainer.className = 'action-bar-container';
    game.appendChild(barContainer);
  }
  barContainer.innerHTML = renderActionBar(interactionState, interaction);
  bindActionBar(barContainer, interaction);
}

function renderZoomedPlace(container, placeId, placeData, interactionState) {
  container.innerHTML = '';

  // Place name
  const name = document.createElement('div');
  name.className = 'place-name';
  name.textContent = placeId.split(':').pop();
  container.appendChild(name);

  // Render each card as selectable
  const cards = placeData.cards || [];
  for (const card of cards) {
    const el = document.createElement('div');
    el.className = 'card' + (card.faceUp ? ' face-up' : ' face-down');
    if (interactionState.selectedCardIds.has(card.id)) {
      el.classList.add('selected');
    }
    el.dataset.cardId = card.id;

    if (card.faceUp && card.deckIndex !== null) {
      const cardData = deckInfo?.cards?.[card.deckIndex];
      if (cardData?.face) {
        const img = document.createElement('img');
        img.className = 'card-face';
        img.src = cardData.face;
        img.loading = 'lazy';
        img.alt = getCardAlt(cardData);
        img.onerror = () => {
          img.style.display = 'none';
          el.appendChild(createFallback(cardData));
        };
        el.appendChild(img);
      } else {
        el.appendChild(createFallback(cardData));
      }
    } else {
      const backUrl = getCardBack(card);
      if (backUrl) {
        const img = document.createElement('img');
        img.className = 'card-back';
        img.src = backUrl;
        img.loading = 'lazy';
        el.appendChild(img);
      } else {
        const back = document.createElement('div');
        back.className = 'card-default-back';
        el.appendChild(back);
      }
    }

    el.addEventListener('click', () => interaction.onCardTap(card.id, placeId));
    container.appendChild(el);
  }

  if (cards.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'place-empty';
    empty.style.margin = '20px auto';
    empty.textContent = 'Empty';
    empty.style.display = 'flex';
    empty.style.alignItems = 'center';
    empty.style.justifyContent = 'center';
    empty.style.color = '#4a7a4a';
    container.appendChild(empty);
  }
}

function renderDestinationPicker(container) {
  container.innerHTML = '';
  container.style.position = 'relative';
  container.style.display = 'block';
  container.style.overflow = 'hidden';

  const title = document.createElement('div');
  title.className = 'place-name';
  title.textContent = 'Tap a destination';
  title.style.position = 'absolute';
  title.style.top = '8px';
  title.style.left = '0';
  title.style.right = '0';
  title.style.zIndex = '10';
  container.appendChild(title);

  const board = document.createElement('div');
  board.className = 'dest-board';
  container.appendChild(board);

  const currentPlaceId = interaction.getState().zoomedPlaceId;

  // Separate places into table (global + others) and player (own)
  const containerHeight = container.clientHeight || window.innerHeight - 60;
  const containerWidth = container.clientWidth || window.innerWidth;

  for (const [id, placeData] of Object.entries(localView.places || {})) {
    if (id === currentPlaceId) continue;

    const config = placeData.config || {};
    const loc = config.location || { x: 50, y: 50 };
    const cardCount = placeData.cards?.length || 0;
    const placeName = id.split(':').pop();

    const btn = document.createElement('div');
    btn.className = 'dest-place-btn';

    // Position based on whether it's a player place or global/other
    let yOffset = 0;
    if (id.startsWith('player:') && id.includes(`:${localPlayerId}:`)) {
      // Own player place: bottom half
      yOffset = 50;
    }
    btn.style.left = `${loc.x}%`;
    btn.style.top = `${yOffset + loc.y * 0.5}%`;

    btn.innerHTML = `<span class="dest-name">${escHtml(placeName)}</span><span class="dest-count">${cardCount}</span>`;

    btn.addEventListener('click', () => interaction.onPlaceTap(id));
    board.appendChild(btn);
  }
}

// --- Utilities ---

function getCardAlt(cardData) {
  if (!cardData?.tags) return 'Card';
  const parts = [];
  if (cardData.tags.number) parts.push(cardData.tags.number);
  if (cardData.tags.suit) parts.push('of ' + cardData.tags.suit);
  return parts.join(' ') || 'Card';
}

function createFallback(cardData) {
  const el = document.createElement('div');
  el.className = 'card-fallback';
  if (cardData?.tags) {
    const parts = [];
    if (cardData.tags.number) parts.push(cardData.tags.number);
    if (cardData.tags.suit) parts.push(cardData.tags.suit);
    el.textContent = parts.join(' ');
  } else {
    el.textContent = '?';
  }
  return el;
}

function getCardBack(card) {
  if (card.deckIndex !== null && deckInfo?.cards?.[card.deckIndex]?.back) {
    return deckInfo.cards[card.deckIndex].back;
  }
  return deckInfo?.back || null;
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// --- Bootstrap ---

createNavigation(ui, game, {
  start: startGame,
  onAction: handleAction,
  onFullState,
  onDelta,
  onPlayerReconnect,
});
