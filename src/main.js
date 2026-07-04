// Deckspace — main entry point

import { createNavigation } from './navigation.js';
import { createGameState, moveCards, flipCards, clonePlace, canPlayerAccess, computeChecksum } from './state.js';
import { computePlayerView, serializeView, computeViewDelta, applyViewDelta } from './view.js';
import { createBoard, renderBoard } from './board.js';
import { createInteraction, addLongPress } from './interaction.js';

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
let gameSetup = null; // Raw setup JSON (for layout groups)
let playerNames = new Map(); // peerId -> display name

// --- Host action handler ---

function handleAction(peerId, action) {
  if (!gameState || !isHost) return;

  if (action.type === 'pickup') {
    // Move cards from source to a virtual hand place
    const fromPlace = gameState.places.get(action.from);
    if (!fromPlace) return;
    if (!canPlayerAccess(fromPlace, peerId, 'out')) return;

    // Create or get the hand place for this player
    const handId = `__hand__:${peerId}`;
    if (!gameState.places.has(handId)) {
      gameState.places.set(handId, { id: handId, cards: [], config: { owner: peerId } });
    }

    const delta = moveCards(gameState, action.cardIds, action.from, handId, 'top', 'asIs');
    if (delta) broadcastState();

  } else if (action.type === 'deposit') {
    const toPlace = gameState.places.get(action.to);
    if (!toPlace) return;
    if (!canPlayerAccess(toPlace, peerId, 'in')) return;

    const handId = `__hand__:${peerId}`;
    const handPlace = gameState.places.get(handId);
    if (!handPlace) return;

    const delta = moveCards(gameState, action.cardIds, handId, action.to, action.position, action.flip);
    if (delta) broadcastState();

  } else if (action.type === 'move') {
    const fromPlace = gameState.places.get(action.from);
    const toPlace = gameState.places.get(action.to);
    if (!fromPlace || !toPlace) return;
    if (!canPlayerAccess(fromPlace, peerId, 'out')) return;
    if (!canPlayerAccess(toPlace, peerId, 'in')) return;

    const delta = moveCards(gameState, action.cardIds, action.from, action.to, action.position, action.flip);
    if (delta) broadcastState();

  } else if (action.type === 'flip') {
    // For hand flips, use the hand place
    let placeId = action.placeId;
    if (placeId === '__hand__') placeId = `__hand__:${peerId}`;
    const place = gameState.places.get(placeId);
    if (!place) return;

    const delta = flipCards(gameState, action.cardIds, placeId, action.faceUp);
    if (delta) broadcastState();

  } else if (action.type === 'clone') {
    const delta = clonePlace(gameState, action.placeId);
    if (delta) broadcastState();
  }
}

function sendAction(action) {
  if (isHost) {
    handleAction(localPlayerId, action);
    updateLocalView();
    renderGame();
  } else if (network) {
    network.sendAction(action);
  }
}

// --- Network state management ---

function broadcastState() {
  if (!network || !isHost) return;

  updateLocalView();
  renderGame();

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
  // Attach setup reference for layout
  for (const place of Object.values(localView.places)) {
    if (place.config) place.config._setup = gameSetup;
  }
}

// --- Game lifecycle ---

function startGame(net, sessionState, initData) {
  network = net;
  isHost = initData.isHost ?? false;
  allPlayerIds = initData.players.map(p => p.peerId);
  playerNames = new Map(initData.players.map(p => [p.peerId, p.name]));

  if (isHost) {
    deck = initData.deck;
    deckInfo = {
      size: deck.size,
      back: deck.back,
      cards: deck.cards.map(c => ({ face: c.face, back: c.back, tags: c.tags })),
    };
    localPlayerId = 'host';
    gameSetup = initData.setup;
    gameState = createGameState(initData.setup, deck, allPlayerIds);

    for (const peerId of allPlayerIds) {
      if (peerId === 'host') continue;
      const view = computePlayerView(gameState, peerId, deck);
      const serialized = serializeView(view, gameState.version);
      for (const place of Object.values(serialized.places)) {
        if (place.config) place.config._setup = gameSetup;
      }
      network.sendToPlayer(peerId, { type: 'state', ...serialized });
      playerViews.set(peerId, serialized);
    }

    updateLocalView();
  } else {
    localPlayerId = net.getLocalId();
    deckInfo = initData.deckMeta || null;
    localView = { places: {}, version: 0 };
    // Store setup for layout (guests receive it from host via initData)
    gameSetup = initData.setup || null;
  }

  initBoard();
  renderGame();
}

function onFullState(data) {
  localView = { places: data.places, version: data.version };
  // Attach setup reference for layout
  if (gameSetup) {
    for (const place of Object.values(localView.places)) {
      if (place.config) place.config._setup = gameSetup;
      else place.config = { _setup: gameSetup };
    }
  }
  renderGame();
}

function onDelta(data) {
  if (localView) {
    localView = applyViewDelta(localView, data);
    // Ensure setup reference persists
    if (gameSetup) {
      for (const place of Object.values(localView.places)) {
        if (place.config) place.config._setup = gameSetup;
        else place.config = { _setup: gameSetup };
      }
    }
  }
  renderGame();
}

function onPlayerReconnect(newPeerId, oldPeerId) {
  if (!gameState || !isHost || !network) return;

  const oldView = playerViews.get(oldPeerId);
  if (oldView) playerViews.delete(oldPeerId);

  const idx = allPlayerIds.indexOf(oldPeerId);
  if (idx !== -1) allPlayerIds[idx] = newPeerId;

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

// --- Board and rendering ---

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

  // Always render the overview (no zoom mode)
  renderOverview();

  // Render the hand strip
  renderHandStrip(interactionState);

  // Render fullscreen inspect if active
  if (interactionState.inspecting) {
    renderInspect(interactionState.inspecting);
  } else {
    removeInspect();
  }
}

