// Data file loader and validator
// Fetches setup + deck files, resolves includes, validates structure

/**
 * @typedef {Object} LoadedCard
 * @property {number} index - Index in the resolved deck
 * @property {string} face - Face image URL
 * @property {string|null} back - Back image URL or null
 * @property {Object<string, string|string[]>} tags - Card tags
 */

/**
 * @typedef {Object} ResolvedSet
 * @property {string} name
 * @property {number[]} cardIndices - Indices into the resolved card list
 */

/**
 * @typedef {Object} LoadedDeck
 * @property {string} name
 * @property {{width: number, height: number}} size
 * @property {string|null} back - Default back image URL
 * @property {LoadedCard[]} cards
 * @property {Map<string, ResolvedSet>} sets
 */

/**
 * @typedef {Object} LoadedSetup
 * @property {Object} raw - The raw parsed setup JSON
 * @property {LoadedDeck} deck - The resolved deck
 */

export class LoadError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'LoadError';
    this.details = details;
  }
}

/**
 * Load and validate a setup file from a URL.
 * @param {string} setupUrl
 * @returns {Promise<LoadedSetup>}
 */
export async function loadSetup(setupUrl) {
  const setup = await fetchJson(setupUrl);
  const errors = validateSetup(setup);
  if (errors.length > 0) {
    throw new LoadError('Invalid setup file', errors);
  }

  const deckUrl = resolveUrl(setup.deck, setupUrl);
  const deck = await loadDeck(deckUrl);

  // Validate that all referenced startingSets exist in the deck
  const allPlaces = [
    ...(setup.globalPlaces || []),
    ...(setup.playerPlaces || []),
  ];
  for (const place of allPlaces) {
    if (place.startingSet && !deck.sets.has(place.startingSet)) {
      throw new LoadError(`Place "${place.name}" references unknown set "${place.startingSet}"`);
    }
  }

  // Validate uniform card size (already enforced by deck being single-sized)
  return { raw: setup, deck };
}

/**
 * Load and resolve a deck file, including nested includes.
 * @param {string} deckUrl
 * @param {Set<string>} [visited] - For circular reference detection
 * @returns {Promise<LoadedDeck>}
 */
export async function loadDeck(deckUrl, visited = new Set()) {
  if (visited.has(deckUrl)) {
    throw new LoadError(`Circular deck include detected: ${deckUrl}`);
  }
  visited.add(deckUrl);

  const raw = await fetchJson(deckUrl);
  const errors = validateDeck(raw);
  if (errors.length > 0) {
    throw new LoadError(`Invalid deck file: ${deckUrl}`, errors);
  }

  const cards = [];
  const setDefs = [];

  for (const entry of raw.cards) {
    if (entry.face !== undefined) {
      // Card definition
      cards.push({
        index: cards.length,
        face: resolveUrl(entry.face, deckUrl),
        back: entry.back ? resolveUrl(entry.back, deckUrl) : null,
        tags: entry.tags || {},
      });
    } else if (entry.include !== undefined) {
      // Deck include
      const includeUrl = resolveUrl(entry.include, deckUrl);
      const includedDeck = await loadDeck(includeUrl, new Set(visited));
      const offset = cards.length;
      for (const card of includedDeck.cards) {
        cards.push({ ...card, index: cards.length });
      }
      // Import sets from included deck with offset
      for (const [name, set] of includedDeck.sets) {
        setDefs.push({
          name,
          source: raw.name,
          _resolved: set.cardIndices.map(i => i + offset),
        });
      }
    } else if (entry.name !== undefined && entry.source !== undefined) {
      // Set definition
      setDefs.push(entry);
    }
  }

  // Resolve sets
  const sets = new Map();
  for (const def of setDefs) {
    if (def._resolved) {
      // Already resolved from include
      sets.set(def.name, { name: def.name, cardIndices: def._resolved });
      continue;
    }

    // Filter cards by tags
    let indices = cards.map((_, i) => i);

    if (def.tags) {
      indices = indices.filter(i => {
        const card = cards[i];
        for (const [key, val] of Object.entries(def.tags)) {
          const cardVal = card.tags[key];
          if (Array.isArray(val)) {
            if (!val.includes(cardVal)) return false;
          } else {
            if (cardVal !== val) return false;
          }
        }
        return true;
      });
    }

    // Apply exclude
    if (def.exclude) {
      const excludeSet = new Set(def.exclude);
      indices = indices.filter(i => !excludeSet.has(i));
    }

    // Apply include (force-add)
    if (def.include) {
      const includeSet = new Set(def.include);
      const existing = new Set(indices);
      for (const i of def.include) {
        if (!existing.has(i) && i < cards.length) {
          indices.push(i);
        }
      }
    }

    // Sort or shuffle
    if (def.sort && def.sort.length > 0) {
      indices.sort((a, b) => {
        for (const key of def.sort) {
          const av = cards[a].tags[key] || '';
          const bv = cards[b].tags[key] || '';
          // Try numeric comparison first
          const an = parseFloat(av);
          const bn = parseFloat(bv);
          if (!isNaN(an) && !isNaN(bn)) {
            if (an !== bn) return an - bn;
          } else {
            const cmp = av.localeCompare(bv);
            if (cmp !== 0) return cmp;
          }
        }
        return 0;
      });
    } else {
      // Shuffle
      shuffleArray(indices);
    }

    // Take N
    if (def.take && def.take < indices.length) {
      indices = indices.slice(0, def.take);
    }

    sets.set(def.name, { name: def.name, cardIndices: indices });
  }

  return {
    name: raw.name,
    size: raw.size,
    back: raw.back || null,
    cards,
    sets,
  };
}

