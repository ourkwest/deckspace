# Deckspace — Design Decisions

## Architecture

**Stack:** Vite + vanilla JS (no framework), deployed to GitHub Pages. Same as p0.

**Networking:** PeerJS (WebRTC) with star topology. Host is the authoritative state owner — all game state lives on the host and is broadcast to guests. Guests send action requests (e.g. "move card X to place Y"), host validates and applies them, then broadcasts the new state.

**Why host-authoritative (diverging from p0):** p0 broadcasts local state and each peer renders independently. For a card game, consistency matters more than latency — all players must see the same card positions. The host holds the single source of truth.

## Session Flow

1. **Host** enters setup file URL → app fetches and validates setup + deck files
2. Host arrives at lobby with QR code / link (same session-id system as p0: "Adjective Adjective Animal")
3. **Guests** scan QR / open link → join lobby
4. Host clicks **Play** once player count is within min/max range
5. Host resolves all sets, shuffles/sorts, deals starting cards to places → broadcasts initial game state
6. Game begins

## Rendering

**DOM-based UI** (not canvas). Cards are `<img>` elements positioned with CSS transforms. Reasons:
- No 60fps game loop needed — state changes are discrete events
- Touch/click interaction is simpler with DOM elements
- Image loading/caching handled by the browser
- Accessibility benefits (screen readers, zoom)

**Layout:** The main view is a scrollable/pannable overview of all visible places. Each place is a container showing its cards according to its arrangement rules.

## Interaction Model

Touch/mobile-first. Desktop also works (click instead of tap, long-click instead of tap-and-hold).

**The "Hand" metaphor:**

The board overview is always visible — there is no zoomed/detail mode. Players interact by picking up cards into a transient "hand" strip at the bottom of the screen, then depositing them somewhere.

**Actions:**
- Tap a card in any place → pick up that card + all cards above it into your hand (removed from source immediately)
- Tap a card in your hand → flip it (face-up ↔ face-down)
- Tap-and-hold a card in your hand → inspect it fullscreen; tap to exit
- Tap-and-hold any place → deposit all hand cards into that place (arrival rules apply)
- Cancel button (in hand strip) → return all hand cards to their source

**No drag-and-drop** for moving cards between places (unreliable on mobile, especially between distant places). The hand metaphor achieves the same result with reliable tap/hold gestures.

**No zoom mode** — the overview layout plus the hand strip provides enough information. Card faces are readable at overview scale; for detailed inspection, tap-and-hold shows fullscreen.

## State Model

```
GameState {
  places: Map<placeId, Place>
  // placeId = "global:<name>" | "player:<playerId>:<name>" | "pp:<ownerId>:<viewerId>:<name>"
}

Place {
  cards: Card[]       // ordered, index 0 = bottom
  subPlaces: Map<subPlaceName, Card[]>
  config: PlaceConfig // from setup (immutable)
}

Card {
  id: string          // unique across game
  deckCardIndex: number
  faceUp: boolean
}
```

The host holds `GameState`. On each mutation, the host computes a **view** for each player (hiding face-down cards in non-visible places) and sends that view.

## Data File Loading

1. Host provides setup URL → fetch setup JSON
2. Setup references deck(s) → fetch deck JSON(s) recursively
3. Resolve deck includes (detect circular refs via visited-set)
4. Resolve sets: filter source deck by tags, apply include/exclude overrides, sort or shuffle, take N
5. Validate: ensure all referenced set names in setup exist in resolved decks

All fetching happens on the host before the game starts. Resolved card data (image URLs, sizes, tags) is broadcast to guests as part of initial state.

## Player Views & Visibility

Each player sees:
- All global places (cards face-up or face-down per place config)
- Their own per-player places (always visible to them)
- Other players' per-player places only if `visibleToOtherPlayers: true` (cards shown face-down)
- Per-player:player places — each player has one of these *for each other player*, displayed relative to the viewer

The host computes what each player can see and sends only that data.

## Place Cloning

Places with `cloneLimit > 1` can be duplicated during gameplay. Use case: drawing a new "hand" zone, or creating a new discard pile. UI action: long-press a clonable place → "Duplicate" option appears.

## Sub-places

Sub-places are mini-places within a parent place (e.g. "trump indicator" slot on a deck). They have their own card stack and position relative to parent. The parent's `subPlaceList` defines initial/min/max counts — this allows dynamic creation of sub-places during play.

