// Game board renderer — flex-based group layout
// Layout hierarchy: Board → Sections (table/player) → Groups → Places → Cards

/**
 * @typedef {Object} BoardLayout
 * @property {HTMLElement} container
 * @property {HTMLElement} tableArea - Top section (global + other players)
 * @property {HTMLElement} playerArea - Bottom section (own places)
 */

const BASE_CARD_W = 50;
const BASE_CARD_H = 70;
const MIN_CARD_W = 35;
const MAX_CARD_W = 120;

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
 * @param {Object} viewData - { places: { id: { cards, config } } }
 * @param {string} localPlayerId
 * @param {string[]} allPlayerIds
 * @param {Object} deckInfo - { size, back, cards }
 * @param {Map<string,string>} playerNames - peerId -> display name
 * @param {Object} callbacks - { onPlaceTap, onCardTap, onPlaceLongPress }
 */
export function renderBoard(layout, viewData, localPlayerId, allPlayerIds, deckInfo, playerNames, callbacks) {
  const { tableArea, playerArea } = layout;

  // Get setup from the first place's config (all configs share the same raw setup reference)
  const setup = getSetupFromView(viewData);

  // Categorize places
  const globalPlaces = [];
  const ownPlaces = [];
  const otherPlayerPlaces = new Map(); // peerId -> places[]

  for (const [id, placeData] of Object.entries(viewData.places || {})) {
    const entry = { id, ...placeData, config: placeData.config || {} };

    if (id.startsWith('global:')) {
      globalPlaces.push(entry);
    } else if (id.startsWith('player:')) {
      const owner = id.split(':')[1];
      if (owner === localPlayerId) {
        ownPlaces.push(entry);
      } else {
        if (!otherPlayerPlaces.has(owner)) otherPlayerPlaces.set(owner, []);
        otherPlayerPlaces.get(owner).push(entry);
      }
    }
  }

  // Compute card scale
  const cardScale = computeCardScale(layout.container, globalPlaces, ownPlaces, otherPlayerPlaces, setup);

  // Render table area (global groups + other players' visible groups)
  renderTableSection(tableArea, globalPlaces, otherPlayerPlaces, allPlayerIds, localPlayerId, setup, deckInfo, callbacks, cardScale, playerNames);

  // Render player area (own groups)
  renderPlayerSection(playerArea, ownPlaces, setup, deckInfo, callbacks, cardScale);

  // Show/hide sections based on content
  const hasTable = tableArea.children.length > 0;
  const hasPlayer = playerArea.children.length > 0;
  tableArea.style.display = hasTable ? '' : 'none';
  playerArea.style.display = hasPlayer ? '' : 'none';
}

/**
 * Extract setup info from view data (groups are attached via config).
 */
function getSetupFromView(viewData) {
  // Try to find the raw setup reference from any place's config
  for (const place of Object.values(viewData.places || {})) {
    if (place.config?._setup) return place.config._setup;
  }
  return null;
}

/**
 * Compute card scale factor to fit all content on screen.
 */
