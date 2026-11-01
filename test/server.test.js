'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInfo, start } = require('../server');

// Tests never touch a running game: every server takes an OS-chosen port (0), listens on the loopback only, and is closed
// afterwards even when an assertion fails (an open socket would keep the test process alive).
const servers = [], sockets = [];
test.afterEach(() => { for (const w of sockets.splice(0)) w.close(); for (const s of servers.splice(0)) { s.close(); s.closeAllConnections(); } });
const boot = async (opts) => { const s = await start(0, { host: '127.0.0.1', graceMs: 150, ...opts }); servers.push(s); return s.address().port; };
const open = (port, id = '') => new Promise((resolve) => {
  const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws?id=' + id);
  const c = { ws, hello: null, last: null, hellos: 0, reloads: 0 };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'hello') { c.hello = m; c.hellos++; } else if (m.t === 'state') c.last = m; else if (m.t === 'reload') c.reloads++;
  };
  ws.onopen = () => { sockets.push(ws); resolve(c); };
});
const until = async (f) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 30)); assert.ok(f()); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test('first two browsers play, the third spectates, and a free slot is reused', async () => {
  const port = await boot({ bots: [null, null] });
  const a = await open(port), b = await open(port), c = await open(port);
  await until(() => a.hello && b.hello && c.hello);
  assert.deepEqual([a.hello.slot, b.hello.slot, c.hello.slot], [0, 1, -1]);
  assert.deepEqual([a.hello.name, b.hello.name, c.hello.name], ['Client 1', 'Client 2', 'Client 3'], 'join order defines the names');
  await until(() => a.last && a.last.phase === 'countdown');

  c.ws.send(JSON.stringify({ t: 'param', k: 'mass', v: 3 })); // spectators cannot change anything
  a.ws.send(JSON.stringify({ t: 'param', k: 'mass', v: 2 }));
  await until(() => a.last && a.last.t === 'state');
  const res = await fetch('http://127.0.0.1:' + port + '/');
  assert.equal(res.status, 200);
  assert.equal((await fetch('http://127.0.0.1:' + port + '/..%2Fserver.js')).status, 404);

  a.ws.send(JSON.stringify({ t: 'order', p: 2, vx: 6, vy: 0 }));
  b.ws.send(JSON.stringify({ t: 'order', p: 9, vx: 6, vy: 0 })); // out of range: ignored
  b.ws.send(JSON.stringify({ t: 'stance', p: 1, s: 2 }));
  await until(() => a.last.players[2].vx > 0 && a.last.players[5].stance === 2); // a commands 0-3, b commands 4-7
  assert.equal(a.last.players.filter((p) => p.vx > 0).length, 1);

  a.ws.close(); // player 0 leaves for good: the spectator takes that slot, and the other player is not moved
  await until(() => c.hello.slot === 0);
  assert.equal(b.hello.slot, 1);
  assert.deepEqual([b.hello.slot, b.hello.admin, b.hellos], [1, true, 2], 'b keeps its team and, as the earliest left, inherits the admin role (second hello)');
});

test('the first client is admin and chooses who controls each team, live', async () => {
  const port = await boot({ bots: ['random', 'random'] });
  const a = await open(port), b = await open(port);
  await until(() => a.hello && b.hello);
  assert.deepEqual([a.hello.bots, a.hello.admin, b.hello.admin, a.hello.slot, b.hello.slot], [['random', 'random'], true, false, -1, -1]);
  assert.ok(a.hello.strategies.includes('random'));
  b.ws.send(JSON.stringify({ t: 'control', team: 0, who: 'human' })); // not the admin: ignored
  a.ws.send(JSON.stringify({ t: 'control', team: 1, who: 'nope' })); // unknown script: ignored
  a.ws.send(JSON.stringify({ t: 'control', team: 0, who: 'human' }));
  await until(() => a.hello.slot === 0);
  assert.deepEqual([a.hello.bots, b.hello.slot], [[null, 'random'], -1]);
  a.ws.close(); // the admin leaves for good: b becomes admin and takes the human team
  await until(() => b.hello.admin && b.hello.slot === 0);
});

test('a non-admin who reloads gets the old name and role back; nobody else is moved', async () => {
  const port = await boot({ bots: [null, null] });
  const a = await open(port), b = await open(port), c = await open(port);
  await until(() => a.hello && b.hello && c.hello);
  b.ws.close(); // b reloads: same token, a moment later (within the grace period)
  await pause(30);
  const b2 = await open(port, b.hello.id);
  await until(() => b2.hello);
  assert.deepEqual([b2.hello.name, b2.hello.slot, b2.hello.admin], ['Client 2', 1, false]);
  await pause(250); // the grace period passes: the spectator must not have taken b's team
  assert.deepEqual([a.hello.slot, c.hello.slot, a.hellos, c.hellos, a.reloads, c.reloads], [0, -1, 1, 1, 0, 0]);
  assert.equal(b2.hello.id, b.hello.id);
});

