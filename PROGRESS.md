# Deckspace — Progress So Far

## What is Deckspace?

A serverless multiplayer mobile web game that simulates card decks on a table. Players load a JSON setup file defining places and a JSON deck file defining cards, then play any card game by moving cards between places. Host-authoritative via PeerJS (WebRTC).

## Key documents

- `prompt.md` — Original requirements/spec
- `design.md` — Detailed design decisions (refined through Q&A)
- `schemas/deck.schema.json` + `schemas/setup.schema.json` — Formal JSON schemas

## What's been built (all phases complete)

### Phase 1: Foundation ✓
- Vite + vanilla JS project scaffolding
- GitHub Pages deploy workflow
- Standard 52-card deck with inline SVG faces (`public/samples/standard-deck.json`, generated via `scripts/generate-deck.js`)
- Rummy setup (`public/samples/rummy-setup.json`) — 2-4 players, draw pile, discard, hands, melds
- Klondike Solitaire setup (`public/samples/klondike-setup.json`) — 1 player, stock, waste, foundations, tableaux

### Phase 2: Core Engine ✓
- `src/loader.js` — Fetches setup + deck files, resolves includes (circular ref detection), resolves sets (filter by tags, sort/shuffle, take N), validates structure
- `src/state.js` — Game state model (`GameState` with `Map<placeId, Place>`). Mutations: `moveCards`, `flipCards`, `clonePlace`. Supports: shuffle-on-arrival, topFaceUp auto-flip, permission checking (`canPlayerAccess`), checksum for desync detection
- `src/view.js` — Per-player visibility filtering (hides face-down card identities in non-owned places). Delta computation for efficient network updates
- `src/network.js` — PeerJS star topology. Host creates session, guests connect. Auto-reconnect with exponential backoff (up to 10 attempts). Player tokens in sessionStorage for identity persistence

### Phase 3: UI ✓
- `src/screens.js` + `src/navigation.js` — Full lobby flow: splash → host (enter setup URL) → session (QR code + link) → game. Join via QR scan or session code dropdowns. Recent URL history cached in localStorage
- `src/board.js` — DOM-based game board. Top half: global + other players' places (rotated as if around a table). Bottom half: player's own places. Cards rendered as `<img>` with CSS transforms for arrangement spreads
- `src/interaction.js` — Tap place to zoom in, tap cards to select (multi-select supported), action bar with Move/Flip Up/Flip Down/Select All/Back. Move flow: select cards → tap Move → tap destination place
- `index.html` — Mobile-first dark theme, green felt game board, card styling with default cross-hatch back pattern, action bar fixed at bottom

### Phase 4: Polish ✓
- Default card back: CSS cross-hatch pattern (`.card-default-back`)
- Lazy image loading: `img.loading='lazy'` + `onerror` fallback showing card tags as text
- Reconnection: guest auto-reconnects, host sends full state on reconnect, UI shows "Reconnecting..." status

## Architecture at a glance

```
Host loads setup → creates GameState → broadcasts personalized views to guests
Guests send action requests → Host validates permissions → mutates state → broadcasts deltas
```

- Place IDs: `global:<name>`, `player:<peerId>:<name>`
- Cards: `{ id, deckIndex, faceUp }`
- Network messages: `join`, `players`, `start`, `state` (full), `delta` (changes only), `action`

## What's NOT yet done / known gaps

1. **Not tested end-to-end with a real hosted setup file** — needs `npm run dev` and a setup URL served somewhere (could use GitHub raw URLs for the samples)
2. ~~**"Ask" prompts**~~ ✓ — When arrivalLocation or arrivalFlip is "ask", a modal dialog prompts the user to choose (with cancel support)
3. **Place cloning UI** — the backend supports it but there's no long-press gesture to trigger it
4. ~~**Overview layout scaling**~~ ✓ — Viewport-aware card sizing via `computeCardScale()` and CSS variable `--card-scale`; adapts to screen size and place density
5. **Touch gestures** — no pinch-to-zoom or pan on the overview yet
6. ~~**Place labels**~~ ✓ — Place names are now always visible in the overview (shown below each place)
7. **Undo** — design says nice-to-have; state is mutated in place (would need to snapshot before each mutation)
8. **Game initialization dealing** — for Rummy, players need to manually draw their opening hand from the draw pile (no auto-deal logic beyond startingSet)
9. ~~**Destination picker UX**~~ ✓ — Now shows a spatial board with places at their configured positions as tappable buttons (name + card count)
10. **No tests** — all code is untested beyond build verification

