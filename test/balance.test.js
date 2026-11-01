'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Worker, isMainThread, workerData, parentPort } = require('node:worker_threads');
const { Match, W, H } = require('../sim');
const { drive, STRATEGIES } = require('../bots');

// Balance of a bot against itself: full 90 s match, score difference and the time-averaged share of the wave in team 0's half.
function selfMatch(s) {
  const m = new Match(); m.setPresent(0, true); m.setPresent(1, true); m.setParam('matchSeconds', 90); m.restart(); m.phase = 'playing';
  let left = 0, n = 0, k = 0;
  for (; m.phase !== 'over' && k < 30 * 600; k++) {
    drive(m, [s, s]); m.step(1 / 30);
    if (k % 15 === 0) {
      const D = m.density(); let a = 0, b = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (x < W / 2) a += D[y * W + x]; else b += D[y * W + x]; }
      left += a / (a + b); n++;
    }
  }
  return { diff: Math.abs(m.score[0] - m.score[1]), share: left / n };
}

if (!isMainThread) {
  parentPort.postMessage(selfMatch(workerData));
} else {
  // one worker thread per bot, so the matches use all cores instead of running one after the other
  const names = Object.keys(STRATEGIES).filter((n) => n !== 'random');
  const results = new Map(names.map((s) => [s, new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: s });
    w.once('message', resolve); w.once('error', reject);
  })]));
  for (const s of names) {
    test('balance [self-play]: ' + s + ' against itself ends within one goal and holds the wave near mid-pitch', async () => {
      const r = await results.get(s);
      console.log('# self-play', s.padEnd(9), 'diff', r.diff, 'left-half share', r.share.toFixed(3));
      assert.ok(r.diff <= 1, 'score difference ' + r.diff);
      assert.ok(Math.abs(r.share - 0.5) < 0.1, 'left-half share ' + r.share.toFixed(3));
    });
  }
}
