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

  // Compute viewport-aware card scale factor
  const allPlaces = [...globalPlaces, ...otherPlaces, ...ownPlaces];
  const cardScale = computeCardScale(layout.container, allPlaces.length, allPlaces);

  // Render top half — global + other players' places
  renderTableArea(tableArea, globalPlaces, otherPlaces, localPlayerId, allPlayerIds, deckInfo, callbacks, cardScale);

  // Render bottom half — player's own places
  renderPlayerArea(playerArea, ownPlaces, deckInfo, callbacks, cardScale);
}

/**
 * Compute a card scale factor based on viewport and place count.
 * Goal: fill available space intelligently — larger viewport = larger cards,
 * more places = slightly smaller cards but not too aggressive.
 */
function computeCardScale(container, placeCount, places) {
  const vw = container.clientWidth || window.innerWidth;
  const vh = container.clientHeight || window.innerHeight;

  const baseCardW = 50;
  const baseCardH = 70;

  // Find the widest row: group places by similar y-coordinate and count columns
  let maxCols = 1;
  if (places && places.length > 0) {
    // Group places by y (within 20% tolerance of total y-range)
    const ys = places.map(p => p.config?.location?.y ?? 50);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const yRange = maxY - minY || 1;
    const tolerance = yRange * 0.2;

    const rows = [];
    for (const y of ys) {
      let found = false;
      for (const row of rows) {
        if (Math.abs(y - row.y) <= tolerance) {
          row.count++;
          found = true;
          break;
        }
      }
      if (!found) rows.push({ y, count: 1 });
    }
    maxCols = Math.max(...rows.map(r => r.count), 1);
  } else {
    maxCols = Math.ceil(Math.sqrt(placeCount * (vw / vh)));
  }

  const rows = Math.ceil(placeCount / maxCols);

  // Cards should fit: maxCols cards across with gaps
  const gapFactor = 0.85; // 85% of slot used by card, 15% gap
  const scaleByWidth = (vw / maxCols * gapFactor) / baseCardW;

  // And rows tall with room for spreads
  const scaleByHeight = (vh / Math.max(rows, 1) * 0.4) / baseCardH;

  const scale = Math.min(scaleByWidth, scaleByHeight);
  return Math.max(0.6, Math.min(3, scale));
}

function renderTableArea(container, globalPlaces, otherPlaces, localPlayerId, allPlayerIds, deckInfo, callbacks, cardScale) {
  container.innerHTML = '';

  // Calculate table rotation for other players
  const localIndex = allPlayerIds.indexOf(localPlayerId);
  const playerCount = allPlayerIds.length;

  // Compute bounds for all places, accounting for card spread extent
  const allLocations = [];
  const allExtents = []; // how far cards extend below/right of the anchor
  for (const place of globalPlaces) {
    const loc = place.config?.location || { x: 50, y: 50 };
    allLocations.push(loc);
    allExtents.push(computePlaceExtent(place, cardScale));
  }
  for (const place of otherPlaces) {
    const seatPos = getSeatPosition(place.ownerIndex, localIndex, playerCount);
    const loc = place.config?.location || { x: 50, y: 50 };
    allLocations.push({
      x: seatPos.x + (loc.x - 50) * 0.3,
      y: seatPos.y + (loc.y - 50) * 0.3,
    });
    allExtents.push(computePlaceExtent(place, cardScale));
  }
  const bounds = computeBoundsWithExtents(allLocations, allExtents, container, cardScale);

  // Render global places
  for (const place of globalPlaces) {
    const el = renderPlace(place, deckInfo, 0, callbacks, cardScale);
    positionElement(el, place.config?.location, bounds);
    container.appendChild(el);
  }

  // Render other players' places rotated around table
  for (const place of otherPlaces) {
    const seatAngle = getSeatRotation(place.ownerIndex, localIndex, playerCount);
    const el = renderPlace(place, deckInfo, seatAngle, callbacks, cardScale);
    // Position relative to owner's seat
    const seatPos = getSeatPosition(place.ownerIndex, localIndex, playerCount);
    const loc = place.config?.location || { x: 50, y: 50 };
    // Offset place position relative to seat center
    const adjustedLoc = {
      x: seatPos.x + (loc.x - 50) * 0.3,
      y: seatPos.y + (loc.y - 50) * 0.3,
    };
    positionElement(el, adjustedLoc, bounds);
    container.appendChild(el);
  }
}

