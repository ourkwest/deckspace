#!/usr/bin/env node
// Navigates the Chrome debug session into a Klondike game in one go.
// Usage: node scripts/cdp-start-game.cjs [setup-url]

const WebSocket = require('ws');
const http = require('http');

const setupUrl = process.argv[2] || '/deckspace/samples/klondike-setup.json';

http.get('http://localhost:9222/json', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const tabs = JSON.parse(data);
    const tab = tabs.find(t => t.title === 'Deckspace' || t.url.includes('deckspace'));
    if (!tab) { console.error('No Deckspace tab found'); process.exit(1); }
    runGame(tab.webSocketDebuggerUrl);
  });
}).on('error', (e) => { console.error('Cannot connect to Chrome CDP:', e.message); process.exit(1); });

function runGame(wsUrl) {
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

  async function run() {
    // Navigate to app
    console.log('Navigating to app...');
    await evaluate(`window.location.href = 'https://localhost:5173/deckspace/'`);
    await evaluate(`await new Promise(r => setTimeout(r, 1500))`);

    // Click Host
    console.log('Clicking Host Game...');
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Host')).click()`);
    await evaluate(`await new Promise(r => setTimeout(r, 300))`);

    // Fill form
    console.log('Filling form...');
    await evaluate(`
      const n = document.querySelector('input[type="text"]');
      n.value = 'Tester'; n.dispatchEvent(new Event('input', {bubbles:true}));
      const u = document.querySelector('input[type="url"]');
      u.value = '${setupUrl}'; u.dispatchEvent(new Event('input', {bubbles:true}));
    `);

    // Create session
    console.log('Creating session...');
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Create')).click()`);
    await evaluate(`await new Promise(r => setTimeout(r, 2000))`);

    // Check for errors
    const uiText = await evaluate(`return document.querySelector('#ui')?.innerText?.substring(0, 200)`);
    if (uiText && uiText.includes('Failed')) {
      console.error('Error:', uiText);
      ws.close(); process.exit(1);
    }

    // Start game
    console.log('Starting game...');
    await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Start')).click()`);
    await evaluate(`await new Promise(r => setTimeout(r, 500))`);

    // Report
    const result = await evaluate(`return (() => {
      const places = [...document.querySelectorAll('.place')];
      return JSON.stringify(places.map(p => ({
        name: p.dataset.placeId.split(':').pop(),
        cards: p.querySelectorAll('.card').length
      })));
    })()`);
    console.log('Game started! Places:', result);
    ws.close();
    process.exit(0);
  }

  ws.on('open', () => run().catch(e => { console.error(e); ws.close(); process.exit(1); }));
  ws.on('error', (e) => { console.error('WS error:', e.message); process.exit(1); });
  setTimeout(() => { console.error('Timeout'); process.exit(1); }, 20000);
}
