// The AI driver for the stadium oval: a set of rules, not a neural network.
//
// Every driver looks at the cars around it (a short distance behind, further ahead the
// faster it goes) and works out, for every line across the road, how fast it could drive
// there. It takes the best line it can reach: the emptier side on a straight, the inside
// by preference in a turn, its own favourite line when the road is clear. So a slow or
// standing car is driven round, not queued behind. Only when the whole width is blocked
// does it wait.
//
// Drivers are not perfect: each has its own nerve (how late it brakes) and its own
// lapses of attention, and a hard knock leaves a driver without control for a moment. So
// cars do run into the back of one that stops dead, and a car that is hit can end up in the
// wall or on the grass. From there it gets itself back onto the road (reversing if it has
// to). No car is ever respawned.
import { Component, seededRandom } from './field.js';

export const DRIVING = {
  lookMin: 14, lookPerSpeed: 0.45, lookMax: 70,   // how far ahead the driver aims its steering (m): further the faster it goes
  steerGain: 2.2,           // steering per radian of heading error
  laneMax: 8.3,             // the widest line from the middle of the road (the road is 10 m to each side)
  laneStep: 1,              // lines across the road are tried this far apart (m)
  laneChange: 1.6,          // how quickly the car slides to a new line (per second); faster when it has to avoid something
  sideRoom: 0.5,            // a line is free of a car if I would pass it with this much air between us (m)...
  touchRoom: 0.2,           // ...and a car ahead that I would pass with less than this is one I am driving into
  roomPerSpeed: 0.012,      // ...plus this much more for every m/s I am faster than it (1.1 m when passing a parked car at 340 km/h)
  alongside: 3,             // a line that would bring me close to a car alongside is this much less attractive (m/s)
  horizon: 25, horizonTime: 1.6, horizonMax: 180,   // how far ahead traffic matters: 25 m plus 1.6 s of driving (m)
  behind: 30,               // ...and how far behind (for not cutting in front of a faster car) (m)
  minGap: 1.5,              // never willingly closer than this to the car in front (m, bumper to bumper)
  shiftCost: 0.25,          // moving a metre sideways has to be worth this much speed (m/s)
  homeCost: 0.08,           // ...and being a metre from the driver's favourite line costs this much
  keep: 1,                  // the line chosen last time gets this bonus, so drivers do not dither (m/s)
  crowd: 0.3,               // each car ahead near a line makes it this much less attractive (m/s): go where there is less traffic
  inside: 2.5,              // in a turn, passing on the inside is worth this much extra (m/s)
  cutIn: 6,                 // pulling out in front of a much faster car from behind costs this much (m/s)
  settle: 6,                // seconds after the start in which everybody holds their grid column (unless the car in front has stalled)
  waitBeforeRound: 1,       // seconds standing behind a standing car before manoeuvring round it
  patience: 4,              // ...and before squeezing through whatever gap there is, touching or not
  lapse: [0.4, 1.2],        // a lapse of attention lasts this long (s, shortest and longest): the car carries on as it was
  dazeImpact: 6,            // a knock harder than this (m/s) leaves the driver without control for a moment
  stuckAfter: 1.5,          // seconds standing still (while trying to go) before it reverses out
  reverseFor: 1.3,          // ...and for how long
  offRoadThrottle: 0.6,     // gentle on the grass
  thinkEvery: 4,            // the driver decides every 4th physics step (30 times a second); the physics still runs every step
};

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class OvalDriver extends Component {
  // style (from planAIs in field.js):
  //   pace      share of the car's top speed this driver uses
  //   lane      favourite line, metres from the middle of the road (+ = towards the wall)
  //   caution   bigger = keeps a longer gap
  //   reaction  seconds after the green light before it goes
  //   nerve     0.7-1: how much of the car's real braking power it counts on (1 = brakes at the last moment)
  //   focus     average seconds between lapses of attention
  constructor(style = {}) {
    super('driver');
    this.style = { pace: 0.95, lane: 0, caution: 1, reaction: 0.3, nerve: 0.85, focus: 40, ...style };
    this.random = seededRandom(Math.round(1000 * (this.style.lane + 7) + 100000 * this.style.pace));
    this.lane = this.style.lane;     // the line it is steering for right now
    this.goal = this.style.lane;     // the line it has chosen
    this.out = { throttle: 0, steer: 0 };
    this.placed();
  }
  attach(car) {
    // a knock: a hard one leaves the driver without control for a moment, a light one startles it
    this.onHit = (e) => {
      if (e.impact > DRIVING.dazeImpact) this.dazed = Math.max(this.dazed, Math.min(2, 0.4 + e.impact * 0.06));
      else this.lapse = Math.max(this.lapse, 0.2);
    };
    car.on('hit', this.onHit);
  }
  detach(car) { car.off('hit', this.onHit); }
  placed(car) {
    const d = car ? car.track.locate(car.x, car.z).d : this.style.lane;
    Object.assign(this, { lane: d, goal: d, stuckTime: 0, reverseTime: 0, waitTime: 0, manoeuvre: null, lapse: 0, dazed: 0,
      delay: this.style.reaction, since: 0, mode: 'race', tick: 0, queued: false });
  }

  update(car, dt) {
    const c = car.controller;
    if (car.held) { this.delay = this.style.reaction; return; }
    if (this.delay > 0) { this.delay -= dt; c.update({ throttle: 0, steer: 0, handbrake: true }, dt); return; }
    this.since += dt;
    if (this.dazed > 0) { this.dazed -= dt; this.mode = 'dazed'; c.update({ throttle: 0, steer: 0 }, dt); return; }   // no hands on the wheel
    if (this.lapse > 0) this.lapse -= dt;                                    // not paying attention: carries on as it was
    else if (this.tick++ % DRIVING.thinkEvery === 0) this.think(car, dt * DRIVING.thinkEvery);
    c.update(this.out, dt);
  }

  // A decision: what the throttle and steering should be for the next few steps
  think(car, dt) {
    const c = car.controller, p = car.track.locate(c.x, c.z);
    car.s = p.s; car.d = p.d;
    const racing = c.onTrack && p.d > -17;      // (tarmac further in than that is the pit lane, not the track)
    let out;
    if (this.reverseTime > 0) { this.reverseTime -= dt; out = this.backOut(car, p); }
    else if (racing) out = this.race(car, p, dt);
    else out = this.recover(car, p);
    // wanting to go but standing still (nose against the wall, wedged sideways): back out.
    // Waiting behind a car that is itself standing still is not being stuck.
    this.stuckTime = Math.abs(c.speed) < 0.4 && out.throttle > 0 && !this.queued ? this.stuckTime + dt : 0;
    if (this.stuckTime > DRIVING.stuckAfter) { this.reverseTime = DRIVING.reverseFor; this.stuckTime = 0; }
    this.mode = this.reverseTime > 0 ? 'reverse' : racing ? 'race' : 'recover';
    // now and then a driver's attention wanders for a moment
    if (racing && c.speed > 10 && this.random() < dt / this.style.focus) this.lapse = DRIVING.lapse[0] + this.random() * (DRIVING.lapse[1] - DRIVING.lapse[0]);
    this.out = out;
  }

  // Steering towards a point of the track (s ahead, line d): + = left
  steerTo(car, s, d) {
    const c = car.controller, aim = car.track.pointAt(s, d);
    const err = wrapAngle(Math.atan2(aim.x - c.x, aim.z - c.z) - c.heading);
    return { err, steer: clamp(err * DRIVING.steerGain, -1, 1) };
  }

  race(car, p, dt) {
    const c = car.controller, D = DRIVING, track = car.track, L = track.length, speed = c.speed, style = this.style;
    const limit = c.maxSpeed * style.pace;                       // this driver's own speed limit
    const braking = style.nerve;                                 // (above 1: counts on more braking than the car has)
    // the gap this driver keeps: a minimum, plus a time gap (bolder drivers sit closer)
    const keepGap = D.minGap * style.caution + Math.max(0, speed) * style.caution * (0.3 - 0.2 * (style.nerve - 0.7) / 0.3);

    // The cars that matter: a little way behind, and ahead as far as the horizon. For each:
    // how far ahead (ds) and where across the road (d), its speed, how much room it takes up
    // sideways and lengthways as it stands (a car lying across the road blocks a lot of road),
    // and the gap between its tail and my nose.
    const horizon = Math.min(D.horizonMax, D.horizon + Math.max(0, speed) * D.horizonTime);
    const near = [];
    for (const o of car.field ? car.field.cars : []) {
      if (o === car) continue;
      let ds = o.s - p.s; if (ds > L / 2) ds -= L; else if (ds < -L / 2) ds += L;
      if (ds < -D.behind || ds > horizon) continue;
      const oc = o.controller, turn = oc.heading - c.heading, cs = Math.abs(Math.cos(turn)), sn = Math.abs(Math.sin(turn));
      const len = c.halfLength + cs * oc.halfLength + sn * oc.halfWidth, closing = Math.max(0, speed - o.speed);
      const wide = c.halfWidth + cs * oc.halfWidth + sn * oc.halfLength;    // centres this far apart sideways: paint touching
      // (the speed it allows me if it is in my way: its own speed plus what I can brake off in the gap to it)
      const gap = ds - len, room = Math.max(0, gap - keepGap);
      near.push({ ds, d: o.d, v: o.speed, gap, len, alongside: Math.abs(ds) <= len + 1.5, inFront: gap >= -1,
        allows: o.speed + Math.min(room * 0.8, Math.sqrt(2 * c.brake * room) * braking),
        touch: wide + D.touchRoom + D.roomPerSpeed * closing * 0.5,         // closer than this sideways and I would drive into it
        clear: wide + D.sideRoom + D.roomPerSpeed * closing });             // a line this far from it is a free line (more room at speed)
    }
    // How fast could I drive along line x? The slowest of what the cars in front on that line allow.
    const allowedIn = (x, width = 'clear') => {
      let a = limit;
      for (const n of near) if (n.inFront && n.allows < a && Math.abs(n.d - x) < n[width]) a = n.allows;
      return a;
    };
    // Can I get to line x, or is a car alongside in the way?
    const reachable = (x) => {
      const move = x - p.d;
      for (const n of near) {
        if (!n.alongside) continue;
        const side = n.d - p.d;
        if (side * move > 0 && Math.abs(move) > Math.abs(side) - n.clear) return false;
      }
      return true;
    };

    const here = allowedIn(p.d, 'touch');
    const blocked = here < limit - 2;                                       // somebody is holding me up
    // standing behind a standing car; after a while patience runs out and the driver pushes through
    this.waitTime = here < 1 && Math.abs(speed) < 1 ? this.waitTime + dt : 0;
    const pushing = this.waitTime > D.patience || (this.manoeuvre !== null && this.manoeuvre.time > D.patience);

    // Choose the line. In the first seconds of the race everybody holds their grid column,
    // unless the car in front has not moved.
    if (this.since > D.settle || this.waitTime > D.waitBeforeRound || this.manoeuvre) {
      const turning = track.bankAt(p.s + 30) > 0.09;                       // the banking says a turn is here or just ahead
      let best = this.goal, bestScore = -Infinity;
      for (let x = -D.laneMax; x <= D.laneMax + 0.01; x += D.laneStep) {
        if (!pushing && Math.abs(x - p.d) > 0.8 && !reachable(x)) continue;
        // the speed of the line itself; and a car that stands between me and that line counts
        // too (cutting across the nose of a slow car is no way round it)
        let fast = limit;
        const move = x - p.d;
        for (const n of near) {
          if (!n.inFront || n.allows >= fast) continue;
          const side = n.d - p.d;
          if (Math.abs(n.d - x) < n.clear || (side * move > 0 && Math.abs(side) < Math.abs(move))) fast = n.allows;
        }
        let score = fast - D.shiftCost * Math.abs(x - p.d) - D.homeCost * Math.abs(x - style.lane);
        if (Math.abs(x - this.goal) < D.laneStep * 0.6) score += D.keep;
        if (turning && blocked && x < p.d - 1) score += D.inside;          // the inside of a turn is the shorter way round
        for (const n of near) {
          if (n.alongside) { if (!pushing && Math.abs(n.d - x) < n.clear) score -= D.alongside; }   // keep clear of a car alongside
          else if (n.ds > 0 && Math.abs(n.d - x) < 5.4) score -= D.crowd;               // less traffic that side?
          // do not pull out right in front of somebody coming up fast behind
          else if (n.ds < 0 && Math.abs(n.d - x) < n.clear && Math.abs(x - p.d) > 1 && n.v - speed > 3 && (-n.ds - n.len) / (n.v - speed) < 1.5) score -= D.cutIn;
        }
        if (score > bestScore) { bestScore = score; best = x; }
      }
      this.goal = best;
    }
    const urgent = blocked && here < speed - 3;                             // closing on something: move over smartly
    this.lane += (this.goal - this.lane) * (1 - Math.exp(-(urgent ? 2.5 : 1) * D.laneChange * dt));

    // Speed: what my own path allows (where I am, and where I am moving to)
    let want = Math.min(here, allowedIn(p.d + clamp(this.lane - p.d, -1.5, 1.5), 'touch'));
    let look = clamp(D.lookMin + speed * D.lookPerSpeed, D.lookMin, D.lookMax);
    this.queued = want < 1;

    // Standing behind a standing car with a free line beside it: swing out round it. If
    // there is not enough room in front to turn out, back up first (if nobody is right behind).
    const free = Math.abs(this.goal - p.d) > 0.4 && allowedIn(this.goal) > 4;
    if (!this.manoeuvre && this.waitTime > D.waitBeforeRound && free) this.manoeuvre = { time: 0, go: 0 };
    if (this.manoeuvre) {
      const m = this.manoeuvre;
      m.time += dt;
      let ahead = null, behind = Infinity;                                   // the car in front of my nose, and the room behind me
      for (const n of near) {
        if (n.gap >= -1 && Math.abs(n.d - p.d) < n.touch && (!ahead || n.gap < ahead.gap)) ahead = n;
        if (n.ds < 0 && Math.abs(n.d - p.d) < n.touch) behind = Math.min(behind, -n.ds - n.len);
      }
      if (!free || m.time > 12 || !ahead) this.manoeuvre = null;             // nothing in front of my nose any more, or no free line any more
      else {
        // how far sideways I must move to clear it, and the room that takes at full lock
        const away = (p.d - ahead.d) * (this.goal - p.d) >= 0;
        const sideways = away ? ahead.touch - Math.abs(p.d - ahead.d) : ahead.touch + Math.abs(p.d - ahead.d);
        if (m.go <= 0 && (ahead.gap >= sideways / 0.55 || pushing)) m.go = 2.5;       // room enough to swing out (or patience gone): go
        if (m.go > 0) { m.go -= dt; this.lane = this.goal; look = 6; want = Math.max(want, 3); this.queued = false; }
        else if (behind >= 1.5) return { throttle: -0.6, steer: 0 };
        else { this.queued = true; return { throttle: 0, steer: 0, handbrake: true }; }   // boxed in: the cars round me have to move first
      }
    }

    this.view = { here, want, free, pushing, go: this.manoeuvre ? this.manoeuvre.go : null, near: near.length };   // (for check-field.mjs and debugging)
    const { steer, err } = this.steerTo(car, p.s + look, this.lane);
    if (Math.abs(err) > 1.7) return { throttle: -0.6, steer: -Math.sign(err) };   // facing backwards on the road: reverse-turn round
    const throttle = want >= limit ? (speed < limit ? 1 : speed > limit + 1 ? -0.2 : 0) : clamp(want - speed, -1, 1);
    return { throttle, steer, handbrake: throttle <= 0 && Math.abs(speed) < 1.5 };   // (the handbrake stops a waiting car rolling back down the banking)
  }

  // Off the track: head for the nearest bit of road at a gentle speed. In the pit lane,
  // where a wall stands between the car and the track, follow the pit road to its end first.
  recover(car, p) {
    const pit = car.track.pit, L = car.track.length;
    const signed = p.s > L / 2 ? p.s - L : p.s;
    const inPit = pit && p.d < pit.wall - 0.5 && signed > pit.wallFrom - 20 && signed < pit.wallTo;
    const aimD = inPit ? (pit.roadOuter + pit.roadInner) / 2 : clamp(p.d, -7, 7);
    const { steer, err } = this.steerTo(car, p.s + (inPit ? 25 : 14), aimD);
    if (Math.abs(err) > 1.7) return { throttle: -0.6, steer: -Math.sign(err) };   // pointing away from it: reverse-turn
    return { throttle: inPit ? 0.7 : DRIVING.offRoadThrottle, steer };
  }

  // Reversing away from whatever stopped the car, turning towards the road
  backOut(car, p) {
    const { err } = this.steerTo(car, p.s + 14, clamp(p.d, -7, 7));
    return { throttle: -0.7, steer: -clamp(err * 2, -1, 1) };
  }
}
