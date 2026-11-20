// The field: every car in the race as an object built from parts.
//
// A RaceCar owns a CarController (the physics) and a 3D model, and gets its behaviour
// from components that are attached to it and can be detached again: a driver (the
// player's keys or an AI), a lap counter, ... Each component has a name, is told when it
// is attached or detached, and gets an update(car, dt) call every physics step, in the
// order they were attached. A car also sends events ("lap", "finish", "hit") that anything
// can listen to with car.on(event, handler).
//
// The Field holds the cars, the collisions between them and the running order.
import { CarController } from './car.js';
import { TYRES, DEFAULT_TYRE, tyreFits } from './tyres.js';
import { collideCars } from './collision.js';

export class Component {
  constructor(name) { this.name = name; }
  attach(car) {}       // called when the component is put on a car
  detach(car) {}       // ...and when it is taken off
  update(car, dt) {}   // one physics step
}

export class RaceCar {
  // Either a new car of the given type and tyre on the track, or a wrapper round an existing CarController
  constructor({ number, type = 'standard', tyre = DEFAULT_TYRE[type], track, mesh = null, livery = null, isPlayer = false, controller = null }) {
    this.number = number;
    this.livery = livery;
    this.isPlayer = isPlayer;
    this.controller = controller ?? new CarController(mesh, track, { type, tyre });
    this.mesh = controller ? controller.mesh : mesh;
    this.components = new Map();
    this.listeners = new Map();
    this.held = false;          // true while the car must stand still (on the grid before the green light)
    this.field = null;
    this.s = 0; this.d = 0;     // where the car is along and across the track (kept fresh by the lap counter)
  }
  get track() { return this.controller.track; }
  get type() { return this.controller.type; }
  get x() { return this.controller.x; }
  get z() { return this.controller.z; }
  get speed() { return this.controller.speed; }
  get name() { return (this.isPlayer ? 'You' : 'Car') + ' #' + this.number; }

  attach(component) {
    if (this.components.has(component.name)) this.detach(component.name);
    this.components.set(component.name, component);
    component.attach(this);
    return this;
  }
  detach(name) {
    const component = this.components.get(name);
    if (!component) return null;
    component.detach(this);
    this.components.delete(name);
    return component;
  }
  get(name) { return this.components.get(name) ?? null; }
  has(name) { return this.components.has(name); }

  on(event, handler) { if (!this.listeners.has(event)) this.listeners.set(event, new Set()); this.listeners.get(event).add(handler); return this; }
  off(event, handler) { this.listeners.get(event)?.delete(handler); }
  emit(event, data) { for (const handler of this.listeners.get(event) ?? []) handler(data, this); }

  // Put the car on a grid place (or anywhere), standing still
  place(x, z, heading) {
    this.controller.place(x, z, heading);
    for (const c of this.components.values()) c.placed?.(this);
  }
  // Give the car a new 3D model (the pit stop changes wheels that way)
  setMesh(mesh) { this.mesh = mesh; this.controller.mesh = mesh; }

  update(dt) {
    for (const c of this.components.values()) c.update(this, dt);
  }
}

// ---------------------------------------------------------------------------
// Drivers: whatever turns a car's situation into throttle and steering
// ---------------------------------------------------------------------------
// The player: drives the CarController with the keys. busy() says when somebody else
// has the car (the pit crew), so the keys must do nothing.
export class PlayerDriver extends Component {
  constructor(input, { busy = () => false } = {}) { super('driver'); this.input = input; this.busy = busy; }
  update(car, dt) {
    if (car.held || this.busy()) return;
    car.controller.update(this.input, dt);
  }
}

// ---------------------------------------------------------------------------
// Lap counting: eight checkpoints in order, the start line first
// ---------------------------------------------------------------------------
export class LapCounter extends Component {
  // laps: how many laps the race has; gates: checkpoints per lap; inside: how far into the
  // infield (m) a car may be and still pass a checkpoint (so the pit lane counts, cutting does not)
  constructor({ laps = 5, gates = 8, inside = -60 } = {}) {
    super('laps');
    this.laps = laps; this.gates = gates; this.inside = inside;
    this.active = false;      // counting only while the race is on
    this.reset();
  }
  reset(car) {
    Object.assign(this, { lap: -1, next: 0, time: 0, lapStart: 0, last: null, best: null, lapTimes: [], finished: false, finishTime: null });
    this.lastS = car ? this.locate(car).s : 0;
  }
  placed(car) { this.lastS = this.locate(car).s; }
  locate(car) { const p = car.track.locate(car.x, car.z); car.s = p.s; car.d = p.d; return p; }
  // laps completed times the lap length, plus the distance into the current lap: who is ahead
  // (before the first crossing of the line the lap is -1 and s is just under a lap, so this is a little below 0)
  progress(car) { return this.lap * car.track.length + car.s; }
  update(car, dt) {
    const L = car.track.length, p = this.locate(car);
    if (!this.active) { this.lastS = p.s; return; }
    let ds = p.s - this.lastS;
    if (ds > L / 2) ds -= L; else if (ds < -L / 2) ds += L;
    const before = this.lastS;
    this.lastS = p.s;
    if (this.finished) return;                        // the race is over for this car: nothing more is counted
    this.time += dt;
    // not moving forwards, jumped, or deep in the infield: no checkpoint
    if (ds <= 0 || ds > 5 || p.d < this.inside) return;
    const mark = (this.next * L) / this.gates;
    const passed = this.next === 0 ? before > L / 2 && p.s < L / 2 : before < mark && p.s >= mark;
    if (!passed) return;
    this.next = (this.next + 1) % this.gates;
    if (this.next !== 1) return;
    // the start line
    if (this.lap >= 0) {
      this.last = this.time - this.lapStart; this.best = this.best === null ? this.last : Math.min(this.best, this.last);
      this.lapTimes.push(this.last); this.lapStart = this.time;
    }
    this.lap++;                                       // (the first crossing only starts lap 1: its clock has run since the green light)
    car.emit('lap', { lap: this.lap, time: this.last });
    if (this.lap >= this.laps && !this.finished) { this.finished = true; this.finishTime = this.time; car.emit('finish', { time: this.time }); }
  }
}

