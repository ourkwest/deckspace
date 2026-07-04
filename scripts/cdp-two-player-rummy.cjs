#!/usr/bin/env node
// Sets up a multiplayer game across N tabs in Chrome debug session.
// Requires: Chrome running with --remote-debugging-port=9222 and at least N tabs open.
// Usage: node scripts/cdp-two-player-rummy.cjs [num-players] [setup-url]

const WebSocket = require('ws');
const http = require('http');

const numPlayers = parseInt(process.argv[2], 10) || 2;
const setupUrl = process.argv[3] || '/deckspace/samples/rummy-setup.json';
const BASE = 'https://localhost:5173/deckspace/';
const NAMES = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Heidi'];

http.get('http://localhost:9222/json', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const tabs = JSON.parse(data);
    if (tabs.length < numPlayers) {
      console.error(`Need at least ${numPlayers} tabs open in Chrome. Found: ${tabs.length}`);
      process.exit(1);
    }
    const wsUrls = tabs.slice(0, numPlayers).map(t => t.webSocketDebuggerUrl);
    runGame(wsUrls);
  });
}).on('error', (e) => { console.error('Cannot connect to Chrome CDP:', e.message); process.exit(1); });

function connectTab(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 0;

    function evaluate(expr) {
      return new Promise((resolve, reject) => {
        const id = ++msgId;
        ws.send(JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression: `(async () => { ${expr} })()`, returnByValue: true, awaitPromise: true }
        }));
        const handler = (raw) => {
          const msg = JSON.parse(raw);
          if (msg.id === id) {
            ws.off('message', handler);
            const r = msg.result?.result;
            if (r?.subtype === 'error') reject(new Error(r.description));
            else resolve(r?.value);
          }
        };
        ws.on('message', handler);
      });
    }

    ws.on('open', () => resolve({ ws, evaluate }));
    ws.on('error', reject);
  });
}

async function runGame(wsUrls) {
  const connections = [];
  try {
    console.log(`Setting up ${numPlayers}-player game...`);

    // Connect to all tabs
    for (const url of wsUrls) {
      connections.push(await connectTab(url));
    }
    const [host, ...guests] = connections;

    // --- HOST: Navigate and create session ---
    console.log(`[${NAMES[0]}] Navigating to app...`);
    await host.evaluate(`window.location.href = '${BASE}'`);
    await host.evaluate(`await new Promise(r => setTimeout(r, 500))`);

    console.log(`[${NAMES[0]}] Clicking Host Game...`);
    await host.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Host')).click()`);
    await host.evaluate(`await new Promise(r => setTimeout(r, 100))`);

    console.log(`[${NAMES[0]}] Filling form...`);
    await host.evaluate(`
      const n = document.querySelector('input[type="text"]');
      n.value = '${NAMES[0]}'; n.dispatchEvent(new Event('input', {bubbles:true}));
      const u = document.querySelector('input[type="url"]');
      u.value = '${setupUrl}'; u.dispatchEvent(new Event('input', {bubbles:true}));
    `);

    console.log(`[${NAMES[0]}] Creating session...`);
    await host.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Create')).click()`);
    await host.evaluate(`await new Promise(r => setTimeout(r, 1000))`);

    // Check for errors
    const hostUi = await host.evaluate(`return document.querySelector('#ui')?.innerText?.substring(0, 300)`);
    if (hostUi && hostUi.includes('Failed')) {
      console.error(`[${NAMES[0]}] Error:`, hostUi);
      process.exit(1);
    }

    // Get the session link
    const sessionUrl = await host.evaluate(`return document.querySelector('a[href*="session="]')?.href || window.location.href`);
    console.log(`[${NAMES[0]}] Session URL:`, sessionUrl);

    // --- GUESTS: Join one by one ---
    for (let i = 0; i < guests.length; i++) {
      const guest = guests[i];
      const name = NAMES[i + 1];

      console.log(`[${name}] Joining via session link...`);
      await guest.evaluate(`window.location.href = '${sessionUrl}'`);
      await guest.evaluate(`await new Promise(r => setTimeout(r, 800))`);

      console.log(`[${name}] Filling name...`);
      await guest.evaluate(`
        const n = document.querySelector('#player-name');
        if (n) { n.value = '${name}'; n.dispatchEvent(new Event('input', {bubbles:true})); }
      `);
      await guest.evaluate(`await new Promise(r => setTimeout(r, 100))`);

      console.log(`[${name}] Clicking Join...`);
      await guest.evaluate(`
        const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Join'));
        if (btn) btn.click();
      `);
      await guest.evaluate(`await new Promise(r => setTimeout(r, 800))`);
    }

    // --- HOST: Wait for all guests, then start ---
    console.log(`[${NAMES[0]}] Waiting for players...`);
    await host.evaluate(`await new Promise(r => setTimeout(r, 500))`);

    const players = await host.evaluate(`return document.querySelector('.players')?.innerText || ''`);
    console.log(`[${NAMES[0]}] Players:`, players.replace(/\n/g, ', '));

    console.log(`[${NAMES[0]}] Starting game...`);
    await host.evaluate(`
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Start'));
      if (btn && !btn.disabled) btn.click();
    `);
    await host.evaluate(`await new Promise(r => setTimeout(r, 500))`);

    // --- Report results from all tabs ---
    for (let i = 0; i < connections.length; i++) {
      const places = await connections[i].evaluate(`return JSON.stringify([...document.querySelectorAll('.place')].map(p => ({
        name: p.dataset.placeId.split(':').pop(),
        cards: p.querySelectorAll('.card').length
      })))`);
      console.log(`[${NAMES[i]}] Game board:`, places);
    }

    console.log(`\n${numPlayers}-player game started successfully!`);
  } catch (e) {
    console.error('Error:', e.message || e);
  } finally {
    for (const conn of connections) conn.ws.close();
    process.exit(0);
  }
}
