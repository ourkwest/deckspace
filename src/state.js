// Game state model and mutation functions
// Host-authoritative: only the host mutates state.

/**
 * @typedef {Object} Card
 * @property {string} id - Unique identifier (e.g. "card-0", "card-51")
 * @property {number} deckIndex - Index in the resolved deck's card list
 * @property {boolean} faceUp - Whether card is face-up
 */

/**
 * @typedef {Object} PlaceState
 * @property {string} id - Unique place identifier
 * @property {Card[]} cards - Ordered list, index 0 = bottom
 * @property {Object} config - Immutable config from setup
 */

/**
 * @typedef {Object} GameState
 * @property {Map<string, PlaceState>} places
 * @property {string[]} playerIds - Ordered player IDs
 * @property {number} version - Increments on each mutation
 */

/**
 * Create initial game state from a loaded setup and deck.
 * @param {Object} setup - Raw setup JSON
 * @param {import('./loader.js').LoadedDeck} deck
 * @param {string[]} playerIds
 * @returns {GameState}
 */
export function createGameState(setup, deck, playerIds) {
  const places = new Map();
  let nextCardId = 0;

  // Track which cards have been dealt to avoid duplicates
  const dealtCards = new Set();

  function makeCard(deckIndex) {
    const id = `card-${nextCardId++}`;
    dealtCards.add(deckIndex);
    return { id, deckIndex, faceUp: false };
  }

  function dealSet(setName, count) {
    const set = deck.sets.get(setName);
    if (!set) return [];
    let available = set.cardIndices.filter(i => !dealtCards.has(i));
    if (count != null && count < available.length) {
      available = available.slice(0, count);
    }
    return available.map(i => makeCard(i));
  }

  function applyDefaultFlip(cards, defaultFlip) {
    for (let i = 0; i < cards.length; i++) {
      if (defaultFlip === 'faceUp') {
        cards[i].faceUp = true;
      } else if (defaultFlip === 'faceDown') {
        cards[i].faceUp = false;
      } else if (defaultFlip === 'topFaceUp') {
        cards[i].faceUp = (i === cards.length - 1);
      }
    }
    return cards;
  }

  function placeDefaults(config) {
    return {
      arrangement: { spreadX: 0, spreadY: 0, spreadAngle: 0, ...config.arrangement },
      defaultFlip: config.defaultFlip || 'faceDown',
      arrivalLocation: config.arrivalLocation || 'top',
      arrivalFlip: config.arrivalFlip || 'asIs',
      shuffleOnArrival: config.shuffleOnArrival || false,
      cardLimit: config.cardLimit || null,
      cloneLimit: config.cloneLimit || 1,
      othersCanMoveIn: config.othersCanMoveIn,
      othersCanMoveOut: config.othersCanMoveOut,
      visibleToOtherPlayers: config.visibleToOtherPlayers,
    };
  }

  // Create global places
  for (const placeDef of (setup.globalPlaces || [])) {
    const id = `global:${placeDef.name}`;
    const config = { ...placeDef, ...placeDefaults(placeDef), othersCanMoveIn: placeDef.othersCanMoveIn ?? true, othersCanMoveOut: placeDef.othersCanMoveOut ?? true };
    let cards = [];
    if (placeDef.startingSet) {
      cards = dealSet(placeDef.startingSet, placeDef.startingCount);
      applyDefaultFlip(cards, config.defaultFlip);
    }
    places.set(id, { id, cards, config });
  }

  // Create per-player places
  for (const playerId of playerIds) {
    for (const placeDef of (setup.playerPlaces || [])) {
      const id = `player:${playerId}:${placeDef.name}`;
      const config = { ...placeDef, ...placeDefaults(placeDef), owner: playerId, othersCanMoveIn: placeDef.othersCanMoveIn ?? false, othersCanMoveOut: placeDef.othersCanMoveOut ?? false, visibleToOtherPlayers: placeDef.visibleToOtherPlayers ?? false };
      let cards = [];
      if (placeDef.startingSet) {
        cards = dealSet(placeDef.startingSet, placeDef.startingCount);
        applyDefaultFlip(cards, config.defaultFlip);
      }
      places.set(id, { id, cards, config });
    }
  }

  return { places, playerIds, version: 0 };
}

// --- Mutations ---
// All mutations return a delta object describing the change.

/**
 * Move cards from one place to another.
 * @param {GameState} state
 * @param {string[]} cardIds - IDs of cards to move
 * @param {string} fromPlaceId
 * @param {string} toPlaceId
 * @param {'top'|'bottom'} position - Where to insert in destination
 * @param {'faceUp'|'faceDown'|'asIs'} flip - How to flip on arrival
 * @returns {{type: string, cardIds: string[], from: string, to: string}|null}
 */