## Resolved Decisions

- **Card sizes:** Uniform within a game. Validated on setup load.
- **Undo:** Nice-to-have (deferred — will design state as a stack to make it easy to add later).
- **Reconnection:** Will attempt if complexity is reasonable. Approach: guests store a random "player token" in sessionStorage; on reconnect they send it and the host re-associates them.
- **Spectators:** Not supported. Players only.
- **Image loading:** Lazy-load. Broken/pending images show a fallback placeholder with card name + tags rendered as text.
- **Overview layout:** Zoomed-out spatial view of all places with mini card spreads visible.
- **Per-player:player places:** Dropped for v1. Can revisit later.
- **Sound/haptics:** Not for now.
- **Validation:** App validates setup + deck files on load and reports errors. No authoring tool.
- **Sample content:** Standard 52-card playing deck (simple SVG faces) with tags `{suit, number, royal}`. Sample setup file for a well-known game.

## Screen Layout

The game screen is split into two halves:
- **Top half:** Global places + other players' visible places, spread around
- **Bottom half:** The current player's own places

If a game has no global places, the player's places fill the screen. If no per-player places, global fills the screen. Proportions adapt.

The x,y positions in the setup file are honoured *within* each half — global place coordinates position within the top area, per-player place coordinates position within the bottom area.

## Card Movement Permissions

Places have flags controlling who can interact:
- `othersCanMoveIn: boolean` — other players can move cards *into* this place
- `othersCanMoveOut: boolean` — other players can move cards *out of* this place

By default, global places allow both; per-player places allow neither (only the owner can touch them). Setup file can override.

## Turn Enforcement

None. Players self-regulate. The app is a "virtual table", not a game engine.

## Network Protocol

- Host→guest: **deltas** (list of state changes) for efficiency, with a **full-state checksum** included so guests can detect desync
- On desync or reconnection: host sends full state
- Guest→host: action requests (move card, flip card, clone place, etc.)

## Place Labels

Place names are shown when zoomed into a place. Not shown in the overview (keeps it clean).

## Card Back Default

If no back image is defined on the card or its deck, use a generated generic cross-hatch/pattern SVG.

## Sample Game

Will create:
- A standard 52-card deck file (simple SVG, tags: `suit`, `number`, `royal`)
- A **Rummy** setup file (2-4 players; exercises draw pile, discard pile, per-player hands, and meld areas)
- A **Klondike Solitaire** setup file (1 player; exercises tableau spreads, foundation piles, stock/waste — good stress test for arrangement rendering)

## Meld Areas (Rummy Sample)

Per-player "melds" place, visible to others (`visibleToOtherPlayers: true`), with `othersCanMoveIn: true` so other players can lay off cards onto existing melds. This exercises the permission model nicely.

## Multi-card Selection

Players can select multiple cards in a place and move/flip them as a batch. UI: tap to select/deselect individual cards, then choose action. A "select all" shortcut for the place would also be useful (e.g. moving an entire discard pile back to the draw pile).

## Shuffling

Declarative, tied to the *destination* place. A place can have a `shuffleOnArrival: boolean` property. When cards are moved into a shuffling place, the place's card stack is reshuffled. This covers the "return discard pile to draw pile" pattern cleanly without needing a manual shuffle button.

## Card Counts in Overview

No explicit count label needed. The arrangement spread distance is always applied, so a thick stack visually communicates depth. A place with 30 cards will show a visible spread offset; a place with 2 will be thin.

## Rotation / Table Simulation

Other players' visible places in the top half are rotated as if players are sitting around a table. The viewer is at the bottom (their places are upright). Opposite players' places appear upside-down, side players appear at 90°. Place rotation values in the setup are applied *on top of* this seating rotation.

## Implementation Readiness

I believe the design is now complete enough to implement v1. Here's the planned build order:

### Phase 1: Foundation
1. Project scaffolding (Vite, PeerJS, QR code, deploy config)
2. Data file schemas (JSON) + loader/validator
3. Standard 52-card deck file with SVG card faces
4. Rummy setup file

### Phase 2: Core Engine
5. Game state model + mutation functions
6. View computation (per-player visibility filtering)
7. Network layer (host-authoritative, delta + checksum)
8. Reconnection support

