'use strict';
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const msg = document.getElementById('msg');
const COLORS = ['#4da3ff', '#ff6b5e'];
const STANCE_NAMES = ['Attack', 'Defense', 'Pass'];
let slot = -1, grid = { W: 100, H: 50, goalDepth: 6 }, params = {}, defs = {}, state = null;
let preset = '', bots = [null, null], cursor = null, drag = null, selected = 0; // drag: {p} while an order is being dragged
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

const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
const sendJSON = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
ws.onclose = () => { msg.textContent = 'disconnected'; };
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.t === 'hello') {
    slot = m.slot; grid = m.grid; bots = m.bots; preset = m.preset; defs = m.defs; params = m.params;
    off.width = grid.W; off.height = grid.H; offCtx = off.getContext('2d'); img = offCtx.createImageData(grid.W, grid.H);
    buildSliders();
    document.title = slot >= 0 ? 'Quantum Football — you are ' + (slot ? 'red' : 'blue') : 'Quantum Football — spectating';
  } else if (m.t === 'params') { params = m.params; syncSliders(); }
  else if (m.t === 'state') { state = m; state.bytes = Uint8Array.from(atob(m.dens), (c) => c.charCodeAt(0)); updateHud(); }
};

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

const STANCE_LETTER = ['A', 'D', 'P'];
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
  if (e.key >= '1' && e.key <= '3') setStance(Number(e.key) - 1);
  if (e.key === 'q' || e.key === 'w' || e.key === 'e' || e.key === 'r') selected = 'qwer'.indexOf(e.key);
});

// Drag from one of your players to give it a velocity vector (1 m of drag = 1 m/s). A click without drag stops it.
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
  sendJSON({ t: 'order', p: drag.p, vx: c.x - p.x, vy: c.y - p.y });
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

  const arrow = (x, y, dx, dy) => { // dx, dy in metres, drawn 1:1
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx * s, y + dy * s); ctx.stroke();
  };
  state.players.forEach((p, i) => {
    const team = i < grid.teamSize ? 0 : 1, mine = team === slot, k = i % grid.teamSize;
    const x = p.x * s, y = p.y * s, r = params.reach * s, a = Math.atan2(p.hy, p.hx);
    const sel = mine && k === selected;
    ctx.strokeStyle = COLORS[team]; ctx.fillStyle = COLORS[team];
    ctx.lineWidth = sel ? 3 : 1.5;
    ctx.setLineDash(p.stance === 1 ? [] : [6, 4]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 16, y + Math.sin(a) * 16);
    ctx.lineTo(x + Math.cos(a + 2.5) * 8, y + Math.sin(a + 2.5) * 8); ctx.lineTo(x + Math.cos(a - 2.5) * 8, y + Math.sin(a - 2.5) * 8); ctx.fill();
    if (p.aim) { // where an Attack push / Pass is aimed: a teammate's predicted position or the goal
      ctx.strokeStyle = COLORS[team] + '66'; ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(p.aim.tx * s, p.aim.ty * s); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(p.aim.tx * s, p.aim.ty * s, 4, 0, 7); ctx.stroke(); ctx.strokeStyle = COLORS[team];
    }
    if (p.vx || p.vy) { ctx.lineWidth = 1.5; arrow(x, y, p.vx, p.vy); } // current velocity order
    if (p.stance === 1) { // defense wall
      const wx = x + Math.cos(a) * r, wy = y + Math.sin(a) * r, l = 1.2 * r * 1.5;
      ctx.lineWidth = 4; ctx.beginPath();
      ctx.moveTo(wx - Math.sin(a) * l, wy + Math.cos(a) * l); ctx.lineTo(wx + Math.sin(a) * l, wy - Math.cos(a) * l); ctx.stroke();
    }
    ctx.fillStyle = '#fff'; ctx.font = '12px system-ui';
    ctx.fillText((k + 1) + STANCE_LETTER[p.stance] + ' ' + Math.round(state.presence[i] * 100) + '%', x - 14, y - 12);
  });
  if (drag && cursor) { // the order being dragged
    const p = myPlayer(drag.p);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
    arrow(p.x * s, p.y * s, cursor.x - p.x, cursor.y - p.y); ctx.setLineDash([]);
  }
  if (slot >= 0 && myPlayer(selected)) {
    document.querySelectorAll('#stances button').forEach((b) => b.classList.toggle('on', Number(b.dataset.s) === myPlayer(selected).stance));
  }
}
requestAnimationFrame(draw);
