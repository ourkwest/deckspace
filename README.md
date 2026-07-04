# Deckspace

Serverless multiplayer mobile web game that simulates card decks on a table. Players load a JSON setup + deck file, then play any card game by moving cards between places. Host-authoritative via PeerJS (WebRTC).

## Running locally

```sh
npm install
npm run dev    # HTTPS dev server (required for WebRTC)
npm run build  # production build to dist/
```

## How it works

The host loads a setup file, creates game state, and broadcasts personalised views to connected guests. Guests send action requests; the host validates permissions, mutates state, and broadcasts deltas.

## Docs

- `prompt.md` — Original spec
- `design.md` — Design decisions
- `PROGRESS.md` — Detailed progress and architecture notes
- `schemas/` — JSON schemas for deck and setup files

## Samples

- `public/samples/standard-deck.json` — Standard 52-card deck with inline SVG faces
- `public/samples/rummy-setup.json` — 2–4 player Rummy
- `public/samples/klondike-setup.json` — Klondike Solitaire