export function moveCards(state, cardIds, fromPlaceId, toPlaceId, position = 'top', flip = 'asIs') {
  const from = state.places.get(fromPlaceId);
  const to = state.places.get(toPlaceId);
  if (!from || !to) return null;

  // Extract cards in order
  const cardIdSet = new Set(cardIds);
  const moving = [];
  from.cards = from.cards.filter(c => {
    if (cardIdSet.has(c.id)) {
      moving.push(c);
      return false;
    }
    return true;
  });

  if (moving.length === 0) return null;

  // Apply arrival flip
  const arrivalFlip = flip !== 'asIs' ? flip : to.config.arrivalFlip;
  for (const card of moving) {
    if (arrivalFlip === 'faceUp') card.faceUp = true;
    else if (arrivalFlip === 'faceDown') card.faceUp = false;
    // 'asIs' leaves unchanged
  }

  // Insert at position
  if (position === 'top') {
    to.cards.push(...moving);
  } else {
    to.cards.unshift(...moving);
  }

  // Shuffle on arrival
  if (to.config.shuffleOnArrival) {
    shuffleArray(to.cards);
  }

  // Apply topFaceUp logic if destination uses it
  if (to.config.defaultFlip === 'topFaceUp') {
    for (let i = 0; i < to.cards.length; i++) {
      to.cards[i].faceUp = (i === to.cards.length - 1);
    }
  }

  // Same for source if it uses topFaceUp
  if (from.config.defaultFlip === 'topFaceUp' && from.cards.length > 0) {
    for (let i = 0; i < from.cards.length; i++) {
      from.cards[i].faceUp = (i === from.cards.length - 1);
    }
  }

  state.version++;

  return {
    type: 'move',
    cardIds: moving.map(c => c.id),
    from: fromPlaceId,
    to: toPlaceId,
    position,
    version: state.version,
  };
}

/**
 * Flip cards face-up or face-down.
 * @param {GameState} state
 * @param {string[]} cardIds
 * @param {string} placeId
 * @param {boolean} faceUp
 * @returns {{type: string}|null}
 */
export function flipCards(state, cardIds, placeId, faceUp) {
  const place = state.places.get(placeId);
  if (!place) return null;

  const cardIdSet = new Set(cardIds);
  let changed = false;

  for (const card of place.cards) {
    if (cardIdSet.has(card.id) && card.faceUp !== faceUp) {
      card.faceUp = faceUp;
      changed = true;
    }
  }

  if (!changed) return null;
  state.version++;

  return {
    type: 'flip',
    cardIds,
    placeId,
    faceUp,
    version: state.version,
  };
}

/**
 * Clone a place (if cloneLimit allows).
 * @param {GameState} state
 * @param {string} placeId
 * @returns {{type: string}|null}
 */
export function clonePlace(state, placeId) {
  const place = state.places.get(placeId);
  if (!place) return null;

  // Count existing clones
  const baseId = placeId.replace(/#\d+$/, '');
  let count = 0;
  for (const id of state.places.keys()) {
    if (id === baseId || id.startsWith(baseId + '#')) count++;
  }

  if (count >= (place.config.cloneLimit || 1)) return null;

  const newId = `${baseId}#${count}`;
  const newPlace = {
    id: newId,
    cards: [],
    config: { ...place.config },
  };
  state.places.set(newId, newPlace);
  state.version++;

  return {
    type: 'clone',
    sourceId: placeId,
    newId,
    version: state.version,
  };
}

/**
 * Check if a player can move cards from/to a place.
 * @param {PlaceState} place
 * @param {string} playerId
 * @param {'in'|'out'} direction
 * @returns {boolean}
 */
export function canPlayerAccess(place, playerId, direction) {
  const config = place.config;
  const isOwner = config.owner === playerId || !config.owner;

  if (isOwner) return true;

  if (direction === 'in') return config.othersCanMoveIn ?? false;
  if (direction === 'out') return config.othersCanMoveOut ?? false;
  return false;
}

/**
 * Compute a checksum of the game state for desync detection.
 * @param {GameState} state
 * @returns {number}
 */
export function computeChecksum(state) {
  let hash = 0;
  for (const [placeId, place] of state.places) {
    for (let i = 0; i < placeId.length; i++) {
      hash = ((hash << 5) - hash + placeId.charCodeAt(i)) | 0;
    }
    for (const card of place.cards) {
      hash = ((hash << 5) - hash + card.deckIndex) | 0;
      hash = ((hash << 5) - hash + (card.faceUp ? 1 : 0)) | 0;
    }
  }
  return hash;
}

/**
 * Serialize game state for network transmission.
 * @param {GameState} state
 * @returns {Object}
 */
export function serializeState(state) {
  const places = {};
  for (const [id, place] of state.places) {
    places[id] = {
      cards: place.cards.map(c => ({ id: c.id, deckIndex: c.deckIndex, faceUp: c.faceUp })),
    };
  }
  return { places, version: state.version, checksum: computeChecksum(state) };
}

/**
 * Deserialize game state received from host.
 * @param {Object} data
 * @param {GameState} existingState - Local state with config
 * @returns {GameState}
 */
export function deserializeState(data, existingState) {
  for (const [id, placeData] of Object.entries(data.places)) {
    const place = existingState.places.get(id);
    if (place) {
      place.cards = placeData.cards;
    }
  }
  existingState.version = data.version;
  return existingState;
}

// --- Utilities ---

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
