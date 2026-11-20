// The AI driver: a small neural network that looks at the road through
// "sensor rays" and decides how to steer and how much throttle to give.
//
//   inputs (10): distance to the road edge along 7 rays fanning out from the
//                car's nose (0 = edge right here, 1 = 40 m or more away),
//                the car's current speed (0..1 of top speed), how fast it is
//                sliding sideways (0 when the tyres are gripping), and how far
//                ahead the next speed bump is (0 = here, 1 = 60 m or more)
//   hidden (10): neurons with tanh activation
//   outputs (2): steer (-1 right .. +1 left) and throttle (-1 brake .. +1 full)
//
// The weights come from training by evolution (see train.mjs): many cars with
// random networks drive, the ones that get furthest are kept and slightly
// mutated, generation after generation. The result is saved in ai-weights.json.

export const SENSOR_ANGLES = [-90, -50, -22, 0, 22, 50, 90].map((d) => (d * Math.PI) / 180); // + = left
export const SENSOR_RANGE = 40; // metres
export const BUMP_RANGE = 60;   // metres: how far ahead the AI notices a speed bump
export const LAYERS = [SENSOR_ANGLES.length + 3, 10, 2];

export class NeuralNet {
  // sizes: neurons per layer, e.g. [10, 10, 2]; weights: flat array (random if omitted)
  constructor(sizes = LAYERS, weights = null) {
    this.sizes = sizes;
    this.count = 0;
    for (let l = 1; l < sizes.length; l++) this.count += sizes[l] * (sizes[l - 1] + 1); // +1 = bias
    this.weights = weights ? Float64Array.from(weights) : Float64Array.from({ length: this.count }, () => gauss());
    this.activations = sizes.map((n) => new Float64Array(n)); // last values, for the on-screen diagram
  }

  forward(inputs) {
    let prev = Float64Array.from(inputs);
    this.activations[0] = prev;
    let w = 0;
    for (let l = 1; l < this.sizes.length; l++) {
      const out = new Float64Array(this.sizes[l]);
      for (let j = 0; j < out.length; j++) {
        let sum = this.weights[w++]; // bias
        for (let i = 0; i < prev.length; i++) sum += prev[i] * this.weights[w++];
        out[j] = Math.tanh(sum);
      }
      this.activations[l] = out;
      prev = out;
    }
    return prev;
  }

  clone() { return new NeuralNet(this.sizes, this.weights); }

  // Copy with some weights nudged by random amounts
  mutate(rate = 0.1, amount = 0.3) {
    const child = this.clone();
    for (let i = 0; i < child.count; i++) if (Math.random() < rate) child.weights[i] += gauss() * amount;
    return child;
  }

  // Child taking each weight from one parent or the other
  static crossover(a, b) {
    const child = a.clone();
    for (let i = 0; i < child.count; i++) if (Math.random() < 0.5) child.weights[i] = b.weights[i];
    return child;
  }

  toJSON() { return { layers: this.sizes, weights: Array.from(this.weights, (v) => +v.toFixed(5)) }; }
  static fromJSON(j) { return new NeuralNet(j.layers, j.weights); }
}

// Distances (metres) from the car to the edge of the road along each sensor ray
export function senseRays(track, x, z, heading) {
  const out = [];
  for (const a of SENSOR_ANGLES) {
    const dx = Math.sin(heading + a), dz = Math.cos(heading + a);
    const onRoad = (d) => track.distanceAt(x + dx * d, z + dz * d) <= track.edge;
    let lo = 0, hi = SENSOR_RANGE;
    // march outwards in 2 m steps until we leave the road, then narrow it down
    for (let d = 2; d <= SENSOR_RANGE; d += 2) { if (!onRoad(d)) { hi = d; break; } lo = d; }
    if (hi < SENSOR_RANGE || !onRoad(SENSOR_RANGE)) {
      for (let k = 0; k < 5; k++) { const m = (lo + hi) / 2; if (onRoad(m)) lo = m; else hi = m; }
    }
    out.push(lo);
  }
  return out;
}

// Connects a network to a CarController and keeps track of how far it has got
export class AIDriver {
  constructor(car, net) {
    this.car = car;
    this.net = net;
    this.resetProgress();
  }

  resetProgress() {
    const t = this.car.track;
    this.index = t.nearest({ x: this.car.x, z: this.car.z }).index; // where along the loop we are
    this.progress = 0;        // metres driven along the track (backwards counts negative)
    this.offTrackTime = 0;    // seconds spent off the road in a row
    this.wrongWayTime = 0;    // seconds spent pointing against the direction of the track
    this.stuckTime = 0;       // seconds spent (almost) standing still
    this.rays = SENSOR_ANGLES.map(() => SENSOR_RANGE);
  }

  // One step: sense, think, drive
  update(dt) {
    const car = this.car, t = car.track;
    this.rays = senseRays(t, car.x, car.z, car.heading);
    this.bumpAhead = Math.min(BUMP_RANGE, t.distanceToBump(this.index));
    const inputs = [...this.rays.map((d) => d / SENSOR_RANGE), car.speed / car.maxSpeed, car.slip / 10, this.bumpAhead / BUMP_RANGE];
    const [steer, throttle] = this.net.forward(inputs);
    this.output = { steer, throttle };
    car.update(this.output, dt);

    // progress along the loop
    const n = t.centerline.length;
    const near = t.nearestLocal(car.x, car.z, this.index, 40);
    let di = near.index - this.index;
    if (di > n / 2) di -= n; else if (di < -n / 2) di += n;
    this.progress += di * t.segmentLength;
    this.index = near.index;
    this.offTrackTime = near.dist > t.edge ? this.offTrackTime + dt : 0;
    // The network only sees road edges, so after a hard crash it cannot tell that it
    // is facing the wrong way or blocked by another car. These timers let the game notice.
    const tg = t.tangents[this.index];
    const facing = Math.sin(car.heading) * tg.x + Math.cos(car.heading) * tg.z;
    this.wrongWayTime = facing < 0 ? this.wrongWayTime + dt : 0;
    this.stuckTime = Math.hypot(car.vx, car.vz) < 1 ? this.stuckTime + dt : 0;
    return this.output;
  }

  // Put the car back on the centre line where it is now (or `ahead` metres further
  // along the track), standing still and facing forwards
  respawn(ahead = 0) {
    const t = this.car.track, n = t.centerline.length;
    this.index = (this.index + Math.round(ahead / t.segmentLength)) % n;
    const p = t.centerline[this.index], tg = t.tangents[this.index];
    this.car.place(p.x, p.z, Math.atan2(tg.x, tg.z));
    this.offTrackTime = this.wrongWayTime = this.stuckTime = 0;
  }
}

function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
