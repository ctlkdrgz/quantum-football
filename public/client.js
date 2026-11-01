'use strict';
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const msg = document.getElementById('msg');
const COLORS = ['#4da3ff', '#ff6b5e'];
const STANCE_NAMES = ['Defense', 'Pass', 'Shot', 'Dribble'];
let slot = -1, grid = { W: 100, H: 50, goalDepth: 6 }, params = {}, defs = {}, state = null;
let myName = '', admin = false, strategies = [], preset = '', bots = [null, null], cursor = null, drag = null, selected = 0; // drag: {p} while a move is being dragged
const sliders = {};

const off = document.createElement('canvas');
let offCtx, img;

// Colour ramp for the probability heat map: black -> deep blue -> cyan -> yellow -> white.
const ramp = new Uint8ClampedArray(256 * 3);
(function () {
  const stops = [[0, 0, 0, 0], [0.25, 20, 30, 140], [0.55, 30, 200, 230], [0.8, 250, 220, 60], [1, 255, 255, 255]];
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = stops[0], b = stops[1];
    for (let k = 1; k < stops.length; k++) if (t <= stops[k][0]) { a = stops[k - 1]; b = stops[k]; break; }
    const f = (t - a[0]) / (b[0] - a[0] || 1);
    for (let c = 0; c < 3; c++) ramp[i * 3 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * f;
  }
})();

// The id (kept per tab across reloads) gives this page its name and role back after a refresh.
const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?id=' + encodeURIComponent(sessionStorage.getItem('qfId') || ''));
const sendJSON = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
ws.onclose = () => { msg.textContent = 'disconnected'; };
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.t === 'reload') { location.reload(); return; } // the admin refreshed: everybody follows
  if (m.t === 'hello') {
    sessionStorage.setItem('qfId', m.id); myName = m.name;
    slot = m.slot; admin = m.admin; strategies = m.strategies; grid = m.grid; bots = m.bots; preset = m.preset; defs = m.defs; params = m.params;
    off.width = grid.W; off.height = grid.H; offCtx = off.getContext('2d'); img = offCtx.createImageData(grid.W, grid.H);
    buildSliders();
    document.title = 'Quantum Football — ' + myName + (slot >= 0 ? ', ' + (slot ? 'red' : 'blue') : ', spectating');
    buildBand();
  } else if (m.t === 'control') { bots = m.bots; buildBand(); }
  else if (m.t === 'params') { params = m.params; syncSliders(); }
  else if (m.t === 'state') { state = m; state.bytes = Uint8Array.from(atob(m.dens), (c) => c.charCodeAt(0)); updateHud(); }
};

// Top band: the admin (first client to connect) picks who controls each team; the others see it read-only.
function buildBand() {
  const body = document.getElementById('band-body');
  body.textContent = '';
  ['blue', 'red'].forEach((name, t) => {
    const lab = document.createElement('label');
    lab.style.cssText = 'display:inline;margin-right:16px;font-size:14px';
    lab.className = 't' + t;
    lab.append(name + ': ');
    if (admin) {
      const sel = document.createElement('select');
      for (const who of ['human', ...strategies]) sel.add(new Option(who, who));
      sel.value = bots[t] || 'human';
      sel.onchange = () => sendJSON({ t: 'control', team: t, who: sel.value });
      lab.append(sel);
    } else lab.append(bots[t] || 'human');
    body.append(lab);
  });
  const note = document.createElement('span');
  note.style.color = 'var(--dim)';
  note.textContent = admin ? myName + ', admin: "human" teams go to the earliest clients' : myName + ', only the admin changes this';
  body.append(note);
}

