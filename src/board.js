// Game board renderer — overview layout with top/bottom split
// Top half: global places + other players' visible places (rotated around table)
// Bottom half: current player's own places

/**
 * @typedef {Object} BoardLayout
 * @property {HTMLElement} container
 * @property {HTMLElement} tableArea - Top half (global + others)
 * @property {HTMLElement} playerArea - Bottom half (own places)
 */

/**
 * Create the game board DOM structure.
 * @param {HTMLElement} container - The #game element
 * @returns {BoardLayout}
 */
export function createBoard(container) {
  container.innerHTML = '';
  container.classList.add('board');

  const tableArea = document.createElement('div');
  tableArea.className = 'board-table';

  const playerArea = document.createElement('div');
  playerArea.className = 'board-player';

  container.appendChild(tableArea);
  container.appendChild(playerArea);

  return { container, tableArea, playerArea };
}

/**
 * Render the board from a player's view.
 * @param {BoardLayout} layout
 * @param {Object} viewData - Serialized view { places: { id: { cards, config } } }
 * @param {string} localPlayerId
 * @param {string[]} allPlayerIds - All player IDs in seat order
 * @param {Object} deckInfo - { size, back, cards }
 * @param {Object} callbacks - { onPlaceTap, onCardTap }
 */
export function renderBoard(layout, viewData, localPlayerId, allPlayerIds, deckInfo, callbacks) {
  const { tableArea, playerArea } = layout;

  // Categorize places
  const globalPlaces = [];
  const ownPlaces = [];
  const otherPlaces = []; // { place, ownerIndex, ownerCount }

  for (const [id, placeData] of Object.entries(viewData.places || {})) {
    const config = placeData.config || parsePlaceConfig(id);
    const entry = { id, ...placeData, config };

    if (id.startsWith('global:')) {
      globalPlaces.push(entry);
    } else if (id.startsWith('player:')) {
      const owner = id.split(':')[1];
      if (owner === localPlayerId) {
        ownPlaces.push(entry);
      } else {
        const ownerIndex = allPlayerIds.indexOf(owner);
        otherPlaces.push({ ...entry, ownerIndex });
      }
    }
  }

  // Determine layout mode
  const hasGlobal = globalPlaces.length > 0 || otherPlaces.length > 0;
  const hasPlayer = ownPlaces.length > 0;

  if (hasGlobal && hasPlayer) {
    tableArea.style.display = '';
    playerArea.style.display = '';
    tableArea.style.flex = '1';
    playerArea.style.flex = '1';
  } else if (hasGlobal) {
    tableArea.style.display = '';
    playerArea.style.display = 'none';
    tableArea.style.flex = '1';
  } else {
    tableArea.style.display = 'none';
    playerArea.style.display = '';
    playerArea.style.flex = '1';
  }

  // Render top half — global + other players' places
  renderTableArea(tableArea, globalPlaces, otherPlaces, localPlayerId, allPlayerIds, deckInfo, callbacks);

  // Render bottom half — player's own places
  renderPlayerArea(playerArea, ownPlaces, deckInfo, callbacks);
}

function renderTableArea(container, globalPlaces, otherPlaces, localPlayerId, allPlayerIds, deckInfo, callbacks) {
  container.innerHTML = '';

  // Calculate table rotation for other players
  const localIndex = allPlayerIds.indexOf(localPlayerId);
  const playerCount = allPlayerIds.length;

  // Render global places
  for (const place of globalPlaces) {
    const el = renderPlace(place, deckInfo, 0, callbacks);
    positionElement(el, place.config?.location, container);
    container.appendChild(el);
  }

  // Render other players' places rotated around table
  for (const place of otherPlaces) {
    const seatAngle = getSeatRotation(place.ownerIndex, localIndex, playerCount);
    const el = renderPlace(place, deckInfo, seatAngle, callbacks);
    // Position relative to owner's seat
    const seatPos = getSeatPosition(place.ownerIndex, localIndex, playerCount);
    const loc = place.config?.location || { x: 50, y: 50 };
    // Offset place position relative to seat center
    const adjustedLoc = {
      x: seatPos.x + (loc.x - 50) * 0.3,
      y: seatPos.y + (loc.y - 50) * 0.3,
    };
    positionElement(el, adjustedLoc, container);
    container.appendChild(el);
  }
}

function renderPlayerArea(container, places, deckInfo, callbacks) {
  container.innerHTML = '';

  for (const place of places) {
    const el = renderPlace(place, deckInfo, 0, callbacks);
    positionElement(el, place.config?.location, container);
    container.appendChild(el);
  }
}

/**
 * Render a single place with its cards.
 */
