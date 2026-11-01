'use strict';
// Quantum Football server: static files + a tiny dependency-free WebSocket endpoint (/ws).
// One match only. Clients are members in join order (identified by a token that survives a page reload): the first is the admin, the second is "human", the others spectate.
// The admin decides who controls each team; only the admin and the human can take a team.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Match, PARAMS, PRESETS, W, H, GOAL_DEPTH, TEAM_SIZE, CATCH } = require('./sim');
const bots = require('./bots');
const { STRATEGIES } = bots;
const { GameLog } = require('./gamelog');

const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// Build stamp shown on the page: date (Europe/Paris) and short hash of the commit this server runs from, read once at start;
// '+ local changes' when tracked files differ from that commit. Outside a git checkout: 'unknown build'.
function buildInfo(dir = __dirname) {
  const { execFileSync } = require('child_process');
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, TZ: 'Europe/Paris' } }).trim();
  try {
    const head = git('log', '-1', '--date=format-local:%Y-%m-%d %H:%M', '--format=%cd %h');
    return head + (git('status', '--porcelain', '--untracked-files=no') ? ' + local changes' : '');
  } catch { return 'unknown build'; }
}
const BUILD = buildInfo();
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
  // Who controls each team: a strategy name, or null for a human. Default: the 'random' script on both.
  const control = (opts.bots || ['random', 'random']).slice(0, 2);
  for (const [k, val] of Object.entries(opts.params || {})) match.setParam(k, val);
  match.paused = opts.paused !== false; // starts paused: the admin presses play
  match.kickoff(); // some parameters (packet width, wall mode) take effect at kick-off
  // Game log for post-mortems (gamelog.js): opts.logDir turns it on (the server's main sets it unless LOG=0).
  const log = opts.logDir ? new GameLog(opts.logDir, { build: BUILD, preset: opts.preset || 'custom', params: { ...match.params }, bots: control.slice() }, { densEvery: opts.densEvery }) : null;
  const ev = (e, data) => { if (log) log.event(e, data); };
  const fresh = () => { // the admin reloaded: back to the starting controllers and sliders, a new match, paused
    control.splice(0, 2, ...(opts.bots || ['random', 'random']).slice(0, 2));
    match.botState = [{}, {}];
    const p0 = { ...Object.fromEntries(Object.entries(PARAMS).map(([k, d]) => [k, d.def])), ...(opts.params || {}) };
    for (const [k, val] of Object.entries(p0)) match.setParam(k, val);
    match.paused = true;
    match.phase = 'waiting'; // assign() then restarts the match (score, clock, kick-off) once both teams are present
    match.setPresent(0, false);
    ev('fresh', { params: { ...match.params }, bots: control.slice() });
  };
  // Members are clients identified by a token (?id=) that the page keeps across reloads, in join order: the order gives the name
  // ("Client 3") and decides the admin (the earliest) and who gets a free human team. A member whose socket closed stays as a ghost
  // for graceMs and keeps its role, so a reload gives the same name, slot and admin right back.
  const GRACE_MS = opts.graceMs === undefined ? 15000 : opts.graceMs;
  const members = new Map(); // id -> { id, name, sock | null, slot, timer }
  let joined = 0;

  const send = (c, obj) => { if (c.sock && !c.sock.destroyed) c.sock.write(frame(1, Buffer.from(JSON.stringify(obj)))); };
  const broadcast = (obj) => members.forEach((c) => send(c, obj));
  const admin = () => members.values().next().value;
  const role = (c) => { const i = [...members.values()].indexOf(c); return i === 0 ? 'admin' : i === 1 ? 'human' : 'spectator'; };
  const hello = (c) => send(c, { t: 'hello', id: c.id, name: c.name, slot: c.slot, admin: c === admin(), role: role(c), paused: match.paused, strategies: Object.keys(STRATEGIES), defs: PARAMS, params: match.params, grid: { W, H, goalDepth: GOAL_DEPTH, teamSize: TEAM_SIZE, catch: CATCH }, bots: control, preset: opts.preset || 'custom', build: BUILD });
  // Stable roles: a member keeps its team while that team is still a human one; vacant human teams go to the earliest members without one.
  // Members whose slot changed get a new hello (except skip, who is about to get one).
  const assign = (skip, roles = new Map()) => { // roles: each member's role before a departure, so those whose role changed hear about it too
    const free = [0, 1].filter((t) => !control[t]);
    const before = new Map([...members.values()].map((c) => [c, c.slot]));
    const taken = new Set();
    const eligible = [...members.values()].slice(0, 2); // admin and human; spectators never take a team
    for (const c of members.values()) { if (eligible.includes(c) && free.includes(c.slot) && !taken.has(c.slot)) taken.add(c.slot); else c.slot = -1; }
    const vacant = free.filter((t) => !taken.has(t));
    for (const c of eligible) if (c.slot < 0 && vacant.length) c.slot = vacant.shift();
    for (let t = 0; t < 2; t++) match.setPresent(t, !control[t] ? [...members.values()].some((c) => c.slot === t) : true);
    for (const c of members.values()) if (c !== skip && (c.slot !== before.get(c) || (roles.has(c) && roles.get(c) !== role(c)))) hello(c);
  };
  const forget = (c) => { // the grace period is over: the next in line inherits the team, or the admin role
    if (members.get(c.id) !== c || c.sock) return;
    const roles = new Map([...members.values()].map((x) => [x, role(x)]));
    members.delete(c.id);
    assign(null, roles);
  };

  const server = http.createServer((req, res) => {
    const rel = req.url.split('?')[0] === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(PUBLIC, path.normalize(rel));
    if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(data);
    });
  });

  server.on('upgrade', (req, sock) => {
    const url = new URL(req.url, 'http://localhost');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== '/ws' || !key) { sock.destroy(); return; }
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + crypto.createHash('sha1').update(key + GUID).digest('base64') + '\r\n\r\n');
    sock.setNoDelay(true);
    const wanted = url.searchParams.get('id');
    let c = /^[\w-]{1,64}$/.test(wanted || '') ? members.get(wanted) : null;
    if (c) { // a reload or a reconnect: same name, same role
      clearTimeout(c.timer);
      if (c.sock) c.sock.destroy(); // the old page's socket may not have been noticed as closed yet
      c.sock = sock;
      if (c === admin()) { // the admin reloaded: a fresh start, and everybody else refreshes
        fresh();
        assign(c);
        members.forEach((o) => { if (o !== c) send(o, { t: 'reload' }); });
      }
      hello(c);
    } else {
      const id = wanted && /^[\w-]{1,64}$/.test(wanted) && !members.has(wanted) ? wanted : crypto.randomUUID();
      c = { id, name: 'Client ' + ++joined, sock, slot: -1, timer: null };
      members.set(id, c);
      assign(c);
      hello(c);
    }
    ev('join', { name: c.name, role: role(c), slot: c.slot });

    sock.on('data', makeParser(sock, (text) => {
      let m;
      try { m = JSON.parse(text); } catch { return; }
      if (!m) return;
      if (m.t === 'control' && c === admin() && [0, 1].includes(m.team) && (m.who === 'human' || STRATEGIES[m.who])) {
        control[m.team] = m.who === 'human' ? null : m.who;
        match.botState = [{}, {}];
        assign();
        broadcast({ t: 'control', bots: control });
        ev('control', { by: c.name, team: m.team, who: m.who, bots: control.slice() });
        return;
      }
      if (m.t === 'pause' && c === admin()) { match.paused = !!m.on; broadcast({ t: 'paused', paused: match.paused }); ev('pause', { by: c.name, on: match.paused }); return; }
      if (m.t === 'param' && role(c) !== 'spectator' && match.setParam(m.k, m.v)) { broadcast({ t: 'params', params: match.params }); ev('param', { by: c.name, k: m.k, v: match.params[m.k] }); return; } // the admin and the human change the physics, even when no team is theirs
      if (c.slot < 0) return; // spectators only watch
      const mine = Number.isInteger(m.p) && m.p >= 0 && m.p < TEAM_SIZE ? c.slot * TEAM_SIZE + m.p : -1; // you only command your own four
      if (mine < 0 || !['order', 'move', 'stance'].includes(m.t)) return;
      if (m.t === 'order') match.setOrder(mine, m.vx, m.vy);
      else if (m.t === 'move') match.moveTo(mine, m.x, m.y, !!m.queue);
      else match.setStance(mine, m.s);
      ev(m.t, { by: c.name, i: mine, ...(m.t === 'order' ? { vx: m.vx, vy: m.vy } : m.t === 'move' ? { x: m.x, y: m.y, queue: !!m.queue } : { s: m.s }) }); // the player's resulting state is in the next frame
    }));
    const drop = () => {
      if (c.sock !== sock) return;
      c.sock = null;
      ev('leave', { name: c.name });
      c.timer = setTimeout(() => forget(c), GRACE_MS);
      c.timer.unref();
    };
    sock.on('close', drop);
    sock.on('error', drop);
  });

  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    if ((control[0] || control[1]) && !match.paused) bots.drive(match, control);
    const dt = Math.min(0.1, (now - last) / 1000), live = !match.paused && match.phase !== 'waiting';
    match.step(dt); // a no-op while paused
    if (log && live) log.frame(match, dt);
    last = now;
    if (![...members.values()].some((c) => c.sock)) return;
    const s = match.snapshot();
    s.t = 'state';
    s.dens = Buffer.from(s.dens).toString('base64');
    broadcast(s);
  }, TICK_MS);
  server.on('close', () => { clearInterval(timer); members.forEach((c) => clearTimeout(c.timer)); if (log) log.close(); });
  server.gameLog = log; // tests and tools find the file here (log.file)
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, opts.host, () => { server.off('error', reject); resolve(server); }); });
}