function buildSliders() {
  const box = document.getElementById('sliders');
  box.textContent = '';
  for (const k of Object.keys(defs)) {
    const d = defs[k];
    const label = document.createElement('label');
    const val = document.createElement('span');
    label.append(d.label, val);
    const input = document.createElement('input');
    input.type = 'range'; input.min = d.min; input.max = d.max; input.step = d.step; input.value = params[k];
    input.disabled = slot < 0;
    input.oninput = () => { val.textContent = input.value; sendJSON({ t: 'param', k, v: Number(input.value) }); };
    label.append(input);
    box.append(label);
    sliders[k] = { input, val };
  }
  syncSliders();
}
function syncSliders() {
  for (const k of Object.keys(sliders)) {
    if (document.activeElement !== sliders[k].input) sliders[k].input.value = params[k];
    sliders[k].val.textContent = Math.round(params[k] * 100) / 100;
  }
}

const STANCE_LETTER = ['D', 'P', 'S', 'B'];
const fieldPos = (e) => {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * grid.W, y: (e.clientY - r.top) / r.height * grid.H };
};
const myPlayer = (k) => state && state.players[slot * grid.teamSize + k];

function setStance(s) {
  if (slot < 0) return;
  sendJSON({ t: 'stance', p: selected, s });
  if (myPlayer(selected)) myPlayer(selected).stance = s; // optimistic; the next state confirms
}
document.querySelectorAll('#stances button').forEach((b) => { b.onclick = () => setStance(Number(b.dataset.s)); });
addEventListener('keydown', (e) => {
  if (e.key >= '1' && e.key <= '4') setStance(Number(e.key) - 1);
  if (e.key === 'q' || e.key === 'w' || e.key === 'e' || e.key === 'r') selected = 'qwer'.indexOf(e.key);
});

let shiftDown = false;
addEventListener('keydown', (e) => { if (e.key === 'Shift') shiftDown = true; });
addEventListener('keyup', (e) => { if (e.key === 'Shift') shiftDown = false; });
// Drag from one of your players and drop: it runs there at max speed and stops. Shift-drop queues the destination after the current path.
// A drop within 0.5 m of the start (a plain click) stops the player; with shift it changes nothing.
canvas.addEventListener('pointerdown', (e) => {
  if (slot < 0 || !state) return;
  const c = fieldPos(e);
  let best = -1, bd = 4; // pick radius, metres
  for (let k = 0; k < grid.teamSize; k++) { const p = myPlayer(k), d = Math.hypot(p.x - c.x, p.y - c.y); if (d < bd) { bd = d; best = k; } }
  if (best < 0) return;
  selected = best; drag = { p: best }; cursor = c;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => { if (drag) cursor = fieldPos(e); });
canvas.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const c = fieldPos(e), p = myPlayer(drag.p);
  if (e.shiftKey) sendJSON({ t: 'move', p: drag.p, x: c.x, y: c.y, queue: true });
  else if (Math.hypot(c.x - p.x, c.y - p.y) < 0.5) sendJSON({ t: 'move', p: drag.p, x: p.x, y: p.y }); // click: stop
  else sendJSON({ t: 'move', p: drag.p, x: c.x, y: c.y });
  drag = null;
});

function updateHud() {
  document.getElementById('s0').textContent = state.score[0];
  document.getElementById('s1').textContent = state.score[1];
  const mm = Math.floor(state.remaining / 60), ss = String(Math.floor(state.remaining % 60)).padStart(2, '0');
  const who = slot < 0 ? 'spectating' : 'you are ' + (slot ? 'red' : 'blue') + ', player ' + (selected + 1) + ' selected';
  let t;
  if (state.phase === 'waiting') t = 'waiting for the second player…';
  else if (state.phase === 'countdown') t = 'kick-off in ' + Math.ceil(state.timer);
  else if (state.phase === 'goal') t = (state.lastScorer ? 'RED' : 'BLUE') + ' scores!';
  else if (state.phase === 'over') t = 'full time — ' + (state.score[0] === state.score[1] ? 'draw' : state.score[0] > state.score[1] ? 'blue wins' : 'red wins');
  else t = mm + ':' + ss;
  const names = bots[0] || bots[1] ? ' · blue: ' + (bots[0] || 'human') + ' / red: ' + (bots[1] || 'human') : '';
  msg.textContent = t + ' · ' + who + names + ' · ball length ' + Math.round(state.length) + ' m · ' + state.waves.toFixed(1) + ' waves';
}