function renderPlace(place, deckInfo, seatRotation, callbacks) {
  const el = document.createElement('div');
  el.className = 'place';
  el.dataset.placeId = place.id;

  const config = place.config || {};
  const arrangement = config.arrangement || { spreadX: 0, spreadY: 0, spreadAngle: 0 };
  const rotation = (config.location?.rotation || 0) + seatRotation;

  if (rotation !== 0) {
    el.style.transform = `rotate(${rotation}deg)`;
  }

  // Render cards
  const cards = place.cards || [];
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const cardEl = renderCard(card, i, cards.length, arrangement, deckInfo, callbacks);
    el.appendChild(cardEl);
  }

  // Empty place indicator
  if (cards.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'place-empty';
    el.appendChild(empty);
  }

  // Tap handler for place
  el.addEventListener('click', (e) => {
    if (e.target.closest('.card')) return; // Let card clicks bubble separately
    callbacks.onPlaceTap?.(place.id);
  });

  return el;
}

/**
 * Render a single card element.
 */
function renderCard(card, index, total, arrangement, deckInfo, callbacks) {
  const el = document.createElement('div');
  el.className = 'card' + (card.faceUp ? ' face-up' : ' face-down');
  el.dataset.cardId = card.id;

  // Position within place based on arrangement
  const offsetX = index * (arrangement.spreadX || 0);
  const offsetY = index * (arrangement.spreadY || 0);
  const offsetAngle = index * (arrangement.spreadAngle || 0);

  let transform = '';
  if (offsetX || offsetY) transform += `translate(${offsetX}px, ${offsetY}px)`;
  if (offsetAngle) transform += ` rotate(${offsetAngle}deg)`;
  if (transform) el.style.transform = transform;

  // Card image
  if (card.faceUp && card.deckIndex !== null) {
    const cardData = deckInfo.cards?.[card.deckIndex];
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
    // Face down — show back
    const backUrl = getCardBack(card, deckInfo);
    if (backUrl) {
      const img = document.createElement('img');
      img.className = 'card-back';
      img.src = backUrl;
      img.loading = 'lazy';
      img.alt = 'Card back';
      el.appendChild(img);
    } else {
      el.appendChild(createDefaultBack());
    }
  }

  el.addEventListener('click', (e) => {
    e.stopPropagation();
    callbacks.onCardTap?.(card.id, el.closest('.place')?.dataset.placeId);
  });

  return el;
}

/**
 * Create a text fallback for broken/missing card images.
 */
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

/**
 * Create the default card back pattern (generic cross-hatch).
 */
function createDefaultBack() {
  const el = document.createElement('div');
  el.className = 'card-default-back';
  return el;
}

function getCardBack(card, deckInfo) {
  if (card.deckIndex !== null) {
    const cardData = deckInfo.cards?.[card.deckIndex];
    if (cardData?.back) return cardData.back;
  }
  return deckInfo.back || null;
}

function getCardAlt(cardData) {
  if (!cardData?.tags) return 'Card';
  const parts = [];
  if (cardData.tags.number) parts.push(cardData.tags.number);
  if (cardData.tags.suit) parts.push('of ' + cardData.tags.suit);
  return parts.join(' ') || 'Card';
}

/**
 * Position an element within a container using percentage-based coordinates.
 */
function positionElement(el, location, container) {
  if (!location) return;
  // Convert setup coordinates to percentage positions
  // Setup uses a virtual coordinate space; we map to % of container
  el.style.position = 'absolute';
  el.style.left = `${location.x}%`;
  el.style.top = `${location.y}%`;
}

/**
 * Get the rotation angle for a player's seat relative to the viewer.
 * Viewer is at the bottom (0°), opposite is 180°, sides are 90°/-90°.
 */
function getSeatRotation(playerIndex, viewerIndex, totalPlayers) {
  if (totalPlayers <= 1) return 0;
  const offset = ((playerIndex - viewerIndex) + totalPlayers) % totalPlayers;
  return (offset / totalPlayers) * 360;
}

/**
 * Get the position of a player's seat in the table area (percentage).
 * Places seats in an elliptical arrangement.
 */
function getSeatPosition(playerIndex, viewerIndex, totalPlayers) {
  if (totalPlayers <= 1) return { x: 50, y: 50 };
  const offset = ((playerIndex - viewerIndex) + totalPlayers) % totalPlayers;
  const angle = (offset / totalPlayers) * 2 * Math.PI - Math.PI / 2; // Start from top
  return {
    x: 50 + Math.cos(angle) * 35,
    y: 50 + Math.sin(angle) * 35,
  };
}

function parsePlaceConfig(placeId) {
  // Infer basic config from place ID if config not attached
  return { location: { x: 50, y: 50 }, arrangement: { spreadX: 0, spreadY: 0, spreadAngle: 0 } };
}