function computeCardScale(container, globalPlaces, ownPlaces, otherPlayerPlaces, setup) {
  const vw = container.clientWidth || window.innerWidth;
  const vh = (container.clientHeight || window.innerHeight) - 80; // minus hand strip

  const globalGroups = setup?.globalGroups || [];
  const playerGroups = setup?.playerGroups || [];

  // With row-first wrapping, the constraint is:
  // - Horizontally: all groups in a row must fit side by side (until they wrap)
  // - Vertically: each section (table/player) gets ~half the height

  // Find total places in the widest single group
  let maxGroupPlaces = 1;
  for (const group of [...globalGroups, ...playerGroups]) {
    if (group.direction !== 'column') {
      maxGroupPlaces = Math.max(maxGroupPlaces, group.places.length);
    }
  }

  // Find max card spread height (for vertical spreads like tableau columns)
  let maxSpreadH = BASE_CARD_H;
  const allPlaces = [...globalPlaces, ...ownPlaces];
  for (const [, places] of otherPlayerPlaces) allPlaces.push(...places);
  for (const place of allPlaces) {
    const spreadY = Math.abs(place.config?.arrangement?.spreadY || 0);
    const cardCount = place.cards?.length || 0;
    const stackH = BASE_CARD_H + spreadY * Math.max(0, cardCount - 1);
    maxSpreadH = Math.max(maxSpreadH, stackH);
  }

  // Each section gets roughly half the viewport height
  const sectionHeight = vh / 2;

  // Scale to fit the tallest stack within a section (with room for label + padding)
  const scaleByHeight = (sectionHeight - 30) / maxSpreadH;

  // Scale to fit the widest group horizontally
  const gapPerPlace = 12;
  const neededWidth = maxGroupPlaces * (BASE_CARD_W + gapPerPlace);
  const scaleByWidth = (vw - 32) / neededWidth;

  const scale = Math.min(scaleByWidth, scaleByHeight);

  // Clamp
  const minScale = MIN_CARD_W / BASE_CARD_W;
  const maxScale = MAX_CARD_W / BASE_CARD_W;
  return Math.max(minScale, Math.min(maxScale, scale));
}

/**
 * Render the table section (global groups + other players).
 */
function renderTableSection(container, globalPlaces, otherPlayerPlaces, allPlayerIds, localPlayerId, setup, deckInfo, callbacks, cardScale, playerNames) {
  container.innerHTML = '';

  // Render global groups
  const globalGroups = setup?.globalGroups || [];
  const renderedGlobalNames = new Set();

  for (const groupDef of globalGroups) {
    const groupEl = renderGroup(groupDef, globalPlaces, 'global', deckInfo, callbacks, cardScale);
    container.appendChild(groupEl);
    for (const name of groupDef.places) renderedGlobalNames.add(name);
  }

  // Render ungrouped global places as implicit single-place groups
  for (const place of globalPlaces) {
    const name = place.id.split(':').pop();
    if (!renderedGlobalNames.has(name)) {
      const groupEl = renderGroup(
        { name, direction: 'row', places: [name] },
        globalPlaces, 'global', deckInfo, callbacks, cardScale
      );
      container.appendChild(groupEl);
    }
  }

  // Render other players' visible places
  for (const [peerId, places] of otherPlayerPlaces) {
    if (places.length === 0) continue;

    const playerGroups = setup?.playerGroups || [];
    const playerGroupEl = document.createElement('div');
    playerGroupEl.className = 'board-player-section other-player';
    playerGroupEl.style.setProperty('--player-color', `hsl(${hashHue(peerId)}, 60%, 45%)`);

    // Player name label
    const playerLabel = document.createElement('div');
    playerLabel.className = 'player-label';
    playerLabel.textContent = playerNames?.get(peerId) || peerId;
    playerGroupEl.appendChild(playerLabel);

    const renderedNames = new Set();
    for (const groupDef of playerGroups) {
      // Only render groups that contain visible places
      const visibleInGroup = groupDef.places.filter(pName =>
        places.some(p => p.id.endsWith(':' + pName))
      );
      if (visibleInGroup.length === 0) continue;

      const adjustedGroupDef = { ...groupDef, places: visibleInGroup };
      const groupEl = renderGroup(adjustedGroupDef, places, 'player', deckInfo, callbacks, cardScale);
      playerGroupEl.appendChild(groupEl);
      for (const name of visibleInGroup) renderedNames.add(name);
    }

    // Ungrouped visible places
    for (const place of places) {
      const name = place.id.split(':').pop();
      if (!renderedNames.has(name)) {
        const groupEl = renderGroup(
          { name, direction: 'row', places: [name] },
          places, 'player', deckInfo, callbacks, cardScale
        );
        playerGroupEl.appendChild(groupEl);
      }
    }

    container.appendChild(playerGroupEl);
  }
}

/**
 * Render the player section (own groups).
 */
