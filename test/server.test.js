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
  const server = await start(0, { bots: [null, null] });
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

  a.ws.send(JSON.stringify({ t: 'order', p: 2, vx: 6, vy: 0 }));
  b.ws.send(JSON.stringify({ t: 'order', p: 9, vx: 6, vy: 0 })); // out of range: ignored
  b.ws.send(JSON.stringify({ t: 'stance', p: 1, s: 2 }));
  await until(() => a.last.players[2].vx > 0 && a.last.players[5].stance === 2); // a commands 0-3, b commands 4-7
  assert.equal(a.last.players.filter((p) => p.vx > 0).length, 1);

  a.ws.close(); // player 0 leaves: spectator takes the slot
  await until(() => c.hello.slot === 0);
  [b, c].forEach((x) => x.ws.close());
  server.close(); server.closeAllConnections();
});

test('the first client is admin and chooses who controls each team', async () => {
  const server = await start(0);
  const port = server.address().port;
  const a = await open(port), b = await open(port);
  await until(() => a.hello && b.hello);
  assert.deepEqual([a.hello.bots, a.hello.admin, b.hello.admin, a.hello.slot, b.hello.slot], [['random', 'random'], true, false, -1, -1]);
  assert.ok(a.hello.strategies.includes('random'));
  b.ws.send(JSON.stringify({ t: 'control', team: 0, who: 'human' })); // not the admin: ignored
  a.ws.send(JSON.stringify({ t: 'control', team: 1, who: 'nope' })); // unknown script: ignored
  a.ws.send(JSON.stringify({ t: 'control', team: 0, who: 'human' }));
  await until(() => a.hello.slot === 0);
  assert.deepEqual([a.hello.bots, b.hello.slot], [[null, 'random'], -1]);
  a.ws.close(); // the admin leaves: b becomes admin and takes the human team
  await until(() => b.hello.admin && b.hello.slot === 0);
  b.ws.close();
  server.close(); server.closeAllConnections();
});
