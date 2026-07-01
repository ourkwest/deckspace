// UI Screens for lobby flow
// Each screen returns an HTML string rendered into #ui.

import { ADJ1, ADJ2, ANIMALS } from './session-id.js';
import QRCode from 'qrcode';

export function splashScreen() {
  return `
    <div class="screen splash">
      <h1 class="title">DECKSPACE</h1>
      <p class="subtitle">Card Games, Anywhere</p>
      <div class="menu">
        <button data-action="host">Host Game</button>
        <button data-action="join">Join Game</button>
      </div>
    </div>
  `;
}

export function hostSetupScreen({ name = '', setupUrl = '', recentUrls = [], error = '' }) {
  const recentHtml = recentUrls.length > 0
    ? `<div class="url-history">Recent: ${recentUrls.map(u => `<a data-url="${escHtml(u)}">${truncateUrl(u)}</a>`).join(', ')}</div>`
    : '';

  return `
    <div class="screen host-setup">
      <h2>Host Game</h2>
      <label>Your Name
        <input type="text" id="player-name" value="${escHtml(name)}" maxlength="16" placeholder="Enter your name">
      </label>
      <label>Setup File URL
        <input type="url" id="setup-url" value="${escHtml(setupUrl)}" placeholder="https://example.com/setup.json">
      </label>
      ${recentHtml}
      ${error ? `<div class="error">${escHtml(error)}</div>` : ''}
      <button data-action="start-host" ${(!name || !setupUrl) ? 'disabled' : ''}>Create Session</button>
      <button data-action="back" class="secondary">Back</button>
    </div>
  `;
}

export function joinScreen({ name = '', adj1 = '', adj2 = '', animal = '' }) {
  return `
    <div class="screen join">
      <h2>Join Game</h2>
      <label>Your Name
        <input type="text" id="player-name" value="${escHtml(name)}" maxlength="16" placeholder="Enter your name">
      </label>
      <label>Session Code
        <div class="session-id-input">
          <select id="sel-adj1">${options(ADJ1, adj1)}</select>
          <select id="sel-adj2">${options(ADJ2, adj2)}</select>
          <select id="sel-animal">${options(ANIMALS, animal)}</select>
        </div>
      </label>
      <button data-action="join-session" ${(!name || !adj1 || !adj2 || !animal) ? 'disabled' : ''}>Join</button>
      <button data-action="back" class="secondary">Back</button>
    </div>
  `;
}

export function sessionScreen({ sessionId, sessionKey, players = [], isHost = false, setupName = '', playerRange = '' }) {
  const link = `${window.location.origin}${window.location.pathname}?session=${sessionKey}`;
  return `
    <div class="screen session">
      <h2>${escHtml(setupName || 'Session')}</h2>
      <div class="session-code">${escHtml(sessionId)}</div>
      <a href="${link}" target="_blank" style="color:#4fc3f7;text-align:center;font-size:0.85rem;word-break:break-all">${link}</a>
      <canvas id="qr-code" style="align-self:center;margin:0.5rem 0"></canvas>
      <div class="players">
        <h3>Players (${players.length}${playerRange ? ` / ${playerRange}` : ''})</h3>
        <ul>${players.map(p => `<li><span class="dot" style="background:hsl(${hashHue(p.name)},70%,50%)"></span>${escHtml(p.name)}</li>`).join('')}</ul>
      </div>
      ${isHost ? `<button data-action="play" ${players.length < 1 ? 'disabled' : ''}>Start Game</button>` : '<p class="waiting">Waiting for host to start...</p>'}
    </div>
  `;
}

export function loadingScreen(message = 'Loading...') {
  return `
    <div class="screen splash">
      <h1 class="title">DECKSPACE</h1>
      <p class="subtitle">${escHtml(message)}</p>
    </div>
  `;
}

export function errorScreen(message, canRetry = true) {
  return `
    <div class="screen splash">
      <h1 class="title">DECKSPACE</h1>
      <div class="error">${escHtml(message)}</div>
      ${canRetry ? '<button data-action="back">Back</button>' : ''}
    </div>
  `;
}

// --- Utilities ---

function options(list, selected) {
  return '<option value="">—</option>' + list.map(v =>
    `<option value="${v}" ${v === selected ? 'selected' : ''}>${v}</option>`
  ).join('');
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function truncateUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.split('/').pop();
    return path || u.hostname;
  } catch {
    return url.slice(0, 30);
  }
}

function hashHue(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

export function renderSessionQR(container, sessionKey) {
  const canvas = container.querySelector('#qr-code');
  if (!canvas) return;
  const link = `${window.location.origin}${window.location.pathname}?session=${sessionKey}`;
  QRCode.toCanvas(canvas, link, { width: 160, margin: 1, color: { dark: '#ffffff', light: '#00000000' } });
}