function draw() {
  requestAnimationFrame(draw);
  if (!state || !img) return;
  const { W, H, goalDepth } = grid, cw = canvas.width, ch = canvas.height, s = cw / W;
  const px = img.data, b = state.bytes;
  for (let i = 0; i < W * H; i++) {
    px[i * 4] = ramp[b[i] * 3]; px[i * 4 + 1] = ramp[b[i] * 3 + 1]; px[i * 4 + 2] = ramp[b[i] * 3 + 2]; px[i * 4 + 3] = 255;
  }
  offCtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, 0, 0, cw, ch);

  // goals + their probability bars
  const gh = params.goalHeight, gy = (H / 2 - gh / 2) * s, thr = params.threshold;
  for (let side = 0; side < 2; side++) {
    const x = side === 0 ? 0 : cw - goalDepth * s;
    ctx.strokeStyle = COLORS[side]; ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, gy, goalDepth * s - 2, gh * s);
    const p = state.goalP[side], bh = Math.min(1, p / thr) * gh * s;
    ctx.fillStyle = COLORS[side] + 'aa';
    ctx.fillRect(side === 0 ? goalDepth * s + 4 : cw - goalDepth * s - 12, gy + gh * s - bh, 8, bh);
  }

  state.players.forEach((p, i) => {
    const team = i < grid.teamSize ? 0 : 1, mine = team === slot, k = i % grid.teamSize;
    const x = p.x * s, y = p.y * s, r = params.reach * s, a = Math.atan2(p.hy, p.hx);
    const sel = mine && k === selected;
    ctx.strokeStyle = COLORS[team]; ctx.fillStyle = COLORS[team];
    ctx.lineWidth = sel ? 3 : 1.5;
    ctx.setLineDash(p.stance === 0 ? [] : [6, 4]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 16, y + Math.sin(a) * 16);
    ctx.lineTo(x + Math.cos(a + 2.5) * 8, y + Math.sin(a + 2.5) * 8); ctx.lineTo(x + Math.cos(a - 2.5) * 8, y + Math.sin(a - 2.5) * 8); ctx.fill();
    if (p.aim) { // where the kick goes: one target (Defense, Shot) or every ally (Pass), the line fainter the less likely
      ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
      for (const a of p.aim) {
        ctx.strokeStyle = COLORS[team] + Math.round(40 + 140 * a.w).toString(16).padStart(2, '0');
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(a.tx * s, a.ty * s); ctx.stroke();
        ctx.setLineDash([]); ctx.beginPath(); ctx.arc(a.tx * s, a.ty * s, 4, 0, 7); ctx.stroke(); ctx.setLineDash([2, 5]);
      }
      ctx.setLineDash([]); ctx.strokeStyle = COLORS[team];
    }
    if (mine && p.path && p.path.length) { // the planned path, thin and dotted
      ctx.lineWidth = 1; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(x, y);
      for (const t of p.path) ctx.lineTo(t.x * s, t.y * s);
      ctx.stroke(); ctx.setLineDash([]);
      for (const t of p.path) { ctx.beginPath(); ctx.arc(t.x * s, t.y * s, 3, 0, 7); ctx.stroke(); }
    }
    ctx.fillStyle = '#fff'; ctx.font = '12px system-ui';
    ctx.fillText((k + 1) + STANCE_LETTER[p.stance] + ' ' + Math.round(state.presence[i] * 100) + '%', x - 14, y - 12);
  });
  if (drag && cursor) { // the move being dragged: from the end of the current path (shift) or from the player
    const p = myPlayer(drag.p), q = shiftDown && p.path.length ? p.path[p.path.length - 1] : p;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(q.x * s, q.y * s); ctx.lineTo(cursor.x * s, cursor.y * s); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(cursor.x * s, cursor.y * s, 3, 0, 7); ctx.stroke();
  }
  if (slot >= 0 && myPlayer(selected)) {
    document.querySelectorAll('#stances button').forEach((b) => b.classList.toggle('on', Number(b.dataset.s) === myPlayer(selected).stance));
  }
}
requestAnimationFrame(draw);