// BOTS=receiver,fortress (team 0, team 1; '-' = a human) picks the starting strategies: random turns receiver fortress shadow lanes relay plow chase idle (default random,random).
// The first browser to connect is the admin and can change who controls each team from the band at the top of the page.
// The match starts paused; the admin starts it with the play button. Opening or refreshing the page loads everything afresh (no caching).
// DEMO=1 is BOTS=turns,turns. With a bot on both teams everybody just watches.
// PRESET=default|waves|additive|waves-kick|waves-well|waves-wall|waves-mass|hybrid starts from a named parameter set (docs/VARIANTS.md).
// PARAMS='{"kick":0.5,"additive":1}' overrides slider defaults at start (JSON).
function parseEnv(env) {
  const list = (env.BOTS || (env.DEMO ? 'turns,turns' : 'random,random')).split(',').map((s) => (s && s !== '-' ? s : null));
  const bots = [list[0] || null, list[1] || null];
  bots.forEach((b) => { if (b && !STRATEGIES[b]) throw new Error('unknown bot ' + b + '; have ' + Object.keys(STRATEGIES).join(', ')); });
  if (env.PRESET && !PRESETS[env.PRESET]) throw new Error('unknown preset ' + env.PRESET + '; have ' + Object.keys(PRESETS).join(', '));
  const preset = env.PRESET || 'default';
  return { bots, preset: env.PARAMS ? preset + '+' : preset, params: { ...(PRESETS[env.PRESET] || {}), ...(env.PARAMS ? JSON.parse(env.PARAMS) : {}) } };
}
module.exports = { buildInfo, start, parseEnv };
// Port busy (usually an older run of this server): stop that process if it is a node server.js, then retry.
function killOld(port) {
  const { execSync } = require('child_process');
  let out = '';
  try { out = execSync('ss -ltnpH "sport = :' + port + '"', { encoding: 'utf8' }); } catch { return false; }
  let killed = false;
  for (const [, pid] of out.matchAll(/pid=(\d+)/g)) {
    let cmd = '';
    try { cmd = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8'); } catch { continue; }
    if (+pid === process.pid || !/node/.test(cmd) || !/server\.js/.test(cmd)) { console.log('port ' + port + ' is held by pid ' + pid + ' (' + cmd.replace(/\0/g, ' ') + '), not touching it'); continue; }
    console.log('stopping old server pid ' + pid);
    process.kill(+pid, 'SIGTERM'); killed = true;
  }
  return killed;
}
if (require.main === module) {
  const port = Number(process.env.PORT) || 8080;
  // LOG_DIR=<dir> (default logs/ next to server.js) gets one game log per run; LOG=0 turns it off.
  const logDir = process.env.LOG === '0' ? null : process.env.LOG_DIR || path.join(__dirname, 'logs');
  const go = (retry) => start(port, { ...parseEnv(process.env), logDir }).then(
    (server) => console.log('Quantum Football on http://localhost:' + port + (server.gameLog ? '; game log: ' + server.gameLog.file : '')),
    (err) => {
      if (err.code === 'EADDRINUSE' && retry && killOld(port)) return new Promise((r) => setTimeout(r, 500)).then(() => go(false));
      throw err;
    });
  go(true);
}
