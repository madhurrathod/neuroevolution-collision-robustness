// experiment.mjs: a controlled experiment on the AI car's neural network.
//
// Question: does training with simulated collisions ("shoves") make a neuroevolved
// driver more robust to collisions it has never seen?
//
// Two training conditions, identical except for the shoves:
//   shoves : the 18 training drives of train.mjs, 3 of which include shoves
//   calm   : the same 18 drives (same start points, same lanes) with the shoves removed
// Every network is trained from random weights (no warm start from ai-weights.json),
// with a seeded random-number generator, so each run can be repeated exactly.
//
// Usage:  node experiment.mjs --condition shoves --seed 1 [--out results] [--maxgen 300]
// Writes: <out>/<condition>_seed<seed>.json (learning curve, test results, weights)
//
// This file does not change the game or ai-weights.json.
import { writeFileSync, mkdirSync } from 'node:fs';

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const CONDITION = arg('condition', 'shoves');
const SEED = parseInt(arg('seed', '1'), 10);
const OUT = arg('out', 'results');
const MAX_GEN = parseInt(arg('maxgen', '300'), 10);
if (!['shoves', 'calm'].includes(CONDITION)) throw new Error('--condition must be shoves or calm');

// ---- 1. Seeded randomness -------------------------------------------------------
// ai.js (mutation, crossover, random weights) and the selection below all call
// Math.random. Replacing it with a seeded generator (mulberry32) makes a run with
// the same seed give exactly the same result. The car physics use no randomness.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = mulberry32(SEED * 7919 + 101);

// Imported after the patch (static imports would run first)
const { buildTrackData } = await import('./track.js');
const { CarController, CAR_TYPES } = await import('./car.js');
const { NeuralNet, AIDriver } = await import('./ai.js');

// ---- 2. Settings: the same as train.mjs -----------------------------------------
const POPULATION = 80, KEEP = 8, DT = 1 / 120, MAX_TIME = 75, GOAL_LAPS = 1.25;
const TRAIN_MARGIN = 1.5, DAMAGE_COST = 30, DAMAGE_ALLOWED = 3, RECOVERY = 2.5;
const SOLVED_FOR = 25; // keep training this many generations after first solving every drive

const track = buildTrackData();
const n = track.centerline.length;

// ---- 3. Training drives ---------------------------------------------------------
const LANES = [3.5, -3.5, 0, -2, 4, 2, -4, 1, -3, 3, -1, 0];
const SHOVE_STARTS = [
  { index: 0, lane: 3.5, kicks: [{ at: 5, sideways: 5, spin: 1.2 }, { at: 14, sideways: -4, spin: -1.5 }] },
  { index: Math.floor(n / 3), lane: 0, kicks: [{ at: 7, sideways: -5, spin: 1 }, { at: 18, sideways: 4, spin: -1 }] },
  { index: Math.floor((2 * n) / 3), lane: 0, kicks: [{ at: 4, sideways: 4, spin: -1.5 }, { at: 11, sideways: -5, spin: 1.5 }, { at: 22, forward: -15 }] },
];
const STARTS = [
  ...LANES.map((lane, k) => ({ index: Math.floor((k * n) / LANES.length), lane })),
  ...track.bumps.map((b, k) => ({ index: (b.index - Math.round([6, 3, 9][k % 3] / track.segmentLength) + n) % n, lane: [4, -4, 0][k % 3] })),
  // the only difference between the conditions: calm keeps these drives but removes the shoves
  ...SHOVE_STARTS.map((s) => (CONDITION === 'shoves' ? s : { index: s.index, lane: s.lane })),
];

// One drive (copied from train.mjs so this experiment does not depend on its main program)
function testDrive(net, start, { margin = TRAIN_MARGIN, laps = GOAL_LAPS, maxTime = MAX_TIME } = {}) {
  const car = new CarController(null, track);
  const p = track.centerline[start.index], tg = track.tangents[start.index], nr = track.normals[start.index];
  car.place(p.x + nr.x * start.lane, p.z + nr.z * start.lane, Math.atan2(tg.x, tg.z));
  const ai = new AIDriver(car, net);
  let time = 0, lastKick = -99;
  const kicks = [...(start.kicks ?? [])];
  const goal = laps * track.length;
  while (time < maxTime) {
    if (kicks.length && time >= kicks[0].at) {
      const k = kicks.shift(), fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      car.vx += fz * (k.sideways ?? 0) + fx * (k.forward ?? 0);
      car.vz += -fx * (k.sideways ?? 0) + fz * (k.forward ?? 0);
      car.spin += k.spin ?? 0;
      lastKick = time;
    }
    ai.update(DT);
    time += DT;
    const limit = time - lastKick < RECOVERY ? track.edge : track.width / 2 - margin;
    if (track.distanceAt(car.x, car.z) > limit) return { progress: ai.progress, time, damage: car.damage, crashed: true };
    if (time > 4 && ai.progress < time * 2) return { progress: ai.progress, time, damage: car.damage, crashed: true };
    if (ai.progress >= goal) return { progress: ai.progress, time, damage: car.damage, finished: car.damage <= DAMAGE_ALLOWED };
  }
  return { progress: ai.progress, time, damage: car.damage };
}