function renderPlayerSection(container, ownPlaces, setup, deckInfo, callbacks, cardScale) {
  container.innerHTML = '';

  const playerGroups = setup?.playerGroups || [];
  const renderedNames = new Set();

  for (const groupDef of playerGroups) {
    const groupEl = renderGroup(groupDef, ownPlaces, 'player', deckInfo, callbacks, cardScale);
    container.appendChild(groupEl);
    for (const name of groupDef.places) renderedNames.add(name);
  }

  // Ungrouped own places
  for (const place of ownPlaces) {
    const name = place.id.split(':').pop();
    if (!renderedNames.has(name)) {
      const groupEl = renderGroup(
        { name, direction: 'row', places: [name] },
        ownPlaces, 'player', deckInfo, callbacks, cardScale
      );
      container.appendChild(groupEl);
    }
  }
}

/**
 * Render a group container with its places.
 */
function renderGroup(groupDef, allPlaces, type, deckInfo, callbacks, cardScale) {
  const el = document.createElement('div');
  el.className = 'group';
  el.dataset.groupName = groupDef.name;
  if (groupDef.direction === 'column') {
    el.classList.add('group-column');
  }

  for (const placeName of groupDef.places) {
    // Find the place data — match by name suffix
    const place = allPlaces.find(p => {
      const pName = p.id.split(':').pop();
      return pName === placeName;
    });
    if (!place) continue;

    const placeEl = renderPlace(place, deckInfo, callbacks, cardScale);
    el.appendChild(placeEl);
  }

  return el;
}

/**
 * Render a single place with its cards and label.
 */
function renderPlace(place, deckInfo, callbacks, cardScale) {
  const el = document.createElement('div');
  el.className = 'place';
  el.dataset.placeId = place.id;
  el.style.setProperty('--card-scale', cardScale);

  const config = place.config || {};
  const arrangement = config.arrangement || { spreadX: 0, spreadY: 0, spreadAngle: 0 };

  // Cards container (relative positioning for spreads)
  const cardsContainer = document.createElement('div');
  cardsContainer.className = 'place-cards';

  const cards = place.cards || [];

  // Calculate place size based on card spread
  const spreadW = BASE_CARD_W * cardScale + Math.max(0, cards.length - 1) * Math.abs(arrangement.spreadX || 0) * cardScale;
  const spreadH = BASE_CARD_H * cardScale + Math.max(0, cards.length - 1) * Math.abs(arrangement.spreadY || 0) * cardScale;
  cardsContainer.style.width = `${Math.max(BASE_CARD_W * cardScale, spreadW)}px`;
  cardsContainer.style.height = `${Math.max(BASE_CARD_H * cardScale, spreadH)}px`;

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const cardEl = renderCard(card, i, cards.length, arrangement, deckInfo, callbacks, cardScale);
    cardsContainer.appendChild(cardEl);
  }

  // Empty place indicator
  if (cards.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'place-empty';
    cardsContainer.style.width = `${BASE_CARD_W * cardScale}px`;
    cardsContainer.style.height = `${BASE_CARD_H * cardScale}px`;
    cardsContainer.appendChild(empty);
  }

  el.appendChild(cardsContainer);

  // Place label
  const label = document.createElement('div');
  label.className = 'place-label';
  label.textContent = place.id.split(':').pop();
  el.appendChild(label);

  // Tap handler for place
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
function renderCard(card, index, total, arrangement, deckInfo, callbacks, cardScale) {
  const el = document.createElement('div');
  el.className = 'card' + (card.faceUp ? ' face-up' : ' face-down');
  el.dataset.cardId = card.id;

  // Position within place based on arrangement
  const offsetX = index * (arrangement.spreadX || 0) * cardScale;
  const offsetY = index * (arrangement.spreadY || 0) * cardScale;
  const offsetAngle = index * (arrangement.spreadAngle || 0);

  let transform = '';
  if (offsetX || offsetY) transform += `translate(${offsetX}px, ${offsetY}px)`;
  if (offsetAngle) transform += ` rotate(${offsetAngle}deg)`;
  if (transform) el.style.transform = transform;

  el.style.zIndex = index;

  // Card content
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

// --- Utilities ---

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

function hashHue(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

