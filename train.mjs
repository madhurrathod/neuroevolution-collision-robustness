// Trains the AI car's neural network by evolution and saves it to ai-weights.json.
// Run from this folder:  node train.mjs          (train, check, save; starts from the saved network)
//                        node train.mjs --fresh  (the same, starting from random networks)
//                        node train.mjs --check  (only check the saved network)
// It uses the same track and car physics as the game, without any graphics.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildTrackData } from './track.js';
import { CarController, CAR_TYPES } from './car.js';
import { NeuralNet, AIDriver, LAYERS } from './ai.js';

const POPULATION = 80;
const KEEP = 8;              // best networks copied unchanged into the next generation
const GENERATIONS = 300;     // upper limit; stops early once the goal is reached
const DT = 1 / 120;          // simulation step (s), the same fixed step the game uses
const MAX_TIME = 75;         // seconds per test drive
const GOAL_LAPS = 1.25;      // each training drive must cover this many laps
const TRAIN_MARGIN = 1.5;    // in training, coming within this of the asphalt's edge ends the drive (m)
const DAMAGE_COST = 30;      // each % of damage (from hitting speed bumps too fast) costs this many metres of score
const DAMAGE_ALLOWED = 3;    // a drive only counts as a success with no more than this much damage (%)
const WEIGHTS = new URL('./ai-weights.json', import.meta.url);

const track = buildTrackData();
const n = track.centerline.length;

// Each network is tested from several places, so it learns the whole loop,
// not just one memorised start: 12 standing starts round the loop, in different lanes.
// In some drives the car also gets shoved sideways and spun (as if another car
// hit it), so it learns to recover from collisions.
const LANES = [3.5, -3.5, 0, -2, 4, 2, -4, 1, -3, 3, -1, 0];
const STARTS = [
  ...LANES.map((lane, k) => ({ index: Math.floor((k * n) / LANES.length), lane })),   // 12 standing starts round the loop
  // standing starts a few metres before each speed bump (a stopped car must pull away forwards, not back off)
  ...track.bumps.map((b, k) => ({ index: (b.index - Math.round([6, 3, 9][k % 3] / track.segmentLength) + n) % n, lane: [4, -4, 0][k % 3] })),
  { index: 0, lane: 3.5, kicks: [{ at: 5, sideways: 5, spin: 1.2 }, { at: 14, sideways: -4, spin: -1.5 }] },
  { index: Math.floor(n / 3), lane: 0, kicks: [{ at: 7, sideways: -5, spin: 1 }, { at: 18, sideways: 4, spin: -1 }] },
  { index: Math.floor((2 * n) / 3), lane: 0, kicks: [{ at: 4, sideways: 4, spin: -1.5 }, { at: 11, sideways: -5, spin: 1.5 }, { at: 22, forward: -15 }] },
];
const RECOVERY = 2.5;   // seconds after a shove during which touching the curbs is allowed

function testDrive(net, start, { margin = TRAIN_MARGIN, laps = GOAL_LAPS, maxTime = MAX_TIME } = {}) {
  const dt = DT;
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
    ai.update(dt);
    time += dt;
    // Counts as a crash once the car's centre is within `margin` of the asphalt's edge,
    // so the trained driver keeps its wheels off the curbs. Just after a shove it only
    // has to stay on the road (curbs included).
    const limit = time - lastKick < RECOVERY ? track.edge : track.width / 2 - margin;
    if (track.distanceAt(car.x, car.z) > limit) return { progress: ai.progress, time, damage: car.damage, crashed: true };
    if (time > 4 && ai.progress < time * 2) return { progress: ai.progress, time, damage: car.damage, crashed: true }; // too slow / backwards
    if (ai.progress >= goal) return { progress: ai.progress, time, damage: car.damage, finished: car.damage <= DAMAGE_ALLOWED };
  }
  return { progress: ai.progress, time, damage: car.damage };
}

function fitness(net) {
  let total = 0, finishedAll = true, worstTime = 0;
  for (const s of STARTS) {
    const r = testDrive(net, s);
    // metres driven, plus a bonus for finishing quickly, minus a penalty for damage
    total += r.progress + (r.finished ? (MAX_TIME - r.time) * 20 : 0) - r.damage * DAMAGE_COST;
    if (!r.finished) finishedAll = false; else worstTime = Math.max(worstTime, r.time);
  }
  return { score: total / STARTS.length, finishedAll, worstTime };
}