function renderOverview() {
  game.classList.remove('zoomed');
  boardLayout.tableArea.style.display = '';
  boardLayout.playerArea.style.display = '';

  // Remove any old zoomed elements
  const existingZoom = game.querySelector('.board-zoomed');
  if (existingZoom) existingZoom.remove();
  const existingBar = game.querySelector('.action-bar-container');
  if (existingBar) existingBar.remove();

  // Filter out hand places from the view
  const filteredView = { ...localView, places: {} };
  for (const [id, place] of Object.entries(localView.places || {})) {
    if (!id.startsWith('__hand__')) {
      filteredView.places[id] = place;
    }
  }

  renderBoard(boardLayout, filteredView, localPlayerId, allPlayerIds, deckInfo, playerNames, {
    onPlaceTap: () => {}, // No action on place tap in overview
    onCardTap: (cardId, placeId) => interaction.onCardTap(cardId, placeId),
    onPlaceLongPress: (placeId) => interaction.onPlaceLongPress(placeId),
  });
}

function renderHandStrip(interactionState) {
  let strip = game.querySelector('.hand-strip');
  if (!strip) {
    strip = document.createElement('div');
    strip.className = 'hand-strip visible';
    game.appendChild(strip);
  }

  strip.classList.add('visible');
  strip.innerHTML = '';

  // Sync hand card data from server state (gets deckIndex after flip reveals card)
  const handPlaceId = `__hand__:${localPlayerId}`;
  const serverHand = localView?.places?.[handPlaceId]?.cards;
  if (serverHand) {
    for (const handCard of interactionState.hand) {
      const serverCard = serverHand.find(c => c.id === handCard.id);
      if (serverCard) {
        handCard.deckIndex = serverCard.deckIndex;
        handCard.faceUp = serverCard.faceUp;
      }
    }
  }

  // Cancel button — only show when hand has cards
  if (interactionState.hand.length > 0) {
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'hand-cancel';
    cancelBtn.textContent = '↩';
    cancelBtn.title = 'Return cards';
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      interaction.cancel();
    });
    strip.appendChild(cancelBtn);
  }

  // Render hand cards fanned out
  const cards = interactionState.hand;
  if (cards.length === 0) return;

  const maxWidth = strip.clientWidth - 60; // leave room for cancel button
  const cardWidth = 50; // base card width at scale
  const spacing = Math.min(cardWidth * 0.8, maxWidth / Math.max(cards.length, 1));

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const el = document.createElement('div');
    el.className = 'card hand-card' + (card.faceUp ? ' face-up' : ' face-down');
    el.style.left = `${60 + i * spacing}px`;

    if (card.faceUp && card.deckIndex !== null) {
      const cardData = deckInfo?.cards?.[card.deckIndex];
      if (cardData?.face) {
        const img = document.createElement('img');
        img.className = 'card-face';
        img.src = cardData.face;
        img.loading = 'lazy';
        img.alt = getCardAlt(cardData);
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
        el.appendChild(createDefaultBack());
      }
    }

    // Tap to flip
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      interaction.onCardTap(card.id, '__hand__');
    });

    // Long-press to inspect
    addLongPress(el, () => interaction.onHandCardLongPress(card.id));

    strip.appendChild(el);
  }
}

function renderInspect(cardId) {
  let overlay = game.querySelector('.inspect-overlay');
  if (overlay && overlay.dataset.cardId === cardId) return; // already showing

  removeInspect();
  const interactionState = interaction.getState();
  const card = interactionState.hand.find(c => c.id === cardId);
  if (!card) return;

  overlay = document.createElement('div');
  overlay.className = 'inspect-overlay';
  overlay.dataset.cardId = cardId;

  const cardEl = document.createElement('div');
  cardEl.className = 'inspect-card';

  if (card.faceUp && card.deckIndex !== null) {
    const cardData = deckInfo?.cards?.[card.deckIndex];
    if (cardData?.face) {
      const img = document.createElement('img');
      img.src = cardData.face;
      img.alt = getCardAlt(cardData);
      cardEl.appendChild(img);
    } else {
      cardEl.appendChild(createFallback(cardData));
    }
  } else {
    const backUrl = getCardBack(card);
    if (backUrl) {
      const img = document.createElement('img');
      img.src = backUrl;
      cardEl.appendChild(img);
    } else {
      cardEl.appendChild(createDefaultBack());
    }
  }

  overlay.appendChild(cardEl);
  overlay.addEventListener('click', () => interaction.dismissInspect());
  game.appendChild(overlay);
}

function removeInspect() {
  const overlay = game.querySelector('.inspect-overlay');
  if (overlay) overlay.remove();
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

function createDefaultBack() {
  const el = document.createElement('div');
  el.className = 'card-default-back';
  return el;
}

function getCardBack(card) {
  if (card.deckIndex !== null && deckInfo?.cards?.[card.deckIndex]?.back) {
    return deckInfo.cards[card.deckIndex].back;
  }
  return deckInfo?.back || null;
}

// --- Bootstrap ---

// Prevent context menu on game board (allows long-press gestures)
game.addEventListener('contextmenu', (e) => e.preventDefault());

const navigation = createNavigation(ui, game, {
  start: startGame,
  onAction: handleAction,
  onFullState,
  onDelta,
  onPlayerReconnect,
});