## How to run

```sh
npm install    # already done
npm run dev    # local dev server with HTTPS (needed for WebRTC)
npm run build  # production build to dist/
```

## Key design decisions (refer to design.md for full details)

- Host-authoritative (not p2p state sync)
- DOM-based rendering (not canvas)
- No turn enforcement — players self-regulate
- Uniform card sizes within a game
- No per-player:player places (dropped for v1)
- shuffleOnArrival on destination places instead of manual shuffle button
- Tap-to-select interaction (no drag-and-drop)
- Permissions via `othersCanMoveIn`/`othersCanMoveOut` flags on places


## TODO:

Need to handle dynamic resizing on desktop? - maybe not actually - it is mobile first!

## UX Redesign — "Hand" Concept

Replacing the previous zoom-select-move flow with a simpler physical metaphor:

### Overview (the only view — no zoom mode)

All places are always visible on screen. Interaction is:

1. **Tap a card** in any place → that card + all cards on top of it move to your **hand** (a strip along the bottom of the screen). Cards are visibly removed from the source place. Order is retained.
2. **Hand strip** shows held cards fanned out horizontally (x-offset only, no rotation). Evenly spaced to fit the screen width.
3. **Tap a card in your hand** → flip it (face-up ↔ face-down).
4. **Tap-and-hold a card in your hand** → inspect it fullscreen. Tap anywhere to exit.
5. **Tap-and-hold any place** → deposit ALL hand cards into that place (arrival rules apply: position, flip, shuffle).
6. **Cancel button** (corner of hand strip) → return all cards to their source place in original position.

### Benefits over previous zoom/select/move flow

- No mode switching — always in the overview
- Better spatial awareness — you can see the whole board while deciding where to put cards
- Fewer taps for common operations
- Physical metaphor: pick up → put down
- Simpler code: only two states (hand empty, hand holding cards)

### "Ask" prompts

If a destination place has `arrivalLocation: "ask"` or `arrivalFlip: "ask"`, the prompt dialog appears after the tap-hold deposit gesture.

### Permissions

- Picking up: only from places where the player has move-out access
- Depositing: only places where the player has move-in access respond to tap-hold
- Places that don't allow the action simply don't respond to the gesture

### Multiplayer visibility

- The hand is a client-side "in transit" zone — cards are immediately removed from the source place on the host state (so other players can't take them simultaneously)
- Other players see the cards disappear from the source but don't see what's in your hand

### Future considerations (deferred)

- Rotation/flip states (e.g. tapped cards in MTG): more than just faceUp/faceDown
- Splitting the hand: returning only some cards (for now, cancel returns all)

## notes
1. Should flips be resolved in places (e.g. top card face up in a pile) only after your hand is empty? Discuss
3. We might need to rethink the layout logic. This should be a discussion.
   - For layout, places should include their labels, so we layout a container with both the place and the label to ensure the label is visible.
   - Color coding places that belong to other players would be good (perhaps an additional, thicker, colored border), rather than rotating them I think - that simplifies layout.
   - I'm not sure if the 'setup' specifying the layout is good? If it is, we aren't fully respecting it, the layout is different on different sized screens.
     - Perhaps most places won't specify a location at all, and the app can lay them out in a more natural webpage-like way, this allows us to minimise the unused space on screen (important on mobile). 
     - Perhaps a few places should specify e.g. "I want to be abutting the left edge of place 'x'", so that games that care about placement can specify it.
       - In general though, the places in card games are significant for their role, not their location? (challenge this if you think it is wrong!)
     - I don't know if we can get away from needing to dynamically size the game view - in some games the tableau is a fixed number of places, in others (e.g. 'Arboretum') the tableau is dynamic and we should maybe support recursive subplaces so that users can build up ever expanding tableaus.
     - If we require dynamic sizing (we might also need/want it for offset stacks that grow large) should there be some sort of zoom feature? A well spread game might require each card/place to be rendered quite small to fit is all on a mobile screen.