function renderPlayerArea(container, places, deckInfo, callbacks, cardScale) {
  container.innerHTML = '';

  // Compute bounds for player places with extents
  const allLocations = places.map(p => p.config?.location || { x: 50, y: 50 });
  const allExtents = places.map(p => computePlaceExtent(p, cardScale));
  const bounds = computeBoundsWithExtents(allLocations, allExtents, container, cardScale);

  for (const place of places) {
    const el = renderPlace(place, deckInfo, 0, callbacks, cardScale);
    positionElement(el, place.config?.location, bounds);
    container.appendChild(el);
  }
}

/**
 * Render a single place with its cards.
 */
function renderPlace(place, deckInfo, seatRotation, callbacks, cardScale = 1) {
  const el = document.createElement('div');
  el.className = 'place';
  el.dataset.placeId = place.id;
  el.style.setProperty('--card-scale', cardScale);

  const config = place.config || {};
  const arrangement = config.arrangement || { spreadX: 0, spreadY: 0, spreadAngle: 0 };
  const rotation = (config.location?.rotation || 0) + seatRotation;

  if (rotation !== 0) {
    el.style.transform = `rotate(${rotation}deg)`;
    el.dataset.rotation = rotation;
  }

  // Render cards
  const cards = place.cards || [];
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const cardEl = renderCard(card, i, cards.length, arrangement, deckInfo, callbacks, cardScale);
    el.appendChild(cardEl);
  }

  // Empty place indicator
  if (cards.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'place-empty';
    el.appendChild(empty);
  }

  // Place label — always visible in overview, counter-rotated to stay readable
  const label = document.createElement('div');
  label.className = 'place-label';
  label.textContent = place.id.split(':').pop();
  if (rotation !== 0) {
    label.style.transform = `rotate(${-rotation}deg)`;
  }
  el.appendChild(label);

  // Tap handler for place (no-op in new UX, but kept for flexibility)
  el.addEventListener('click', (e) => {
    if (e.target.closest('.card')) return;
    callbacks.onPlaceTap?.(place.id);
  });

  // Long-press handler for depositing cards
  if (callbacks.onPlaceLongPress) {
    let lpTimer = null;
    let lpTriggered = false;
    el.addEventListener('pointerdown', (e) => {
      lpTriggered = false;
      lpTimer = setTimeout(() => {
        lpTriggered = true;
        callbacks.onPlaceLongPress(place.id);
      }, 500);
    });
    el.addEventListener('pointerup', () => { clearTimeout(lpTimer); });
    el.addEventListener('pointerleave', () => { clearTimeout(lpTimer); });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); });
    el.addEventListener('click', (e) => {
      if (lpTriggered) { e.preventDefault(); e.stopPropagation(); lpTriggered = false; }
    }, true);
  }

  return el;
}

/**
 * Render a single card element.
 */