function pick(ranked) { // tournament selection
  let best = null;
  for (let k = 0; k < 3; k++) { const c = ranked[Math.floor(Math.random() * ranked.length)]; if (!best || c.score > best.score) best = c; }
  return best.net;
}

// A saved network from before (even one with fewer inputs) gives training a head
// start: inputs it does not know about get weights of zero.
function savedNetwork() {
  try {
    const saved = JSON.parse(readFileSync(WEIGHTS, 'utf8'));
    const [oldIn, hidden, out] = saved.layers, [newIn] = LAYERS;
    if (hidden !== LAYERS[1] || out !== LAYERS[2] || oldIn > newIn) return null;
    const w = []; let p = 0;
    for (let j = 0; j < hidden; j++) { w.push(saved.weights[p++]); for (let i = 0; i < newIn; i++) w.push(i < oldIn ? saved.weights[p++] : 0); }
    while (p < saved.weights.length) w.push(saved.weights[p++]);
    return new NeuralNet(LAYERS, w);
  } catch { return null; }
}

function train() {
  // Half the first generation are variations of the saved network (if there is one), half are random
  const seed = process.argv.includes('--fresh') ? null : savedNetwork();
  let population = Array.from({ length: POPULATION }, (_, k) => (seed && k < POPULATION / 2 ? (k ? seed.mutate(0.15, 0.4) : seed) : new NeuralNet()));
  console.log(seed ? 'starting from the saved network' : 'starting from random networks');
  let best = null, solvedFor = 0;
  for (let gen = 1; gen <= GENERATIONS; gen++) {
    const ranked = population.map((net) => ({ net, ...fitness(net) })).sort((a, b) => b.score - a.score);
    if (!best || ranked[0].score > best.score) best = ranked[0];
    console.log(`gen ${gen}: best ${ranked[0].score.toFixed(0)}  finished all starts: ${ranked[0].finishedAll ? 'yes, ' + ranked[0].worstTime.toFixed(1) + ' s' : 'no'}`);
    solvedFor = best.finishedAll ? solvedFor + 1 : 0;
    if (solvedFor >= (seed ? 12 : 25)) break;   // keep polishing lap time for a while after it first succeeds
    const next = ranked.slice(0, KEEP).map((r) => r.net);
    while (next.length < POPULATION) {
      const child = Math.random() < 0.5 ? NeuralNet.crossover(pick(ranked), pick(ranked)) : pick(ranked).clone();
      next.push(child.mutate(0.15, 0.4));
    }
    population = next;
  }
  return best;
}

let net;
if (process.argv.includes('--check')) {
  net = NeuralNet.fromJSON(JSON.parse(readFileSync(WEIGHTS, 'utf8')));
} else {
  const best = train();
  net = best.net;
  writeFileSync(WEIGHTS, JSON.stringify({ ...net.toJSON(), trainedOn: new Date().toISOString(), score: +best.score.toFixed(1) }));
  console.log('saved ai-weights.json');
}

// Check on drives it never trained on: 12 points round the loop x 3 lanes, each once
// undisturbed and once with shoves at times and strengths it has not seen. A drive
// passes if the car does 3 laps with all its wheels on the asphalt (centre at least
// half a car's width from the edge), except for the moments just after a shove,
// and without damaging itself on the speed bumps.
let passed = 0, total = 0, slowest = 0;
for (let k = 0; k < 12; k++) for (const lane of [-4, 0, 4]) for (const shoved of [false, true]) {
  const kicks = shoved ? [{ at: 3 + k, sideways: k % 2 ? 5 : -5, spin: lane > 0 ? 1.5 : -1.5 }, { at: 12 + k, sideways: k % 3 ? -4 : 4, spin: k % 2 ? -1 : 1, forward: -8 }] : [];
  const r = testDrive(net, { index: Math.floor(((k + 0.5) * n) / 12), lane, kicks }, { margin: CAR_TYPES.standard.halfWidth, laps: 3, maxTime: 120 });
  total++; if (r.finished) passed++;
  else console.log(`  failed: start ${k}, lane ${lane}${shoved ? ', shoved' : ''}, after ${r.progress.toFixed(0)} m, damage ${r.damage.toFixed(0)}%`);
  slowest = Math.max(slowest, r.time);
}
console.log(`check: ${passed} of ${total} test drives completed 3 laps with all wheels on the asphalt and no more than ${DAMAGE_ALLOWED}% damage (half of the drives with shoves); slowest took ${slowest.toFixed(0)} s`);
