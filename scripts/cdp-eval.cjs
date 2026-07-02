#!/usr/bin/env node
// Usage: node scripts/cdp-eval.js "javascript expression"
// Evaluates the expression in the first Deckspace tab via Chrome DevTools Protocol

const WebSocket = require('ws');
const http = require('http');

const expr = process.argv[2] || 'document.title';

// First, find the Deckspace tab
http.get('http://localhost:9222/json', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const tabs = JSON.parse(data);
    const tab = tabs.find(t => t.title === 'Deckspace' && t.type === 'page');
    if (!tab) {
      console.error('No Deckspace tab found');
      process.exit(1);
    }
    evalInTab(tab.webSocketDebuggerUrl, expr);
  });
}).on('error', (e) => {
  console.error('Cannot connect to Chrome CDP:', e.message);
  process.exit(1);
});

function evalInTab(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  ws.on('open', () => {
    // Wrap in async IIFE to support await
    const wrappedExpr = `(async () => { return (${expression}); })()`;
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: wrappedExpr, returnByValue: true, awaitPromise: true }
    }));
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id === 1) {
      const result = msg.result?.result;
      if (result?.type === 'object' && result?.subtype === 'error') {
        console.error('Error:', result.description);
      } else {
        console.log(result?.value ?? result?.description ?? JSON.stringify(result));
      }
      ws.close();
      process.exit(0);
    }
  });
  ws.on('error', (e) => {
    console.error('WebSocket error:', e.message);
    process.exit(1);
  });
  setTimeout(() => { console.error('Timeout'); process.exit(1); }, 5000);
}
