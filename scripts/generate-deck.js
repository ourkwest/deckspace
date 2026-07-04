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

function makeSvg(display, number, symbol, color) {
  // How many symbols to show in the ring
  const count = getSymbolCount(display);
  const cx = 31.5, cy = 44;

  // Black suits (♣ ♠) are pointy at top, flip them 180° so they nestle better in a ring
  const isBlack = color === '#1a1a1a';
  const symbolFlip = isBlack ? 180 : 0;

  const radius = getRingRadius(count, isBlack);
  const fontSize = count <= 3 ? 32 : count <= 6 ? 28 : count <= 8 ? 24 : 20;

  let center = '';
  const isRoyal = display === 'A' || display === 'J' || display === 'Q' || display === 'K';

  if (isRoyal) {
    // Diagonal stripes in corners: J=1, Q=2, K=3 (rendered first so letter covers them)
    const stripeCount = display === 'J' ? 1 : display === 'Q' ? 2 : display === 'K' ? 3 : 0;
    if (stripeCount > 0) {
      center += makeCornerStripes(stripeCount, color);
    }
    const circleRadius = 6;
    const circleSpacing = 4 * (cx / cy);
    for (let i = 0; i < stripeCount; i++) {
      const r = circleRadius + i * circleSpacing;
      center += `<circle cx="52" cy="12" r="${r.toFixed(1)}" fill="none" stroke="${color}" stroke-width="0.75" opacity="0.25"/>`;
      center += `<circle cx="52" cy="12" r="${r.toFixed(1)}" fill="none" stroke="${color}" stroke-width="0.75" opacity="0.25" transform="rotate(180 31.5 44)"/>`;
    }
    // Large letter filling the card — solid half-white color (covers stripes beneath)
    const letterColor = isBlack ? '#8a8a8a' : '#e89898';
    center += `<text x="${cx}" y="64" font-size="60" font-family="Arial,sans-serif" font-weight="bold" fill="${letterColor}" text-anchor="middle">${display}</text>`;
    // Bottom-left symbol (upright, near bottom-left corner)
    center += `<text x="52" y="18" font-size="21" font-family="Arial,sans-serif" fill="${color}" text-anchor="middle">${symbol}</text>`;
    // Top-right symbol (rotated 180°, near top-right corner)
    center += `<text x="52" y="18" font-size="21" font-family="Arial,sans-serif" fill="${color}" text-anchor="middle" transform="rotate(180 31.5 44)">${symbol}</text>`;
  } else {
    for (let i = 0; i < count; i++) {
      const angle = (2 * Math.PI * i / count) - Math.PI / 2;
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      // Rotate to point toward center, plus flip for black suits
      const rotDeg = (angle * 180 / Math.PI) + 90 + symbolFlip;
      center += `<text x="${x.toFixed(1)}" y="${(y + fontSize * 0.35).toFixed(1)}" font-size="${fontSize}" font-family="Arial,sans-serif" fill="${color}" text-anchor="middle" transform="rotate(${rotDeg.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})">${symbol}</text>`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 63 88">` +
    `<rect x="1" y="1" width="61" height="86" rx="4" ry="4" fill="white" stroke="#ccc" stroke-width="0.5"/>` +
    `<text x="5" y="14" font-size="10" font-family="Arial,sans-serif" fill="${color}">${display}</text>` +
    `<text x="5" y="24" font-size="9" font-family="Arial,sans-serif" fill="${color}">${symbol}</text>` +
    center +
    `<text x="5" y="14" font-size="10" font-family="Arial,sans-serif" fill="${color}" text-anchor="start" transform="rotate(180 31.5 44)">${display}</text>` +
    `<text x="5" y="24" font-size="9" font-family="Arial,sans-serif" fill="${color}" text-anchor="start" transform="rotate(180 31.5 44)">${symbol}</text>` +
    `</svg>`;
}

function makeCornerStripes(count, color) {
  let stripes = '';
  const spacing = 4;
  const strokeWidth = 1.5;
  const opacity = 0.4;
  // Card is 63x88. Stripes go from top edge (halfway = x=31.5) to right edge (halfway = y=44)
  // and extend well beyond the viewBox so ends aren't visible.
  // Top-right corner: diagonal cutting through top edge at midpoint and right edge at midpoint
  // The line goes from (31.5, -10) to (73, 44) direction — extended beyond edges
  
  for (let i = 0; i < count; i++) {
    const offset = (i - (count - 1) / 2) * spacing; // center the group of stripes
    // Top-right corner: from above top-center to beyond right-middle
    // const tr_x1 = 31.5 + offset, tr_y1 = -10;
    // const tr_x2 = 73, tr_y2 = 44 + offset;
    const tr_x1 = offset + 63, tr_y1 = -44;
    const tr_x2 = offset - 31.5, tr_y2 = 88;
    stripes += `<line x1="${tr_x1}" y1="${tr_y1}" x2="${tr_x2}" y2="${tr_y2}" stroke="${color}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`;
    // Bottom-left corner: rotated 180° around card center
    stripes += `<line x1="${tr_x1}" y1="${tr_y1}" x2="${tr_x2}" y2="${tr_y2}" stroke="${color}" stroke-width="${strokeWidth}" opacity="${opacity}" transform="rotate(180 31.5 44)"/>`;
  }
  return stripes;
}

function getRingRadius(count, isBlack) {
  // Non-linear: 2-3 spread out more, 8-10 stay compact to avoid card edge
  // Black suits need tighter radius since flipping shifts their visual center outward
  const radii = {
    1: 0,
    2: 16,
    3: 17,
    4: 19,
    5: 20,
    6: 21,
    7: 22,
    8: 22,
    9: 22,
    10: 22,
  };
  const r = radii[count] || 20;
  return isBlack ? r * 0.85 : r;
}

function getSymbolCount(display) {
  const n = parseInt(display, 10);
  if (!isNaN(n)) return n; // 2-10: show that many
  if (display === 'A') return 1;
  if (display === 'J' || display === 'Q' || display === 'K') return 1;
  return 1;
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
    const svg = makeSvg(val.display, val.number, suit.symbol, suit.color);
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

cards.push({
  name: 'royalsAndAces',
  source: 'Standard 52-Card Deck',
  tags: { number: ['1', '11', '12', '13'] },
  sort: ['number', 'suit'],
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