// Fitness: metres driven, plus a bonus for finishing fast, minus a penalty for damage, averaged over the drives
function fitness(net) {
  let total = 0, finishedAll = true, worstTime = 0;
  for (const s of STARTS) {
    const r = testDrive(net, s);
    total += r.progress + (r.finished ? (MAX_TIME - r.time) * 20 : 0) - r.damage * DAMAGE_COST;
    if (!r.finished) finishedAll = false; else worstTime = Math.max(worstTime, r.time);
  }
  return { score: total / STARTS.length, finishedAll, worstTime };
}

function pick(ranked) { // tournament selection: the best of 3 picked at random
  let best = null;
  for (let k = 0; k < 3; k++) { const c = ranked[Math.floor(Math.random() * ranked.length)]; if (!best || c.score > best.score) best = c; }
  return best.net;
}

// ---- 4. Evolution (always from random networks) -------------------------------------
const t0 = Date.now();
let population = Array.from({ length: POPULATION }, () => new NeuralNet());
let best = null, solvedFor = 0, firstSolvedGen = null;
const curve = [];
let gen;
for (gen = 1; gen <= MAX_GEN; gen++) {
  const ranked = population.map((net) => ({ net, ...fitness(net) })).sort((a, b) => b.score - a.score);
  if (!best || ranked[0].score > best.score) best = ranked[0];
  curve.push({ gen, best: +ranked[0].score.toFixed(1), median: +ranked[POPULATION >> 1].score.toFixed(1), solved: ranked[0].finishedAll });
  if (best.finishedAll && firstSolvedGen === null) firstSolvedGen = gen;
  if (gen % 10 === 0) console.log(`[${CONDITION} s${SEED}] gen ${gen}: best ${ranked[0].score.toFixed(0)} solved=${ranked[0].finishedAll} ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  solvedFor = best.finishedAll ? solvedFor + 1 : 0;
  if (solvedFor >= SOLVED_FOR) break;
  const next = ranked.slice(0, KEEP).map((r) => r.net);   // elitism: the 8 best go through unchanged
  while (next.length < POPULATION) {
    const child = Math.random() < 0.5 ? NeuralNet.crossover(pick(ranked), pick(ranked)) : pick(ranked).clone();
    next.push(child.mutate(0.15, 0.4));
  }
  population = next;
}
const trainMinutes = (Date.now() - t0) / 60000;

// ---- 5. Held-out test (fixed before seeing any results) -------------------------------
// The 72 drives of train.mjs --check: 12 start points halfway between the training starts
// x 3 lanes, each calm and shoved; plus 36 "hard" drives with stronger shoves (1.4x the
// sideways push and spin), to test robustness beyond the standard test.
function heldOut(k, lane, kind) {
  const s = kind === 'hard' ? 1.4 : 1;
  const kicks = kind === 'calm' ? [] : [
    { at: 3 + k, sideways: (k % 2 ? 5 : -5) * s, spin: (lane > 0 ? 1.5 : -1.5) * s },
    { at: 12 + k, sideways: (k % 3 ? -4 : 4) * s, spin: (k % 2 ? -1 : 1) * s, forward: -8 },
  ];
  return { index: Math.floor(((k + 0.5) * n) / 12), lane, kicks };
}
const test = { calm: [], shoved: [], hard: [] };
for (const kind of ['calm', 'shoved', 'hard']) for (let k = 0; k < 12; k++) for (const lane of [-4, 0, 4]) {
  const r = testDrive(best.net, heldOut(k, lane, kind), { margin: CAR_TYPES.standard.halfWidth, laps: 3, maxTime: 120 });
  test[kind].push({ k, lane, passed: !!r.finished, progress: +r.progress.toFixed(1), damage: +r.damage.toFixed(2), time: +r.time.toFixed(1) });
}
const passed = (kind) => test[kind].filter((r) => r.passed).length;

const result = {
  condition: CONDITION, seed: SEED, generations: gen > MAX_GEN ? MAX_GEN : gen, firstSolvedGen,
  solvedTraining: best.finishedAll, bestScore: +best.score.toFixed(1), trainMinutes: +trainMinutes.toFixed(1),
  passed: { calm: passed('calm'), shoved: passed('shoved'), hard: passed('hard'), outOf: 36 },
  test, curve, weights: best.net.toJSON(),
};
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/${CONDITION}_seed${SEED}.json`, JSON.stringify(result));
console.log(`DONE ${CONDITION} seed ${SEED}: gens ${result.generations}, first solved ${firstSolvedGen}, ` +
  `test calm ${result.passed.calm}/36, shoved ${result.passed.shoved}/36, hard ${result.passed.hard}/36, ${trainMinutes.toFixed(1)} min`);
