// Interaction module — "Hand" metaphor UX
// Tap card to pick up, tap-hold place to deposit, tap hand card to flip

/**
 * @typedef {Object} InteractionState
 * @property {Array<{id: string, deckIndex: number, faceUp: boolean, source: string}>} hand - Cards currently held
 * @property {string|null} inspecting - Card ID being inspected fullscreen
 */

const LONG_PRESS_MS = 500;

/**
 * Create the interaction controller.
 * @param {Object} callbacks
 * @param {Function} callbacks.sendAction - Send action to host
 * @param {Function} callbacks.getViewData - Get current view data
 * @param {Function} callbacks.getLocalPlayerId
 * @param {Function} callbacks.getDeckInfo
 * @param {Function} callbacks.rerender - Trigger a re-render
 * @returns {Object}
 */
export function createInteraction(callbacks) {
  const state = {
    hand: [],       // { id, deckIndex, faceUp, source }
    inspecting: null,
    depositCooldown: false,
  };

  function getState() { return state; }

  /**
   * Pick up a card (and all cards above it) from a place into the hand.
   */
  function onCardTap(cardId, placeId) {
    // Ignore taps briefly after a deposit to prevent accidental pick-up
    if (state.depositCooldown) return;

    // If inspecting, exit inspection
    if (state.inspecting) {
      state.inspecting = null;
      callbacks.rerender();
      return;
    }

    // If tapping a card in the hand, flip it
    if (placeId === '__hand__') {
      const handIdx = state.hand.findIndex(c => c.id === cardId);
      if (handIdx !== -1) {
        state.hand[handIdx].faceUp = !state.hand[handIdx].faceUp;
        // Send flip action to host
        callbacks.sendAction({
          type: 'flip',
          cardIds: [cardId],
          placeId: '__hand__',
          faceUp: state.hand[handIdx].faceUp,
        });
        callbacks.rerender();
      }
      return;
    }

    // Pick up card and all cards above it from the place
    const viewData = callbacks.getViewData();
    const place = viewData.places?.[placeId];
    if (!place?.cards) return;

    // Check move-out permission
    const config = place.config || {};
    const localId = callbacks.getLocalPlayerId();
    const isOwner = !config.owner || config.owner === localId;
    if (!isOwner && !(config.othersCanMoveOut ?? false)) return;

    const cardIndex = place.cards.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return;

    // Cards above = from cardIndex to end (index 0 = bottom, so "above" = higher index)
    const pickedCards = place.cards.slice(cardIndex);

    // Add to hand with source tracking
    state.hand.push(...pickedCards.map(c => ({ ...c, source: placeId })));

    // Send pick-up action to host (move cards to a virtual hand place)
    callbacks.sendAction({
      type: 'pickup',
      cardIds: pickedCards.map(c => c.id),
      from: placeId,
    });

    callbacks.rerender();
  }

  /**
   * Long-press on a card in the hand → inspect fullscreen.
   */
  function onHandCardLongPress(cardId) {
    state.inspecting = cardId;
    callbacks.rerender();
  }

  /**
   * Long-press on a place → deposit all hand cards there.
   */
  async function onPlaceLongPress(placeId) {
    if (state.hand.length === 0) return;

    const viewData = callbacks.getViewData();
    const destPlace = viewData.places?.[placeId];
    const config = destPlace?.config || {};

    // Check move-in permission
    const localId = callbacks.getLocalPlayerId();
    const isOwner = !config.owner || config.owner === localId;
    if (!isOwner && !(config.othersCanMoveIn ?? false)) return;

    // Determine arrival position and flip
    let position = config.arrivalLocation || 'top';
    let flip = config.arrivalFlip || 'asIs';

    // Prompt if 'ask'
    if (position === 'ask') {
      position = await showAskPrompt('Place cards on…', [
        { value: 'top', label: 'Top' },
        { value: 'bottom', label: 'Bottom' },
      ]);
      if (!position) return; // cancelled
    }

    if (flip === 'ask') {
      flip = await showAskPrompt('Flip cards…', [
        { value: 'faceUp', label: 'Face Up' },
        { value: 'faceDown', label: 'Face Down' },
        { value: 'asIs', label: 'As Is' },
      ]);
      if (!flip) return; // cancelled
    }

    callbacks.sendAction({
      type: 'deposit',
      cardIds: state.hand.map(c => c.id),
      to: placeId,
      position,
      flip,
    });

    // Clear hand and set cooldown
    state.hand = [];
    state.depositCooldown = true;
    setTimeout(() => { state.depositCooldown = false; }, 400);
    callbacks.rerender();
  }

  /**
   * Cancel — return all hand cards to their respective sources.
   */
  function cancel() {
    if (state.hand.length === 0) return;

    // Group cards by source
    const bySource = new Map();
    for (const card of state.hand) {
      const source = card.source || '__unknown__';
      if (!bySource.has(source)) bySource.set(source, []);
      bySource.get(source).push(card.id);
    }

    // Send deposit for each group
    for (const [source, cardIds] of bySource) {
      callbacks.sendAction({
        type: 'deposit',
        cardIds,
        to: source,
        position: 'top',
        flip: 'asIs',
      });
    }

    state.hand = [];
    state.depositCooldown = true;
    setTimeout(() => { state.depositCooldown = false; }, 400);
    callbacks.rerender();
  }

  /**
   * Exit fullscreen inspection.
   */
  function dismissInspect() {
    state.inspecting = null;
    callbacks.rerender();
  }

  return {
    getState,
    onCardTap,
    onHandCardLongPress,
    onPlaceLongPress,
    cancel,
    dismissInspect,
  };
}

/**
 * Show a modal prompt with choices.
 */
function showAskPrompt(title, options) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'ask-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'ask-dialog';

    const heading = document.createElement('div');
    heading.className = 'ask-title';
    heading.textContent = title;
    dialog.appendChild(heading);

    for (const opt of options) {
      const btn = document.createElement('button');
      btn.className = 'ask-option';
      btn.textContent = opt.label;
      btn.addEventListener('click', () => {
        overlay.remove();
        resolve(opt.value);
      });
      dialog.appendChild(btn);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ask-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });
    dialog.appendChild(cancelBtn);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  });
}

/**
 * Create a long-press detector for an element.
 * Returns a cleanup function.
 */
export function addLongPress(el, callback, duration = LONG_PRESS_MS) {
  let timer = null;
  let triggered = false;

  function start(e) {
    triggered = false;
    timer = setTimeout(() => {
      triggered = true;
      callback(e);
    }, duration);
  }

  function cancel() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function preventClick(e) {
    if (triggered) {
      e.preventDefault();
      e.stopPropagation();
      triggered = false;
    }
  }

  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointermove', (e) => {
    // Cancel if moved too far (prevents accidental long-press while scrolling)
    if (e.movementX > 5 || e.movementY > 5) cancel();
  });
  el.addEventListener('click', preventClick, true);

  return () => {
    el.removeEventListener('pointerdown', start);
    el.removeEventListener('pointerup', cancel);
    el.removeEventListener('pointerleave', cancel);
    el.removeEventListener('click', preventClick, true);
  };
}