function renderCard(card, index, total, arrangement, deckInfo, callbacks, cardScale = 1) {
  const el = document.createElement('div');
  el.className = 'card' + (card.faceUp ? ' face-up' : ' face-down');
  el.dataset.cardId = card.id;

  // Position within place based on arrangement (scaled)
  const offsetX = index * (arrangement.spreadX || 0) * cardScale;
  const offsetY = index * (arrangement.spreadY || 0) * cardScale;
  const offsetAngle = index * (arrangement.spreadAngle || 0);

  let transform = '';
  if (offsetX || offsetY) transform += `translate(${offsetX}px, ${offsetY}px)`;
  if (offsetAngle) transform += ` rotate(${offsetAngle}deg)`;
  if (transform) el.style.transform = transform;

  // Higher index = on top of the stack
  el.style.zIndex = index;

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
/**
 * Compute the bounding box of a set of locations.
 */
function computeBounds(locations) {
  if (locations.length === 0) return { minX: 0, maxX: 100, minY: 0, maxY: 100 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const loc of locations) {
    if (loc.x < minX) minX = loc.x;
    if (loc.x > maxX) maxX = loc.x;
    if (loc.y < minY) minY = loc.y;
    if (loc.y > maxY) maxY = loc.y;
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Compute how far a place's cards extend from its anchor point (in pixels).
 */
function computePlaceExtent(place, cardScale) {
  const config = place.config || {};
  const arrangement = config.arrangement || { spreadX: 0, spreadY: 0 };
  const cardCount = place.cards?.length || 0;
  const n = Math.max(0, cardCount - 1);
  return {
    extentX: n * Math.abs(arrangement.spreadX || 0) * cardScale + 50 * cardScale,
    extentY: n * Math.abs(arrangement.spreadY || 0) * cardScale + 70 * cardScale,
  };
}

/**
 * Compute bounds that account for place extents, ensuring cards don't overflow the container.
 * Returns an adjusted bounds object with extra padding for the bottom/right.
 */
function computeBoundsWithExtents(locations, extents, container, cardScale) {
  if (locations.length === 0) return { minX: 0, maxX: 100, minY: 0, maxY: 100 };

  const containerW = container.clientWidth || window.innerWidth;
  const containerH = container.clientHeight || window.innerHeight;

  // Find the maximum extent among places at the bottom/right edges
  let maxExtentY = 70 * cardScale; // at minimum, one card height
  let maxExtentX = 50 * cardScale;
  for (const ext of extents) {
    if (ext.extentY > maxExtentY) maxExtentY = ext.extentY;
    if (ext.extentX > maxExtentX) maxExtentX = ext.extentX;
  }

  // Convert extents to percentage of container to determine padding
  const padBottom = (maxExtentY / containerH) * 100;
  const padRight = (maxExtentX / containerW) * 100;
  // Also pad top/left for the card center offset
  const padTop = (35 * cardScale / containerH) * 100;
  const padLeft = (25 * cardScale / containerW) * 100;

  const baseBounds = computeBounds(locations);

  // Return bounds that position uses — we shrink the usable area to account for overflow
  return {
    ...baseBounds,
    padTop: Math.min(padTop + 2, 15),
    padBottom: Math.min(padBottom + 2, 40),
    padLeft: Math.min(padLeft + 2, 15),
    padRight: Math.min(padRight + 2, 25),
  };
}

function positionElement(el, location, bounds) {
  if (!location) return;
  el.style.position = 'absolute';

  // Determine usable area (accounting for card extent padding)
  const padTop = bounds.padTop || 5;
  const padBottom = bounds.padBottom || 5;
  const padLeft = bounds.padLeft || 5;
  const padRight = bounds.padRight || 5;
  const usableX = 100 - padLeft - padRight;
  const usableY = 100 - padTop - padBottom;

  let normX, normY;
  if (bounds.maxX > bounds.minX || bounds.maxY > bounds.minY) {
    const rangeX = bounds.maxX - bounds.minX || 1;
    const rangeY = bounds.maxY - bounds.minY || 1;
    normX = bounds.maxX === bounds.minX ? 50 : padLeft + ((location.x - bounds.minX) / rangeX) * usableX;
    normY = bounds.maxY === bounds.minY ? 50 : padTop + ((location.y - bounds.minY) / rangeY) * usableY;
  } else {
    normX = 50;
    normY = 50;
  }
  el.style.left = `${normX}%`;
  el.style.top = `${normY}%`;
  // Prepend centering translate to any existing transform (e.g. rotation)
  const existing = el.style.transform || '';
  el.style.transform = `translate(-50%, -50%) ${existing}`.trim();
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
