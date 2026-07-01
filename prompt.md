# Deckspace

## intro

Deckspace is a serverless multiplayer mobile web game that simulates different decks of cards on a table and in people's hands so that they can play all sorts of card games.

The game will be driven by a URL pointing to a JSON file ("setup file") that defines the places that cards can exist, and the URL pointing to a JSON file ("deck file") defining the deck of cards.

## Data files

A setup file contains a 'setup'.
A deck file contains a 'deck'.

card:
  - face image url
  - back image url (optional)
  - size (height, width)
  - tags, a map of:
    - key value pairs (string, string) or (string, list of strings)

deck:
  - name
  - back image url (optional)
  - size (height, width)
  - list of:
    - one of: deck file url or local name (to include another deck), card definition, set definition

set:
  - name
  - source deck name
  - tag filters (optional)
  - exclude
    - list of indices of cards in the source deck to exclude, overrides tag filters
  - include
    - list of indices of cards in the source deck to include, overrides tag filters
  - sort: (optional, set is shuffled if omitted)
    - a list of tag keys to determine the sort order
  - number of cards to take from the source deck after filtering and sorting

setup:
  - name
  - player count
    - min
    - max
  - global places
    - list of:
      - name
      - location
        - x, y (absolute position)
        - rotation (displayed relative to each player's view, so they all see it the same way up)
      - possible card limit
      - arrangement
        - spread distance (x,y) per card (0,0 means cards all stacked directly on top of each other)
        - spread angle per card (0 means cards are all at the same rotation)
      - default flip (all face up or all face down or top card only face up)
      - starting card set name
      - clone limit (optional, can be duplicated during game play if present, defaults to 1 if absent)
      - sub-place list
        - map of sub-place name to {initial count, min count, max count}
      - arrival location (top, bottom or ask)
      - arrival flip (face up, face down or ask)
  - per player places
    - list of:
      - name
      - location
        - x, y (will be displayed relative to player)
        - rotation (relative to the player it belongs to)
      - possible card limit
      - arrangement
        - spread distance (x,y) per card
        - spread angle per card
      - default flip
      - starting card set name
      - clone limit
      - sub place list
      - visible to other players: true/false
      - arrival location
      - arrival flip
  - per player:player places
    - list of:
      - name
      - location
        - x, y (will be displayed relative to player)
        - rotation (relative to the player viewing it)
      - possible card limit
      - arrangement
        - spread distance (x,y) per card
        - spread angle per card
      - default flip
      - starting card set name
      - clone limit
      - sub-place list
      - visible to other players: true/false
      - arrival location
      - arrival flip
  - sub-places
    - list of:
      - name
      - relative location (relative to parent place)
        - x, y
        - rotation
      - possible card limit
      - default flip
      - starting card set name
      - arrival location
      - arrival flip

Circular definitions are disallowed.
Image urls should point to SVG or PNG (or some other web-suitable format). Transparency should be allowed.
All fields should be optional unless strictly needed. Sensible defaults should apply in their absence.

## App flow

Host: arrive at webpage, enter setup url (recent history cached in browser), go to lobby screen with QR code to share session id
Guest: scan host's QR code, go to webpage with session id to join lobby
Host: when a quorum is achieved, clicks play

## Game play

each player has an overview of the game showing the different places with their cards.
The following actions should be available:
    zooming into a place to look at it more closely
    zooming into a card to look at it more closely
    selecting a card to move to another place, then selecting the place to move it to, then selecting 'top' or 'bottom' of that place if relevant, then selecting face up or face down if relevant.
    selecting a card to flip another way up
the controls should primarily work on mobile, but also on desktop

## technical details

look at ../p0 as a template, diverge from that in that all the state will be managed by the host because it is not for fast-paced gameplay
