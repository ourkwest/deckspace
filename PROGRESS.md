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
- Standard 52-card deck with inline SVG faces (`samples/standard-deck.json`, generated via `scripts/generate-deck.js`)
- Rummy setup (`samples/rummy-setup.json`) — 2-4 players, draw pile, discard, hands, melds
- Klondike Solitaire setup (`samples/klondike-setup.json`) — 1 player, stock, waste, foundations, tableaux

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
2. **"Ask" prompts** — when arrivalLocation or arrivalFlip is "ask", currently defaults to "top"/"asIs" instead of prompting the user
3. **Place cloning UI** — the backend supports it but there's no long-press gesture to trigger it
4. **Overview layout scaling** — places are positioned by percentage but card sizes don't scale to screen; needs viewport-aware sizing
5. **Touch gestures** — no pinch-to-zoom or pan on the overview yet
6. **Place labels** — design says show on zoom; the zoomed view shows the name, but overview doesn't show on hover (mobile has no hover)
7. **Undo** — design says nice-to-have; state is mutated in place (would need to snapshot before each mutation)
8. **Game initialization dealing** — for Rummy, players need to manually draw their opening hand from the draw pile (no auto-deal logic beyond startingSet)
9. **Destination picker UX** — currently shows a flat list; could show the spatial board with places highlighted instead
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
