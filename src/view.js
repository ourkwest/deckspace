// View computation — per-player visibility filtering
// The host computes what each player can see and sends only that.

/**
 * @typedef {Object} CardView
 * @property {string} id
 * @property {number|null} deckIndex - null if card is hidden (face-down in non-visible place)
 * @property {boolean} faceUp
 */

/**
 * @typedef {Object} PlaceView
 * @property {string} id
 * @property {CardView[]} cards
 * @property {Object} config - Place config (always visible)
 */

/**
 * Compute the game view for a specific player.
 * Hides card identities (deckIndex) for face-down cards in places the player shouldn't see.
 *
 * @param {import('./state.js').GameState} state
 * @param {string} playerId
 * @param {import('./loader.js').LoadedDeck} deck
 * @returns {Map<string, PlaceView>}
 */
export function computePlayerView(state, playerId, deck) {
  const view = new Map();

  for (const [placeId, place] of state.places) {
    const visibility = getPlaceVisibility(place, playerId);

    if (visibility === 'hidden') continue;

    const cardViews = place.cards.map(card => {
      if (visibility === 'full' || card.faceUp) {
        // Player can see this card's face
        return { id: card.id, deckIndex: card.deckIndex, faceUp: card.faceUp };
      } else {
        // Card is face-down in a place we can see but can't peek at
        return { id: card.id, deckIndex: null, faceUp: false };
      }
    });

    view.set(placeId, {
      id: placeId,
      cards: cardViews,
      config: place.config,
    });
  }

  return view;
}

/**
 * Determine how visible a place is to a player.
 * @param {import('./state.js').PlaceState} place
 * @param {string} playerId
 * @returns {'full'|'partial'|'hidden'}
 *   - full: player sees all card faces (own place, or global)
 *   - partial: player sees place exists and card positions, but face-down cards are hidden
 *   - hidden: player doesn't see this place at all
 */
function getPlaceVisibility(place, playerId) {
  const config = place.config;

  // Global places — always visible, partial (face-down cards stay hidden)
  if (!config.owner) {
    return 'partial';
  }

  // Own place — full visibility
  if (config.owner === playerId) {
    return 'full';
  }

  // Other player's place — depends on visibleToOtherPlayers
  if (config.visibleToOtherPlayers) {
    return 'partial';
  }

  return 'hidden';
}

/**
 * Serialize a player view for network transmission.
 * @param {Map<string, PlaceView>} view
 * @param {number} version
 * @returns {Object}
 */
export function serializeView(view, version) {
  const places = {};
  for (const [id, placeView] of view) {
    places[id] = {
      cards: placeView.cards,
      config: placeView.config,
    };
  }
  return { places, version };
}

/**
 * Compute a delta between two views (previous and current).
 * Returns only the places that changed.
 * @param {Object} prevSerialized - Previous serialized view
 * @param {Object} currSerialized - Current serialized view
 * @returns {Object|null} - Delta object or null if no changes
 */
export function computeViewDelta(prevSerialized, currSerialized) {
  const delta = { places: {}, version: currSerialized.version };
  let hasChanges = false;

  // Check for changed/added places
  for (const [id, currPlace] of Object.entries(currSerialized.places)) {
    const prevPlace = prevSerialized?.places?.[id];
    if (!prevPlace || JSON.stringify(prevPlace) !== JSON.stringify(currPlace)) {
      delta.places[id] = currPlace;
      hasChanges = true;
    }
  }

  // Check for removed places
  if (prevSerialized?.places) {
    for (const id of Object.keys(prevSerialized.places)) {
      if (!currSerialized.places[id]) {
        delta.places[id] = null; // null signals removal
        hasChanges = true;
      }
    }
  }

  return hasChanges ? delta : null;
}

/**
 * Apply a delta to a local view.
 * @param {Object} localView - Current local serialized view
 * @param {Object} delta - Delta from host
 * @returns {Object} - Updated view
 */
export function applyViewDelta(localView, delta) {
  const updated = { places: { ...localView.places }, version: delta.version };

  for (const [id, placeData] of Object.entries(delta.places)) {
    if (placeData === null) {
      delete updated.places[id];
    } else {
      updated.places[id] = placeData;
    }
  }

  return updated;
}
