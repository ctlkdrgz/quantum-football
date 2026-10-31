'use strict';
// Quantum Football server: static files + a tiny dependency-free WebSocket endpoint (/ws).
// One match only. The first two connections are players 0 and 1; later ones are spectators.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Match, PARAMS, W, H, GOAL_DEPTH, TEAM_SIZE } = require('./sim');
const bots = require('./bots');
const { STRATEGIES } = bots;

const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const TICK_MS = 33;

function frame(opcode, payload) {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n])
    : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255])
    : Buffer.concat([Buffer.from([0x80 | opcode, 127, 0, 0, 0, 0]), Buffer.from([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255])]);
  return Buffer.concat([head, payload]);
}

// Parses client frames (always masked). Calls onText(string); returns false on protocol abuse.
function makeParser(sock, onText) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const opcode = buf[0] & 15, masked = !!(buf[1] & 128);
      let len = buf[1] & 127, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = buf.readUInt32BE(6); off = 10; }
      if (len > 4096 || !masked) { sock.destroy(); return; }
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      const data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(off + 4 + len);
      if (opcode === 8) { sock.end(frame(8, Buffer.alloc(0))); return; }
      if (opcode === 9) sock.write(frame(10, data));
      else if (opcode === 1) onText(data.toString('utf8'));
    }
  };
}

function start(port, opts = {}) {
  const match = new Match();
  const botNames = opts.bots || [null, null]; // strategy per team, or null for a human
  botNames.forEach((b, t) => { if (b) match.setPresent(t, true); });
  const clients = new Set(); // { sock, slot }

  const send = (c, obj) => { if (!c.sock.destroyed) c.sock.write(frame(1, Buffer.from(JSON.stringify(obj)))); };
  const broadcast = (obj) => clients.forEach((c) => send(c, obj));
  const hello = (c) => send(c, { t: 'hello', slot: c.slot, defs: PARAMS, params: match.params, grid: { W, H, goalDepth: GOAL_DEPTH, teamSize: TEAM_SIZE }, bots: botNames });

  const server = http.createServer((req, res) => {
    const rel = req.url.split('?')[0] === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(PUBLIC, path.normalize(rel));
    if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(data);
    });
  });

  server.on('upgrade', (req, sock) => {
    const key = req.headers['sec-websocket-key'];
    if (req.url !== '/ws' || !key) { sock.destroy(); return; }
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + crypto.createHash('sha1').update(key + GUID).digest('base64') + '\r\n\r\n');
    sock.setNoDelay(true);
    const taken = new Set([...clients].map((c) => c.slot));
    const c = { sock, slot: [0, 1].find((s) => !taken.has(s) && !botNames[s]) ?? -1 }; // teams run by a bot are not available
    clients.add(c);
    if (c.slot >= 0) match.setPresent(c.slot, true);
    hello(c);

    sock.on('data', makeParser(sock, (text) => {
      let m;
      try { m = JSON.parse(text); } catch { return; }
      if (!m || c.slot < 0) return; // spectators only watch
      const mine = Number.isInteger(m.p) && m.p >= 0 && m.p < TEAM_SIZE ? c.slot * TEAM_SIZE + m.p : -1; // you only command your own four
      if (m.t === 'order' && mine >= 0) match.setOrder(mine, m.vx, m.vy);
      else if (m.t === 'stance' && mine >= 0) match.setStance(mine, m.s);
      else if (m.t === 'param' && match.setParam(m.k, m.v)) broadcast({ t: 'params', params: match.params });
    }));
    const drop = () => {
      if (!clients.delete(c)) return;
      if (c.slot < 0) return;
      match.setPresent(c.slot, false);
      const next = [...clients].find((x) => x.slot < 0); // promote the first spectator
      if (next) { next.slot = c.slot; match.setPresent(c.slot, true); hello(next); }
    };
    sock.on('close', drop);
    sock.on('error', drop);
  });

  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    if (botNames[0] || botNames[1]) bots.drive(match, botNames);
    match.step(Math.min(0.1, (now - last) / 1000));
    last = now;
    if (!clients.size) return;
    const s = match.snapshot();
    s.t = 'state';
    s.dens = Buffer.from(s.dens).toString('base64');
    broadcast(s);
  }, TICK_MS);
  server.on('close', () => clearInterval(timer));
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

// BOTS=receiver,fortress (team 0, team 1; '-' = a human) picks strategies: turns receiver fortress shadow lanes relay plow.
// DEMO=1 is BOTS=turns,turns. With a bot on both teams everybody just watches.
function parseEnv(env) {
  const list = (env.BOTS || (env.DEMO ? 'turns,turns' : '')).split(',').map((s) => (s && s !== '-' ? s : null));
  const bots = [list[0] || null, list[1] || null];
  bots.forEach((b) => { if (b && !STRATEGIES[b]) throw new Error('unknown bot ' + b + '; have ' + Object.keys(STRATEGIES).join(', ')); });
  return { bots };
}
module.exports = { start, parseEnv };
if (require.main === module) {
  const port = Number(process.env.PORT) || 8080;
  start(port, parseEnv(process.env)).then(() => console.log('Quantum Football on http://localhost:' + port));
}
