// stress.mjs: stress test for the networks trained by experiment.mjs.
//
// The held-out test in experiment.mjs turned out too easy (most networks passed 36/36:
// a "ceiling effect"). Here every saved network is tested again with shoves of
// increasing strength, to find where each one starts to fail. No training happens:
// the weights are read from results/<condition>_seed<N>.json.
//
// Usage:  node stress.mjs results/calm_seed1.json      (writes results/stress_calm_seed1.json)
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { buildTrackData } from './track.js';
import { CarController, CAR_TYPES } from './car.js';
import { NeuralNet, AIDriver } from './ai.js';

const file = process.argv[2];
const saved = JSON.parse(readFileSync(file, 'utf8'));
const net = NeuralNet.fromJSON(saved.weights);

// shove strength, as a multiple of the standard held-out test (1x = the "shoved" test)
const SCALES = [1, 1.5, 2, 2.5, 3, 3.5, 4];
const DT = 1 / 120, DAMAGE_ALLOWED = 3, RECOVERY = 2.5;
const track = buildTrackData();
const n = track.centerline.length;

// The same drive and pass rule as the held-out test: 3 laps, all wheels on the asphalt
// (except for 2.5 s after a shove), no more than 3% damage
function testDrive(start) {
  const car = new CarController(null, track);
  const p = track.centerline[start.index], tg = track.tangents[start.index], nr = track.normals[start.index];
  car.place(p.x + nr.x * start.lane, p.z + nr.z * start.lane, Math.atan2(tg.x, tg.z));
  const ai = new AIDriver(car, net);
  let time = 0, lastKick = -99;
  const kicks = [...start.kicks];
  const goal = 3 * track.length, margin = CAR_TYPES.standard.halfWidth;
  while (time < 120) {
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
    if (track.distanceAt(car.x, car.z) > limit) return { passed: false, why: 'off road', progress: ai.progress };
    if (time > 4 && ai.progress < time * 2) return { passed: false, why: 'too slow', progress: ai.progress };
    if (ai.progress >= goal) return car.damage <= DAMAGE_ALLOWED ? { passed: true } : { passed: false, why: 'damage', progress: ai.progress };
  }
  return { passed: false, why: 'timeout', progress: ai.progress };
}

// The same 36 start points and shove pattern as the held-out "shoved" test, scaled
function start(k, lane, s) {
  return {
    index: Math.floor(((k + 0.5) * n) / 12), lane,
    kicks: [
      { at: 3 + k, sideways: (k % 2 ? 5 : -5) * s, spin: (lane > 0 ? 1.5 : -1.5) * s },
      { at: 12 + k, sideways: (k % 3 ? -4 : 4) * s, spin: (k % 2 ? -1 : 1) * s, forward: -8 },
    ],
  };
}

const levels = [];
for (const s of SCALES) {
  const drives = [];
  for (let k = 0; k < 12; k++) for (const lane of [-4, 0, 4]) drives.push({ k, lane, ...testDrive(start(k, lane, s)) });
  levels.push({ scale: s, passed: drives.filter((d) => d.passed).length, outOf: drives.length, drives });
}
const out = `${dirname(file)}/stress_${basename(file)}`;
writeFileSync(out, JSON.stringify({ condition: saved.condition, seed: saved.seed, scales: SCALES, levels }));
console.log(`${saved.condition} seed ${saved.seed}: ` + levels.map((l) => `${l.scale}x ${l.passed}/36`).join('  '));