### Phase 3: UI
9. Lobby screens (adapted from p0 pattern)
10. Game overview layout (top/bottom split, rotation)
11. Place rendering (arrangement spreads, card images, fallback)
12. Zoom interaction (tap place → zoomed view)
13. Card selection + action menu (move, flip)
14. Multi-card selection
15. Place cloning UI

### Phase 4: Polish
16. Default card back SVG pattern
17. Error/validation feedback on setup load
18. Lazy image loading with fallback
19. Undo (nice-to-have)

---

## Layout & Rendering Redesign (2026-07-04)

Following playtesting, the v1 absolute-positioning layout (x/y coordinates in setup files) has several problems: labels clip off-screen, places overflow on different screen sizes, rotation of opponents' cards makes them unreadable. This section documents the agreed replacement design.

### Place Groups

The layout hierarchy becomes: **Board → Groups → Places → Cards**

Groups are defined explicitly in the setup JSON. The board lays out groups using flexbox. Within each group, places are laid out according to the group's direction and any relative positioning constraints.

```json
"groups": [
  {
    "name": "Stock & Waste",
    "direction": "row",
    "places": ["Draw Pile", "Discard Pile"]
  },
  {
    "name": "Foundations",
    "direction": "row",
    "places": ["F1", "F2", "F3", "F4"]
  }
]
```

- Places not assigned to a group get their own implicit single-place group.
- Groups for player places are defined once and replicated per player (symmetric — all players have the same group structure).

### Within-Group Positioning

Groups specify a `direction` ("row" or "column"). Places are laid out in declaration order by default.

For exceptions, a place can specify relative positioning:
```json
{ "name": "F1", "position": "rightOf:Waste", "gap": 2 }
```

This keeps simple cases simple (most groups are just a row or column in declaration order) while allowing spatial relationships for games that need them (e.g. a gap between waste and foundations in Klondike).

### Board Layout of Groups

The board arranges groups using flex-wrap. No x/y coordinates for groups — they flow naturally. On a portrait phone, groups will stack vertically. On a wider screen, smaller groups may sit side-by-side.

The board is split into two sections:
- **Table area** — global groups + other players' visible groups
- **Player area** — the local player's groups

These two areas share the viewport. Their relative size is proportional to content (not a fixed 50/50 split).

### Other Players' Places

Other players' visible places (e.g. melds in Rummy) are displayed in the table area with a **coloured border** identifying the owner (using the same hue derived from their name). No rotation — cards are always displayed upright and readable.

### Card Scaling

Cards scale uniformly to fit all groups on screen without overflow. No scrollbars or pinch-to-zoom for v1.

**Algorithm: pre-calculate scale from known quantities.**

1. For each section (table, player), compute the total space needed at scale=1:
   - Each place's width = base-card-width + (spread-x × max-card-count)
   - Each group's width/height = sum of its places in the group's direction
   - Section total = groups laid out with flex-wrap logic
2. Scale factor = min(available-width / needed-width, available-height / needed-height)
3. Clamp to a minimum (cards must remain tappable, ~40px wide) and a maximum (no giant cards on desktop)
4. Apply via CSS variable `--card-scale`

**Recalculate when:** game starts, window resizes, or card count changes significantly (a place grows/shrinks beyond a threshold).

If the pre-calculation is slightly off and overflow occurs, containers clip gracefully (no scrollbars appearing unexpectedly).

### Flip Resolution Timing

`topFaceUp` and arrival-flip rules resolve **after the hand is deposited**, not on pickup. This prevents information leaking before the player commits to their action.

Example: picking up the top (face-up) card from a topFaceUp pile does NOT immediately flip the next card face-up. That flip happens only once the picked-up card is deposited elsewhere (or if the pickup is cancelled, the card returns and remains the top face-up card).

### Summary of Decisions

| Decision | Choice |
|----------|--------|
| Layout model | Flex-based place groups (no x/y coordinates) |
| Group definition | Explicit in setup JSON |
| Within-group layout | Direction (row/col) + declaration order + optional relative positioning |
| Board layout of groups | Flex-wrap, content-proportional section sizes |
| Other players | Coloured border, no rotation |
| Card sizing | Pre-calculated scale factor, CSS variable |
| Scroll/zoom | None for v1 (cards shrink to fit) |
| Flip timing | Resolves on deposit, not pickup |
| Player symmetry | All players share same place/group structure |
