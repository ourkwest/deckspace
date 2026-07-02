#!/usr/bin/env node
// Generates public/samples/standard-deck.json with inline SVG card faces

const suits = [
  { name: 'hearts', symbol: '♥', color: '#d32f2f' },
  { name: 'diamonds', symbol: '♦', color: '#d32f2f' },
  { name: 'clubs', symbol: '♣', color: '#1a1a1a' },
  { name: 'spades', symbol: '♠', color: '#1a1a1a' },
];

const values = [
  { display: 'A', number: '1' },
  { display: '2', number: '2' },
  { display: '3', number: '3' },
  { display: '4', number: '4' },
  { display: '5', number: '5' },
  { display: '6', number: '6' },
  { display: '7', number: '7' },
  { display: '8', number: '8' },
  { display: '9', number: '9' },
  { display: '10', number: '10' },
  { display: 'J', number: '11' },
  { display: 'Q', number: '12' },
  { display: 'K', number: '13' },
];

function makeSvg(display, symbol, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 63 88">` +
    `<rect x="1" y="1" width="61" height="86" rx="4" ry="4" fill="white" stroke="#ccc" stroke-width="0.5"/>` +
    `<text x="5" y="14" font-size="10" font-family="Arial,sans-serif" fill="${color}">${display}</text>` +
    `<text x="5" y="24" font-size="9" font-family="Arial,sans-serif" fill="${color}">${symbol}</text>` +
    `<text x="31.5" y="52" font-size="22" font-family="Arial,sans-serif" fill="${color}" text-anchor="middle">${symbol}</text>` +
    `<text x="58" y="78" font-size="10" font-family="Arial,sans-serif" fill="${color}" text-anchor="end">${display}</text>` +
    `<text x="58" y="68" font-size="9" font-family="Arial,sans-serif" fill="${color}" text-anchor="end">${symbol}</text>` +
    `</svg>`;
}

function svgToDataUri(svg) {
  // Minimal encoding for data:image/svg+xml
  return 'data:image/svg+xml,' + svg
    .replace(/#/g, '%23')
    .replace(/"/g, "'");
}

const cards = [];

for (const suit of suits) {
  for (const val of values) {
    const svg = makeSvg(val.display, suit.symbol, suit.color);
    const royal = ['11', '12', '13'].includes(val.number) ? 'true' : 'false';
    const colorName = (suit.name === 'hearts' || suit.name === 'diamonds') ? 'red' : 'black';

    cards.push({
      face: svgToDataUri(svg),
      tags: {
        suit: suit.name,
        number: val.number,
        color: colorName,
        royal: royal,
      },
    });
  }
}

// Add set definitions
cards.push({
  name: 'full',
  source: 'Standard 52-Card Deck',
});

cards.push({
  name: 'fullSorted',
  source: 'Standard 52-Card Deck',
  sort: ['suit', 'number'],
});

const deck = {
  name: 'Standard 52-Card Deck',
  size: { width: 63, height: 88 },
  cards,
};

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'samples');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'standard-deck.json'), JSON.stringify(deck, null, 2));
console.log('Generated public/samples/standard-deck.json (%d cards)', cards.length - 2);
