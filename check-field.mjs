// A check of the 43-car field without any 3D: run with  node check-field.mjs
// It plays several situations and prints what happened, so a change to the AI
// (ovaldriver.js) or the field (field.js) can be judged by numbers.
import { buildStadiumData } from './stadium.js';
import { Field, RaceCar, Component, LapCounter, planAIs, raceNumbers } from './field.js';
import { OvalDriver } from './ovaldriver.js';

const st = buildStadiumData(), L = st.length, dt = 1 / 120;
// A driver that does nothing (a parked car), or does what a script says
class ScriptDriver extends Component {
  constructor(script = () => ({ throttle: 0, steer: 0, handbrake: true })) { super('driver'); this.script = script; this.mode = 'script'; }
  update(car, dt) { if (!car.held) car.controller.update(this.script(car), dt); }
}
// 43 cars on the grid; the "player" (number 7) sits on the given place with the given driver
function makeField({ place = 43, driver = () => new OvalDriver({ pace: 1, lane: 0 }), type = 'standard' } = {}) {
  const field = new Field(st);
  const player = field.add(new RaceCar({ number: 7, type, track: st, isPlayer: true }));
  player.attach(driver()).attach(new LapCounter());
  for (const pl of planAIs(42, raceNumbers(42, 7))) field.add(new RaceCar({ number: pl.number, type: pl.type, tyre: pl.tyre, track: st })).attach(new OvalDriver(pl.style)).attach(new LapCounter());
  const places = []; let next = 1;
  for (const car of field.cars) { if (car.isPlayer) places.push(place); else { if (next === place) next++; places.push(next++); } }
  field.toGrid(places); field.hold(true); field.update(dt); field.hold(false); field.startTiming(50);
  return { field, player };
}
// Runs a field for some seconds and measures it
function run(field, seconds, each = () => {}) {
  const m = { hits: 0, hard: 0, off: 0, standing: new Map(), longestStand: 0, nan: 0 };
  for (const c of field.cars) c.on('hit', (e, me) => { if (me.number < e.other.number) { m.hits++; if (e.impact > 6) m.hard++; } });
  const t0 = performance.now();
  for (let t = 0; t < seconds; t += dt) {
    field.update(dt); each(t);
    for (const c of field.cars) {
      if (!Number.isFinite(c.x) || !Number.isFinite(c.controller.vx)) m.nan++;
      if (!c.controller.onTrack) m.off += dt;
      if (c.get('driver') instanceof OvalDriver) {
        const s = Math.abs(c.speed) < 0.5 ? (m.standing.get(c) ?? 0) + dt : 0;
        m.standing.set(c, s); if (s > m.longestStand) m.longestStand = s;
      }
    }
  }
  m.msPerStep = (performance.now() - t0) / (seconds / dt);
  const laps = field.cars.filter((c) => c.get('driver') instanceof OvalDriver).map((c) => c.get('laps').lap + c.s / L).sort((a, b) => a - b);
  m.laps = { least: laps[0].toFixed(2), median: laps[laps.length >> 1].toFixed(2), most: laps[laps.length - 1].toFixed(2) };
  return m;
}
const show = (name, m, extra = '') => console.log(name.padEnd(34), 'touches', String(m.hits).padStart(3), '(hard', m.hard + ')', 'off-track car-s', m.off.toFixed(0).padStart(3), 'longest standstill', m.longestStand.toFixed(1).padStart(5), 's  laps least/median/most', m.laps.least, m.laps.median, m.laps.most, extra);

const only = process.argv[2];
const scenarios = {
  // 1. An ordinary race: everybody is an AI
  race() { const { field } = makeField(); const m = run(field, 150); show('1 ordinary race, 150 s', m, '| ' + m.msPerStep.toFixed(2) + ' ms per step, bad numbers ' + m.nan); },
  // 2. The person's screenshot: you never leave your grid place. The field must flow round you, lap after lap.
  parked() { const { field } = makeField({ place: 38, driver: () => new ScriptDriver() }); const m = run(field, 240); show('2 you parked on grid place 38, 240 s', m); },
  // 3. A car parked in the middle of a turn, on the racing line
  parkedInTurn() {
    const { field, player } = makeField({ place: 43, driver: () => new ScriptDriver() });
    const p = st.pointAt(600, 0), c = st.centreAt(600); player.place(p.x, p.z, Math.atan2(c.tx, c.tz));
    const m = run(field, 200); show('3 a car parked in turn 1, 200 s', m);
  },
  // 4. Brake test: a car in the pack suddenly stops dead at full speed (how many run into it?)
  brakeTest() {
    let stopAt = 25;
    const { field, player } = makeField({ place: 20, driver: () => new ScriptDriver((car) => (run.t < stopAt || run.t > stopAt + 6 ? { throttle: 1, steer: car.get('ai').steerFor(car) } : { throttle: -1, steer: 0, handbrake: true })) });
    player.attach(Object.assign(new Component('ai'), { steerFor(car) { const p = st.locate(car.x, car.z), a = st.pointAt(p.s + 25, 0); return Math.max(-1, Math.min(1, 2 * Math.atan2(Math.sin(Math.atan2(a.x - car.x, a.z - car.z) - car.controller.heading), Math.cos(Math.atan2(a.x - car.x, a.z - car.z) - car.controller.heading)))); } }));
    let hitsOnIt = 0; player.on('hit', () => hitsOnIt++);
    const m = run(field, 60, (t) => { run.t = t; }); show('4 a car stops dead at 25 s, 60 s', m, '| hits on the stopped car ' + hitsOnIt);
  },
  // 5. A car across the road: knocked sideways at speed (does the crash clear itself?)
  shove() {
    const { field } = makeField();
    const m = run(field, 90, (t) => { if (Math.abs(t - 30) < dt / 2) { const v = field.cars[12].controller; v.vx += Math.cos(v.heading) * 14; v.vz -= Math.sin(v.heading) * 14; v.spin = 2.5; } });
    show('5 a car shoved sideways at 30 s, 90 s', m);
  },
  // 6. Recovery: a car deep on the infield grass facing away, another nose-first in the wall, another in the pit lane
  recovery() {
    const { field } = makeField(); run(field, 20);
    const g = field.cars[5], w = field.cars[6], q = field.cars[8];
    const pg = st.pointAt(900, -45), cg = st.centreAt(900); g.place(pg.x, pg.z, Math.atan2(cg.tx, cg.tz) + 2.6);
    const pw = st.pointAt(1200, 8.5), cw = st.centreAt(1200); w.place(pw.x, pw.z, Math.atan2(cw.tx, cw.tz) + 1.2);
    const pq = st.pointAt(-200, -26), cq = st.centreAt(-200); q.place(pq.x, pq.z, Math.atan2(cq.tx, cq.tz));
    const back = new Map();
    run(field, 60, (t) => { for (const c of [g, w, q]) if (!back.has(c) && c.controller.onTrack && Math.abs(c.d) < 9.5 && c.speed > 10) back.set(c, t); });
    console.log('6 recovery'.padEnd(34), 'grass car racing again after', back.get(g)?.toFixed(1), 's; wall car after', back.get(w)?.toFixed(1), 's; pit-lane car after', back.get(q)?.toFixed(1), 's');
  },
};
for (const [name, fn] of Object.entries(scenarios)) if (!only || only === name) fn();