// --- Validation ---

function validateSetup(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') {
    errors.push('Setup must be a JSON object');
    return errors;
  }
  if (typeof obj.name !== 'string') errors.push('Missing or invalid "name"');
  if (typeof obj.deck !== 'string') errors.push('Missing or invalid "deck" URL');
  if (!obj.players || typeof obj.players.min !== 'number' || typeof obj.players.max !== 'number') {
    errors.push('Missing or invalid "players" (need min and max)');
  } else {
    if (obj.players.min < 1) errors.push('players.min must be >= 1');
    if (obj.players.max < obj.players.min) errors.push('players.max must be >= players.min');
  }

  const validatePlace = (place, prefix) => {
    if (typeof place.name !== 'string') errors.push(`${prefix}: missing "name"`);
    if (place.arrangement) {
      if (place.arrangement.spreadX !== undefined && typeof place.arrangement.spreadX !== 'number') {
        errors.push(`${prefix} "${place.name}": arrangement.spreadX must be a number`);
      }
    }
    if (place.defaultFlip && !['faceUp', 'faceDown', 'topFaceUp'].includes(place.defaultFlip)) {
      errors.push(`${prefix} "${place.name}": invalid defaultFlip`);
    }
    if (place.arrivalLocation && !['top', 'bottom', 'ask'].includes(place.arrivalLocation)) {
      errors.push(`${prefix} "${place.name}": invalid arrivalLocation`);
    }
    if (place.arrivalFlip && !['faceUp', 'faceDown', 'ask', 'asIs'].includes(place.arrivalFlip)) {
      errors.push(`${prefix} "${place.name}": invalid arrivalFlip`);
    }
  };

  const validateGroup = (group, prefix, validPlaceNames) => {
    if (typeof group.name !== 'string') errors.push(`${prefix}: missing "name"`);
    if (group.direction && !['row', 'column'].includes(group.direction)) {
      errors.push(`${prefix} "${group.name}": direction must be "row" or "column"`);
    }
    if (!Array.isArray(group.places)) {
      errors.push(`${prefix} "${group.name}": missing "places" array`);
    } else {
      for (const placeName of group.places) {
        if (!validPlaceNames.has(placeName)) {
          errors.push(`${prefix} "${group.name}": references unknown place "${placeName}"`);
        }
      }
    }
  };

  if (obj.globalPlaces) {
    if (!Array.isArray(obj.globalPlaces)) errors.push('"globalPlaces" must be an array');
    else obj.globalPlaces.forEach(p => validatePlace(p, 'globalPlace'));
  }
  if (obj.playerPlaces) {
    if (!Array.isArray(obj.playerPlaces)) errors.push('"playerPlaces" must be an array');
    else obj.playerPlaces.forEach(p => validatePlace(p, 'playerPlace'));
  }

  // Validate groups reference valid places
  if (obj.globalGroups) {
    const globalNames = new Set((obj.globalPlaces || []).map(p => p.name));
    if (!Array.isArray(obj.globalGroups)) errors.push('"globalGroups" must be an array');
    else obj.globalGroups.forEach(g => validateGroup(g, 'globalGroup', globalNames));
  }
  if (obj.playerGroups) {
    const playerNames = new Set((obj.playerPlaces || []).map(p => p.name));
    if (!Array.isArray(obj.playerGroups)) errors.push('"playerGroups" must be an array');
    else obj.playerGroups.forEach(g => validateGroup(g, 'playerGroup', playerNames));
  }

  return errors;
}

function validateDeck(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') {
    errors.push('Deck must be a JSON object');
    return errors;
  }
  if (typeof obj.name !== 'string') errors.push('Missing or invalid "name"');
  if (!obj.size || typeof obj.size.width !== 'number' || typeof obj.size.height !== 'number') {
    errors.push('Missing or invalid "size" (need width and height)');
  }
  if (!Array.isArray(obj.cards)) {
    errors.push('Missing or invalid "cards" array');
  } else {
    for (let i = 0; i < obj.cards.length; i++) {
      const entry = obj.cards[i];
      const isCard = entry.face !== undefined;
      const isInclude = entry.include !== undefined;
      const isSet = entry.name !== undefined && entry.source !== undefined;
      if (!isCard && !isInclude && !isSet) {
        errors.push(`cards[${i}]: must be a card (face), include, or set (name+source)`);
      }
    }
  }
  return errors;
}

// --- Utilities ---

async function fetchJson(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new LoadError(`Failed to fetch ${url}: ${resp.status} ${resp.statusText}`);
    }
    return await resp.json();
  } catch (err) {
    if (err instanceof LoadError) throw err;
    throw new LoadError(`Failed to fetch ${url}: ${err.message}`);
  }
}

function resolveUrl(relative, base) {
  // Handle data URIs and absolute URLs
  if (relative.startsWith('data:') || relative.startsWith('http://') || relative.startsWith('https://')) {
    return relative;
  }
  try {
    // If base is a relative path, make it absolute using page origin
    let absBase = base;
    if (base && !base.startsWith('http://') && !base.startsWith('https://') && !base.startsWith('data:')) {
      absBase = new URL(base, window.location.origin).href;
    }
    return new URL(relative, absBase).href;
  } catch {
    return relative;
  }
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