// ---------------------------------------------------------------------------
// The field
// ---------------------------------------------------------------------------
export class Field {
  constructor(track) { this.track = track; this.cars = []; this.finishOrder = []; this.collisions = 0; }
  add(car) {
    car.field = this;
    this.cars.push(car);
    car.on('finish', () => { if (!this.finishOrder.includes(car)) this.finishOrder.push(car); });
    return car;
  }
  remove(car) { const k = this.cars.indexOf(car); if (k >= 0) this.cars.splice(k, 1); car.field = null; }
  get player() { return this.cars.find((c) => c.isPlayer) ?? null; }
  get ais() { return this.cars.filter((c) => !c.isPlayer); }

  // Everybody on the grid, standing still. places: grid place (1 = pole) for each car, in the cars' order
  toGrid(places) {
    this.finishOrder = [];
    this.cars.forEach((car, k) => {
      const g = this.track.grid[places[k] - 1];
      car.place(g.x, g.z, g.heading);
      const laps = car.get('laps'); if (laps) { laps.active = false; laps.reset(car); }
    });
  }
  hold(on) { for (const car of this.cars) car.held = on; }
  // The green light: the clocks start
  startTiming(laps) { for (const car of this.cars) { const c = car.get('laps'); if (c) { c.laps = laps; c.reset(car); c.active = true; } } }

  update(dt) {
    for (const car of this.cars) car.update(dt);
    // collisions: only cars close together along the track can touch; a pair more
    // than REACH metres apart along the track is never tested
    const REACH = 16, L = this.track.length, cs = this.cars;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      let gap = Math.abs(cs[j].s - cs[i].s); if (gap > L / 2) gap = L - gap;
      if (gap > REACH) continue;
      const impact = collideCars(cs[i].controller, cs[j].controller);
      if (impact !== null && impact > 1) { this.collisions++; cs[i].emit('hit', { other: cs[j], impact }); cs[j].emit('hit', { other: cs[i], impact }); }
    }
  }

  // Running order: cars that have finished first (in finishing order), then by distance covered
  standings() {
    const progress = (car) => car.get('laps')?.progress(car) ?? 0;
    return [...this.cars].sort((a, b) => {
      const fa = this.finishOrder.indexOf(a), fb = this.finishOrder.indexOf(b);
      if (fa >= 0 || fb >= 0) return (fa >= 0 ? fa : 1e9) - (fb >= 0 ? fb : 1e9);
      return progress(b) - progress(a);
    });
  }
  position(car) { return this.standings().indexOf(car) + 1; }
}

// ---------------------------------------------------------------------------
// Building a field of 43 different cars
// ---------------------------------------------------------------------------
// A small repeatable random number source, so a field can be rebuilt the same way
export function seededRandom(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// The mix of cars in the field. Each entry: kind of car, and the share of the AI cars that drive it.
export const FIELD_MIX = [
  { type: 'standard', share: 0.4 },
  { type: 'f1', share: 0.35 },
  { type: 'neon', share: 0.25 },
];

// Picks the kind of car, tyres and driving style for every AI car: what makes them
// different from each other. Returns one plan per car: { number, type, tyre, style }.
// numbers: the race numbers to give out (unique, the player's one not among them).
export function planAIs(count, numbers, rng = seededRandom(7)) {
  const plans = [];
  for (let k = 0; k < count; k++) {
    // walk the mix so the shares come out right whatever the count
    const pick = (k + 0.5) / count;
    let acc = 0, type = FIELD_MIX[FIELD_MIX.length - 1].type;
    for (const m of FIELD_MIX) { acc += m.share; if (pick < acc) { type = m.type; break; } }
    const tyres = Object.keys(TYRES).filter((id) => tyreFits(id, type));
    const tyre = tyres[Math.floor(rng() * tyres.length)];
    plans.push({
      number: numbers[k], type, tyre,
      style: {
        pace: 0.86 + rng() * 0.14,             // how much of the car's top speed the driver uses (0.86-1.0)
        lane: -5 + rng() * 10,                 // preferred distance from the middle of the road (m, + = towards the wall)
        caution: 0.8 + rng() * 0.6,            // bigger = keeps a longer gap to the car in front
        reaction: 0.15 + rng() * 0.5,          // seconds after the green light before this driver goes
        nerve: 0.7 + rng() * 0.35,             // how late it brakes: the share of the car's real braking it counts on (0.7-1.05: the boldest overdo it)
        focus: 8 + rng() * 32,                 // average seconds between lapses of attention (8-40)
      },
    });
  }
  // shuffle so the kinds of car are mixed through the grid
  for (let i = plans.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [plans[i], plans[j]] = [plans[j], plans[i]]; }
  return plans;
}

// Unique race numbers 1-99 for the AI cars (never the player's)
export function raceNumbers(count, playerNumber, rng = seededRandom(11)) {
  const pool = []; for (let n = 1; n <= 99; n++) if (n !== playerNumber) pool.push(n);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, count);
}

// Where the player starts: last, or (half the time) somewhere in the last 30% of the grid
export function playerGridPlace(count, rng = Math.random) {
  if (rng() < 0.5) return count;
  const from = Math.floor(count * 0.7) + 1;                      // 31 of 43
  return from + Math.floor(rng() * (count - from + 1));
}
