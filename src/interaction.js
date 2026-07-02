// Interaction module — zoom, card selection, and action menu
// Handles: place zoom, multi-card select, move/flip actions

/**
 * @typedef {Object} InteractionState
 * @property {'overview'|'zoomed'|'selecting-destination'} mode
 * @property {string|null} zoomedPlaceId
 * @property {Set<string>} selectedCardIds
 * @property {string|null} actionPending - 'move' when waiting for destination
 */

/**
 * Create the interaction controller.
 * @param {Object} callbacks
 * @param {Function} callbacks.sendAction - Send action to host (or apply locally)
 * @param {Function} callbacks.getViewData - Get current view data
 * @param {Function} callbacks.getLocalPlayerId
 * @param {Function} callbacks.getDeckInfo
 * @param {Function} callbacks.rerender - Trigger a re-render
 * @returns {Object}
 */
export function createInteraction(callbacks) {
  const state = {
    mode: 'overview',
    zoomedPlaceId: null,
    selectedCardIds: new Set(),
    actionPending: null,
  };

  function getState() { return state; }

  function onPlaceTap(placeId) {
    if (state.mode === 'overview') {
      // Zoom into place
      state.mode = 'zoomed';
      state.zoomedPlaceId = placeId;
      state.selectedCardIds.clear();
      callbacks.rerender();
    } else if (state.mode === 'selecting-destination') {
      // Selected a destination place for move
      if (placeId !== state.zoomedPlaceId) {
        completeMove(placeId);
      }
    }
  }

  function onCardTap(cardId, placeId) {
    if (state.mode === 'overview') {
      // Zoom into the containing place
      state.mode = 'zoomed';
      state.zoomedPlaceId = placeId;
      state.selectedCardIds.clear();
      state.selectedCardIds.add(cardId);
      callbacks.rerender();
    } else if (state.mode === 'zoomed' && placeId === state.zoomedPlaceId) {
      // Toggle card selection
      if (state.selectedCardIds.has(cardId)) {
        state.selectedCardIds.delete(cardId);
      } else {
        state.selectedCardIds.add(cardId);
      }
      callbacks.rerender();
    }
  }

  function selectAll() {
    if (state.mode !== 'zoomed' || !state.zoomedPlaceId) return;
    const viewData = callbacks.getViewData();
    const place = viewData.places?.[state.zoomedPlaceId];
    if (place?.cards) {
      for (const card of place.cards) {
        state.selectedCardIds.add(card.id);
      }
    }
    callbacks.rerender();
  }

  function clearSelection() {
    state.selectedCardIds.clear();
    callbacks.rerender();
  }

  function startMove() {
    if (state.selectedCardIds.size === 0) return;
    state.mode = 'selecting-destination';
    state.actionPending = 'move';
    callbacks.rerender();
  }

  async function completeMove(destPlaceId) {
    const viewData = callbacks.getViewData();
    const destPlace = viewData.places?.[destPlaceId];
    const config = destPlace?.config || {};

    // Determine arrival position and flip
    const arrivalLocation = config.arrivalLocation || 'top';
    const arrivalFlip = config.arrivalFlip || 'asIs';

    let position = arrivalLocation;
    let flip = arrivalFlip;

    // Prompt user if arrival settings are 'ask'
    if (arrivalLocation === 'ask') {
      position = await showAskPrompt('Place cards on…', [
        { value: 'top', label: 'Top' },
        { value: 'bottom', label: 'Bottom' },
      ]);
      if (!position) {
        // User cancelled
        state.mode = 'zoomed';
        state.actionPending = null;
        callbacks.rerender();
        return;
      }
    }

    if (arrivalFlip === 'ask') {
      flip = await showAskPrompt('Flip cards…', [
        { value: 'faceUp', label: 'Face Up' },
        { value: 'faceDown', label: 'Face Down' },
        { value: 'asIs', label: 'As Is' },
      ]);
      if (!flip) {
        // User cancelled
        state.mode = 'zoomed';
        state.actionPending = null;
        callbacks.rerender();
        return;
      }
    }

    callbacks.sendAction({
      type: 'move',
      cardIds: [...state.selectedCardIds],
      from: state.zoomedPlaceId,
      to: destPlaceId,
      position,
      flip,
    });

    // Return to overview
    state.mode = 'overview';
    state.zoomedPlaceId = null;
    state.selectedCardIds.clear();
    state.actionPending = null;
    callbacks.rerender();
  }

  function flipSelected(faceUp) {
    if (state.selectedCardIds.size === 0 || !state.zoomedPlaceId) return;

    callbacks.sendAction({
      type: 'flip',
      cardIds: [...state.selectedCardIds],
      placeId: state.zoomedPlaceId,
      faceUp,
    });

    state.selectedCardIds.clear();
    callbacks.rerender();
  }

  function cancelAction() {
    if (state.mode === 'selecting-destination') {
      state.mode = 'zoomed';
      state.actionPending = null;
    } else if (state.mode === 'zoomed') {
      state.mode = 'overview';
      state.zoomedPlaceId = null;
      state.selectedCardIds.clear();
    }
    callbacks.rerender();
  }

  function clonePlace(placeId) {
    callbacks.sendAction({ type: 'clone', placeId });
  }

  return {
    getState,
    onPlaceTap,
    onCardTap,
    selectAll,
    clearSelection,
    startMove,
    flipSelected,
    cancelAction,
    clonePlace,
  };
}

/**
 * Show a modal prompt with choices. Returns a Promise that resolves to the
 * selected value or null if cancelled.
 * @param {string} title
 * @param {{value: string, label: string}[]} options
 * @returns {Promise<string|null>}
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
 * Render the action bar (shown when zoomed into a place with selected cards).
 * @param {InteractionState} interactionState
 * @param {Object} interaction - The interaction controller
 * @returns {string} HTML string
 */
export function renderActionBar(interactionState, interaction) {
  if (interactionState.mode === 'selecting-destination') {
    return `
      <div class="action-bar selecting">
        <span class="action-hint">Tap a destination place</span>
        <button class="action-btn" data-action="cancel">Cancel</button>
      </div>
    `;
  }

  if (interactionState.mode !== 'zoomed') return '';

  const hasSelection = interactionState.selectedCardIds.size > 0;

  return `
    <div class="action-bar">
      <button class="action-btn" data-action="back">← Back</button>
      <button class="action-btn" data-action="select-all">All</button>
      ${hasSelection ? `
        <button class="action-btn primary" data-action="move">Move (${interactionState.selectedCardIds.size})</button>
        <button class="action-btn" data-action="flip-up">Flip ↑</button>
        <button class="action-btn" data-action="flip-down">Flip ↓</button>
      ` : ''}
    </div>
  `;
}

/**
 * Bind action bar button events.
 * @param {HTMLElement} container
 * @param {Object} interaction
 */
export function bindActionBar(container, interaction) {
  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'back' || action === 'cancel') interaction.cancelAction();
      else if (action === 'select-all') interaction.selectAll();
      else if (action === 'move') interaction.startMove();
      else if (action === 'flip-up') interaction.flipSelected(true);
      else if (action === 'flip-down') interaction.flipSelected(false);
    });
  });
}
