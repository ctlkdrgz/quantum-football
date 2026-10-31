'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('../server');

const open = (port) => new Promise((resolve) => {
  const ws = new WebSocket('ws://localhost:' + port + '/ws');
  const c = { ws, hello: null, last: null };
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'hello') c.hello = m; if (m.t === 'state') c.last = m; };
  ws.onopen = () => resolve(c);
});
const until = async (f) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 30)); assert.ok(f()); };

test('first two browsers play, the third spectates, and a free slot is reused', async () => {
  const server = await start(0);
  const port = server.address().port;
  const a = await open(port), b = await open(port), c = await open(port);
  await until(() => a.hello && b.hello && c.hello);
  assert.deepEqual([a.hello.slot, b.hello.slot, c.hello.slot], [0, 1, -1]);
  await until(() => a.last && a.last.phase === 'countdown');

  c.ws.send(JSON.stringify({ t: 'param', k: 'mass', v: 3 })); // spectators cannot change anything
  a.ws.send(JSON.stringify({ t: 'param', k: 'mass', v: 2 }));
  await until(() => a.last && a.last.t === 'state');
  const res = await fetch('http://localhost:' + port + '/');
  assert.equal(res.status, 200);
  assert.equal((await fetch('http://localhost:' + port + '/..%2Fserver.js')).status, 404);

  a.ws.close(); // player 0 leaves: spectator takes the slot
  await until(() => c.hello.slot === 0);
  [b, c].forEach((x) => x.ws.close());
  server.close(); server.closeAllConnections();
});