test('when the admin reloads they keep name, role and admin right; everybody else is told to refresh', async () => {
  const port = await boot({ bots: [null, null] });
  const a = await open(port), b = await open(port), c = await open(port);
  await until(() => a.hello && b.hello && c.hello);
  a.ws.close();
  await pause(30);
  const a2 = await open(port, a.hello.id);
  await until(() => a2.hello && b.reloads && c.reloads);
  assert.deepEqual([a2.hello.name, a2.hello.slot, a2.hello.admin], ['Client 1', 0, true]);
  assert.deepEqual([b.reloads, c.reloads, a2.reloads], [1, 1, 0]);
  // the others come back with their tokens and find their roles unchanged
  const b2 = await open(port, b.hello.id), c2 = await open(port, c.hello.id);
  await until(() => b2.hello && c2.hello);
  assert.deepEqual([b2.hello.name, b2.hello.slot, b2.hello.admin, c2.hello.name, c2.hello.slot], ['Client 2', 1, false, 'Client 3', -1]);
  await pause(250);
  assert.equal(a2.hello.admin, true);
});

test('when the admin reloads, the game starts afresh: starting controllers and sliders, score 0, clock at 0, paused', async () => {
  const port = await boot({ bots: ['fortress', null], params: { kick: 1 } });
  const a = await open(port), b = await open(port);
  await until(() => a.hello && b.hello);
  a.ws.send(JSON.stringify({ t: 'pause', on: false }));
  a.ws.send(JSON.stringify({ t: 'param', k: 'kick', v: 2.5 }));
  a.ws.send(JSON.stringify({ t: 'param', k: 'mass', v: 2 }));
  a.ws.send(JSON.stringify({ t: 'control', team: 0, who: 'lanes' }));
  await until(() => b.last && !b.last.paused && b.last.phase === 'playing');
  a.ws.close();
  await pause(30);
  const a2 = await open(port, a.hello.id);
  await until(() => a2.hello && a2.last);
  assert.deepEqual([a2.hello.admin, a2.hello.paused, a2.hello.bots, a2.hello.params.kick, a2.hello.params.mass], [true, true, ['fortress', null], 1, 0.7]);
  assert.deepEqual([a2.last.score, a2.last.phase, a2.last.paused, a2.last.clock], [[0, 0], 'countdown', true, 0]);
  assert.equal(b.reloads, 1);
});

test('a client that stays away longer than the grace period loses its role to the next in line', async () => {
  const port = await boot({ bots: [null, null] });
  const a = await open(port), b = await open(port), c = await open(port);
  await until(() => a.hello && b.hello && c.hello);
  b.ws.close();
  await until(() => c.hello.slot === 1);
  const b2 = await open(port, b.hello.id); // too late: a new member with a new name
  await until(() => b2.hello);
  assert.deepEqual([b2.hello.slot, b2.hello.name], [-1, 'Client 4']);
});

test('a human plays the free team against a bot; both-bot matches take no players', async () => {
  const p1 = await boot({ bots: ['fortress', null] });
  const h = await open(p1);
  await until(() => h.hello && h.last);
  assert.equal(h.hello.slot, 1, 'the human gets the team the bot does not run');
  await until(() => h.last.phase === 'countdown'); // match starts at once: the bot team is already present
  const p2 = await boot({ paused: false, bots: ['lanes', 'shadow'], preset: 'default', params: {} });
  const w = await open(p2);
  await until(() => w.hello);
  assert.equal(w.hello.slot, -1);
  await until(() => w.last && w.last.phase === 'playing' && w.last.params === undefined);
});

test('roles, pause and sliders: admin / human / spectators, starts paused, admin plays, admin and human move sliders', async () => {
  const port = await boot({ bots: [null, null] });
  const a = await open(port), b = await open(port), c = await open(port);
  await until(() => a.hello && b.hello && c.hello && a.last && a.last.phase === 'countdown');
  assert.deepEqual([a.hello.role, b.hello.role, c.hello.role], ['admin', 'human', 'spectator']);
  assert.equal(a.hello.paused, true);
  const t0 = a.last.timer;
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual([a.last.paused, a.last.timer], [true, t0], 'paused: the clock does not move');
  b.ws.send(JSON.stringify({ t: 'pause', on: false })); // not the admin: ignored
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(a.last.paused, true);
  a.ws.send(JSON.stringify({ t: 'pause', on: false }));
  await until(() => a.last.paused === false && a.last.timer < t0);
  b.ws.send(JSON.stringify({ t: 'param', k: 'packetWidth', v: 7 }));
  a.ws.send(JSON.stringify({ t: 'param', k: 'mass', v: 2 }));
  c.ws.send(JSON.stringify({ t: 'param', k: 'mass', v: 3 })); // spectator: ignored
  let seen = null;
  c.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'params') seen = m.params; };
  await until(() => seen && seen.mass === 2);
  assert.equal(seen.packetWidth, 7);
  a.ws.send(JSON.stringify({ t: 'pause', on: true }));
  await until(() => a.last.paused === true);
});

test('static files are never cached, so a browser refresh reloads the whole app', async () => {
  const port = await boot({ bots: [null, null] });
  const res = await fetch('http://127.0.0.1:' + port + '/client.js');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('build stamp: the commit date and hash, sent in hello; a folder outside git gives unknown build', async () => {
  const port = await boot({ bots: [null, null] });
  const a = await open(port);
  await until(() => a.hello);
  assert.match(a.hello.build, /^\d{4}-\d\d-\d\d \d\d:\d\d [0-9a-f]{4,}( \+ local changes)?$/);
  assert.equal(buildInfo(require('os').tmpdir()), 'unknown build');
});
