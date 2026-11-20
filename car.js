// The cars: 3D models built from simple shapes, plus the driving physics.
// Controls come in either as keys { forward, backward, left, right } or, for the
// AI, as analog values { throttle: -1..1, steer: -1..1 } (steer > 0 = left).
import * as THREE from 'three';
import { DEFAULT_TYRE, carSetup } from './tyres.js';
import { applyLivery } from './livery.js';

// The kinds of car. Speeds in m/s, accelerations in m/s², sizes in metres.
export const CAR_TYPES = {
  standard: {
    name: 'Standard',
    maxSpeed: 32,        // ~115 km/h
    maxReverse: 8,
    accel: 14,
    brake: 28,
    drag: 2.5,           // rolling drag on road
    grip: 45,            // the most sideways acceleration the tyres can hold before sliding
    steerDemand: 1.2,    // full steering at speed asks for this many times the grip (>1 = can skid)
    maxSteer: 0.55,      // steering angle limit at low speed (radians)
    wheelBase: 2.7,
    clearance: 0.16,     // ground clearance: gap between the car's floor and the road (m)
    halfWidth: 1.15, halfLength: 2.15,             // collision box
    rearWheels: [[-1.0, -1.35], [1.0, -1.35]],     // where skid marks are drawn (x, z in car space)
  },
  f1: {
    name: 'F1',
    maxSpeed: 64,        // ~230 km/h, twice the standard car
    maxReverse: 8,
    accel: 24,
    brake: 48,
    drag: 3,
    grip: 70,            // more grip, but not enough to take the tight bends flat out
    steerDemand: 1.35,
    maxSteer: 0.45,
    wheelBase: 3.4,
    clearance: 0.05,     // very low: speed bumps and grass are its enemies
    halfWidth: 1.05, halfLength: 2.7,
    rearWheels: [[-0.8, -1.8], [0.8, -1.8]],
  },
  neon: {
    name: 'Neon',
    maxSpeed: 98.35,     // 220 mph (354 km/h)
    maxReverse: 8,
    accel: 26,
    brake: 55,
    drag: 3,
    grip: 80,
    steerDemand: 1.35,
    maxSteer: 0.45,
    wheelBase: 2.8,
    clearance: 0.09,     // low, but not as low as the F1 car
    halfWidth: 1.1, halfLength: 2.3,
    rearWheels: [[-0.95, -1.4], [0.95, -1.4]],
  },
};

// The Neon car's light: the colour of the tubes under it and of the glow they throw on the road
export const NEON = { colour: 0x19e6ff, reach: 1.5, strength: 0.85 };   // reach: how far the glow spreads past the car's sides (m)

// Builds a car's 3D model. wheelSize > 1 gives it bigger wheels (off-road tyres)
// and lifts the body to match. livery (from makeLivery in livery.js) paints a race
// number and a pattern on the car, and gives the paint colour when color is not given.
export function buildModel(type, color, { label, wheelSize = 1, livery } = {}) {
  if (color === undefined && livery) color = livery.body;
  const car = type === 'f1' ? buildF1Model(color) : type === 'neon' ? buildNeonModel(color) : buildCarModel(color, { label });
  if (livery) applyLivery(car, type, livery);       // before the lift below, so the decals rise with the body
  if (wheelSize !== 1) {
    const pivots = new Set(car.userData.wheels.all.map((w) => w.parent));
    for (const part of car.children) {
      if (pivots.has(part)) {
        part.scale.setScalar(wheelSize);
        part.position.y *= wheelSize;
        part.position.x *= 1 + (wheelSize - 1) * 0.3;      // big wheels stick out further
      } else {
        part.position.y += (wheelSize - 1) * 0.42;         // the axles are higher, so is the body
      }
    }
  }
  return car;
}

// The standard car: a boxy hatchback
export function buildCarModel(color = 0xe0342c, { label } = {}) {
  const car = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x8fc3ff, metalness: 0.6, roughness: 0.1 });

  // Car points along +z (its "forward")
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.6, 4.2), paint);
  body.position.y = 0.55; body.castShadow = true;
  car.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.0), glass);
  cabin.position.set(0, 1.1, -0.2); cabin.castShadow = true;
  car.add(cabin);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 1.6), paint);
  roof.position.set(0, 1.4, -0.3);
  car.add(roof);

  // Optional text painted on the roof (e.g. "AI"), readable from above
  if (label) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#' + new THREE.Color(color).getHexString(); g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#ffffff';
    g.font = 'bold 150px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, 128, 138);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: tex }));
    sign.rotation.set(-Math.PI / 2, 0, Math.PI);   // lying flat, top of the text towards the front
    sign.position.set(0, 1.445, -0.3);
    car.add(sign);
  }

  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.5), dark);
  spoiler.position.set(0, 1.05, -2.0);
  car.add(spoiler);

  // Headlights (front, +z) and tail lights (back)
  const lampGeo = new THREE.BoxGeometry(0.4, 0.2, 0.1);
  for (const x of [-0.7, 0.7]) {
    const h = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xfff4c4 }));
    h.position.set(x, 0.6, 2.12); car.add(h);
    const t = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    t.position.set(x, 0.6, -2.12); car.add(t);
  }

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 18);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = { front: [], all: [] };
  for (const [x, z, front] of [[-1.0, 1.35, true], [1.0, 1.35, true], [-1.0, -1.35, false], [1.0, -1.35, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.42, z);
    const w = new THREE.Mesh(wheelGeo, dark);
    w.castShadow = true;
    pivot.add(w);
    car.add(pivot);
    wheels.all.push(w);
    if (front) wheels.front.push(pivot);
  }
  car.userData.wheels = wheels;
  return car;
}

// An F1-style car: narrow body, pointed nose, front and rear wings, open wheels.
export function buildF1Model(color = 0xff6a00) {
  const car = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.35 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.6 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.95 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.5 });
  const add = (geo, mat, x, y, z, shadow = true) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; car.add(m); return m;
  };
  const box = (w, h, l) => new THREE.BoxGeometry(w, h, l);

  // Floor and central body (car points along +z)
  add(box(1.3, 0.06, 3.4), carbon, 0, 0.16, -0.4);
  add(box(0.72, 0.42, 2.5), paint, 0, 0.45, -0.2);
  // Nose: a cone lying along the car, narrowing towards the front
  const noseGeo = new THREE.CylinderGeometry(0.09, 0.34, 1.7, 14);
  noseGeo.rotateX(Math.PI / 2);
  add(noseGeo, paint, 0, 0.4, 1.85);
  // Side pods
  for (const x of [-0.58, 0.58]) add(box(0.46, 0.36, 1.7), paint, x, 0.4, -0.65);
  // Engine cover and air intake behind the driver
  add(box(0.42, 0.4, 1.5), paint, 0, 0.82, -1.15);
  add(box(0.3, 0.2, 0.3), carbon, 0, 1.08, -0.5);
  // Cockpit opening and the driver's helmet
  add(box(0.5, 0.1, 0.9), carbon, 0, 0.68, 0.35, false);
  add(new THREE.SphereGeometry(0.2, 14, 10), white, 0, 0.82, 0.2);
  // Front wing with end plates
  add(box(2.0, 0.06, 0.5), white, 0, 0.2, 2.5);
  add(box(1.1, 0.05, 0.22), paint, 0, 0.27, 2.42);
  for (const x of [-0.98, 0.98]) add(box(0.05, 0.26, 0.6), paint, x, 0.28, 2.5);
  // Rear wing: two planes between tall end plates
  add(box(1.5, 0.06, 0.42), white, 0, 1.0, -2.45);
  add(box(1.5, 0.05, 0.3), paint, 0, 0.78, -2.6);
  for (const x of [-0.76, 0.76]) add(box(0.05, 0.62, 0.6), paint, x, 0.75, -2.45);
  add(box(0.12, 0.5, 0.12), carbon, 0, 0.6, -2.35);
  // Tail light
  add(box(0.14, 0.1, 0.06), new THREE.MeshBasicMaterial({ color: 0xff2222 }), 0, 0.4, -2.12, false);

  // Open wheels (rear ones wider) with suspension arms
  const wheels = { front: [], all: [] };
  for (const [x, z, front] of [[-0.88, 1.6, true], [0.88, 1.6, true], [-0.85, -1.8, false], [0.85, -1.8, false]]) {
    const r = front ? 0.44 : 0.47, w = front ? 0.4 : 0.52;
    const geo = new THREE.CylinderGeometry(r, r, w, 20);
    geo.rotateZ(Math.PI / 2);
    const pivot = new THREE.Group();
    pivot.position.set(x, r, z);
    const wheel = new THREE.Mesh(geo, tyre);
    wheel.castShadow = true;
    pivot.add(wheel);
    car.add(pivot);
    wheels.all.push(wheel);
    if (front) wheels.front.push(pivot);
    for (const dz of [-0.25, 0.25]) add(box(Math.abs(x) - 0.2, 0.04, 0.06), carbon, x / 2 + Math.sign(x) * 0.1, 0.45, z + dz, false);
  }
  car.userData.wheels = wheels;
  return car;
}

// The Neon car: a low, wide supercar with glowing tubes under its floor and their
// light on the road beneath it.
let neonGlow = null;     // the picture of the glow on the road (made once, shared)
export function buildNeonModel(color = 0x2a2e48) {
  const car = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.28 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1c2733, metalness: 0.7, roughness: 0.08 });
  const rim = new THREE.MeshStandardMaterial({ color: 0xb9c2cc, metalness: 0.8, roughness: 0.3 });
  const neon = new THREE.MeshBasicMaterial({ color: NEON.colour });
  const add = (geo, mat, x, y, z, shadow = true) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; car.add(m); return m;
  };
  const box = (w, h, l) => new THREE.BoxGeometry(w, h, l);
  // a side view (points as [along the car, height]) pushed out sideways to the given width
  const slab = (points, width) => {
    const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
    return geo.translate(0, 0, -width / 2).rotateY(-Math.PI / 2);      // the drawing's "along" becomes the car's +z (forward)
  };

  // Body: a wedge, low at the nose and rising to the tail (car points along +z)
  add(slab([[-2.25, 0.2], [-2.25, 0.8], [-1.5, 0.84], [0.9, 0.72], [2.05, 0.46], [2.3, 0.3], [2.3, 0.2]], 1.96), paint, 0, 0, 0);
  // Cabin: dark glass, with a painted roof
  add(slab([[-1.35, 0.83], [-0.75, 1.1], [0.05, 1.1], [0.95, 0.71]], 1.5), glass, 0, 0, 0);
  add(slab([[-0.8, 1.1], [-0.75, 1.125], [0.05, 1.125], [0.12, 1.1]], 1.36), paint, 0, 0, 0, false);
  // Wheel arches are only hinted: dark sills along the sides, a splitter at the front, a diffuser at the back
  for (const x of [-1.0, 1.0]) add(box(0.06, 0.16, 2.0), dark, x, 0.28, 0, false);
  add(box(2.04, 0.05, 0.3), dark, 0, 0.2, 2.25, false);
  add(box(1.7, 0.16, 0.2), dark, 0, 0.3, -2.22, false);
  // Rear wing on two short posts
  add(box(1.9, 0.05, 0.42), paint, 0, 1.08, -2.0);
  for (const x of [-0.7, 0.7]) add(box(0.06, 0.26, 0.2), dark, x, 0.94, -2.0, false);
  // Headlights: two thin white strips; tail light: one red bar across the back
  for (const x of [-0.68, 0.68]) add(box(0.46, 0.05, 0.06), new THREE.MeshBasicMaterial({ color: 0xeaf6ff }), x, 0.4, 2.2, false).rotation.x = -0.5;
  add(box(1.7, 0.07, 0.05), new THREE.MeshBasicMaterial({ color: 0xff2233 }), 0, 0.68, -2.26, false);

  // The neon: glowing tubes under the sills and across the nose and tail...
  for (const x of [-0.9, 0.9]) add(box(0.07, 0.05, 3.3), neon, x, 0.155, 0, false);
  for (const z of [-2.05, 2.05]) add(box(1.6, 0.05, 0.07), neon, 0, 0.155, z, false);
  // ...and their light on the road: brightest under the car, fading out past its sides
  if (!neonGlow) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, 128, 256);
    // many soft dots along the outline of the car add up to an even, rounded glow
    g.globalCompositeOperation = 'lighter';
    const w = 1.96 + 2 * NEON.reach, l = 4.55 + 2 * NEON.reach, px = 128 / w, py = 256 / l;
    const dotAt = (x, z) => {
      const cx = 64 + x * px, cy = 128 - z * py, r = NEON.reach * 0.97 * px;      // every dot ends before the picture's edge
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.22)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.08)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad; g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    };
    for (let z = -2.0; z <= 2.0; z += 0.25) { dotAt(-0.9, z); dotAt(0.9, z); }
    for (let x = -0.65; x <= 0.65; x += 0.25) { dotAt(x, -2.05); dotAt(x, 2.05); }
    neonGlow = { texture: new THREE.CanvasTexture(c), width: w, length: l };
    neonGlow.texture.colorSpace = THREE.SRGBColorSpace;
  }
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(neonGlow.width, neonGlow.length),
    new THREE.MeshBasicMaterial({ map: neonGlow.texture, color: new THREE.Color(NEON.colour).multiplyScalar(NEON.strength), blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
  glow.rotation.x = -Math.PI / 2;      // lying on the road (the picture's top is the car's front)
  glow.position.y = 0.04;
  glow.renderOrder = 4;
  car.add(glow);
  car.userData.glow = glow;

  // Wheels: low-profile tyres on bright rims
  const tyreGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.38, 22).rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.4, 10).rotateZ(Math.PI / 2);
  const wheels = { front: [], all: [] };
  for (const [x, z, front] of [[-0.93, 1.4, true], [0.93, 1.4, true], [-0.93, -1.4, false], [0.93, -1.4, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.4, z);
    const wheel = new THREE.Mesh(tyreGeo, dark);
    wheel.castShadow = true;
    wheel.add(new THREE.Mesh(rimGeo, rim));
    pivot.add(wheel);
    car.add(pivot);
    wheels.all.push(wheel);
    if (front) wheels.front.push(pivot);
  }
  car.userData.wheels = wheels;
  return car;
}

const GRAVITY = 9.81;
const SUSPENSION = 0.4;        // share of a bump's upward kick that reaches the car (the springs soak up the rest)
const TAKEOFF_SPEED = 0.5;     // m/s: upward kicks gentler than this never lift the wheels off the road
const BUMP_DAMAGE = 0.7;       // % damage for every m/s over the car's safe speed when it hits a speed bump
const DAMAGE_POWER_LOSS = 0.6; // a wrecked car (100% damage) keeps 40% of its power and top speed
const DAMAGE_GRIP_LOSS = 0.25;
const HANDBRAKE_BRAKING = 0.4; // the locked rear wheels slow the car with this share of its full braking power
const DRIFT_CARRY = 0.6;       // with the throttle down, this share of the energy of a slide is kept as forward speed
const HANDBRAKE_GRIP = 0.3;    // ...and hold only this fraction of the normal sideways grip
const HANDBRAKE_STEER = 1.6;   // ...so the tail swings round: the car turns this much more sharply

// Driving physics. The car has a heading (where it points) and a velocity
// (where it is actually moving). Normally the tyres keep the two lined up. If a
// turn asks for more sideways grip than the tyres have, the car keeps sliding in
// its old direction for a while: a skid. Collisions also act on the velocity.
// The car also has a height: speed bumps throw it into the air for a moment.
export class CarController {
  // lane: sideways offset from the centre line at the start (m, + = right of travel)
  constructor(mesh, track, { lane = 0, type = 'standard', tyre } = {}) {
    this.mesh = mesh;
    this.track = track;
    this.lane = lane;
    this.grassAccel = 0.7;     // engine pulls at 70% on grass
    this.grassSlowdown = 18;   // m/s² slowdown when you hit the grass faster than its top speed
    this.slideGrip = 0.75;     // once sliding, tyres hold only this fraction of their grip
    this.skidScrub = 0.2;      // a skid also scrubs off forward speed (fraction of grip)
    this.damage = 0;           // 0 (perfect) .. 100 (wrecked)
    this.bumpHits = 0;         // how many times a speed bump has damaged the car
    this.setType(type, tyre);
    this.reset();
  }

  // Switch to another kind of car and/or other tyres (optionally with a new 3D model).
  // Sets grip, drag, top speed, off-road behaviour, ground clearance... (see tyres.js)
  setType(type, tyre = DEFAULT_TYRE[type], mesh) {
    this.type = type;
    Object.assign(this, CAR_TYPES[type], carSetup(CAR_TYPES[type], tyre));
    this.groundY = null;      // the axles may now be somewhere else: measure the road afresh
    if (mesh !== undefined) this.mesh = mesh;
  }

  // Put the car somewhere, standing still
  place(x, z, heading) {
    Object.assign(this, { x, z, heading, vx: 0, vz: 0, speed: 0, slip: 0, steer: 0, spin: 0, skidding: false, onTrack: true,
      y: 0, vy: 0, bodyVy: 0, groundY: null, pitch: 0, roll: 0, terrainY: 0, airborne: false, bumpGuard: 0, handbrake: false, wallHit: 0 });
    this.followTerrain(Math.sin(heading), Math.cos(heading));
    this.apply();
  }

  reset() {
    const s = this.track.start, n = this.track.normals[0];
    this.place(s.position.x + n.x * this.lane, s.position.z + n.z * this.lane, s.heading);
  }

  repair() { this.damage = 0; }

  update(input, dt) {
    const onTrack = this.onTrack = this.track.isOnTrack(this);
    let fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    this.updateHeight(fx, fz, dt);
    // On sloping ground gravity pulls the car downhill (down a banked turn, back down a climb).
    // The tyres resist the sideways part like any other sideways push.
    if (this.track.slopeAt && !this.airborne) {
      const g = this.track.slopeAt(this.x, this.z);
      this.vx -= GRAVITY * g.gx * dt; this.vz -= GRAVITY * g.gz * dt;
    }

    // Velocity split into "along the car" (vf) and "sideways" (vl, + = towards the car's left)
    let vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * fz - this.vz * fx;

    // Damage saps engine power, top speed and grip
    const hurt = this.damage / 100;
    const power = 1 - DAMAGE_POWER_LOSS * hurt;
    const handbrake = this.handbrake = !!input.handbrake && !this.airborne;
    let grip = this.grip * (onTrack ? 1 : this.grassGrip) * (1 - DAMAGE_GRIP_LOSS * hurt);

    // Steering: the faster you go, the less the wheels turn, but full steering
    // still asks for a bit more than the tyres can hold (steerDemand).
    const target = input.steer ?? ((input.left ? 1 : 0) - (input.right ? 1 : 0));
    const lock = Math.min(this.maxSteer, (handbrake ? HANDBRAKE_STEER : 1) * Math.atan((this.wheelBase * this.steerDemand * this.grip) / Math.max(vf * vf, 1)));
    // Keys are all-or-nothing, so at speed the wheels follow them more slowly: a
    // short hold gives a gentle turn, a long hold builds up to full steering (and a skid).
    const quickness = input.steer !== undefined ? 8 : 8 - 5 * Math.min(1, Math.abs(vf) / this.maxSpeed);
    this.steer = THREE.MathUtils.lerp(this.steer, target * lock, 1 - Math.exp(-quickness * dt));

    if (!this.airborne) {     // in the air the wheels can do nothing
      // Drag
      const decel = (onTrack ? this.drag : this.grassDrag) * dt;
      if (Math.abs(vf) <= decel) vf = 0; else vf -= Math.sign(vf) * decel;
      // Handbrake: the rear wheels are locked and scrape along the road. That slows the
      // car whichever way it is moving (forwards or sliding sideways) for as long as the
      // handbrake is held, and holds it still once it has stopped.
      if (handbrake) {
        const moving = Math.hypot(vf, vl), loss = HANDBRAKE_BRAKING * this.brake * (onTrack ? 1 : 0.6) * dt;
        const keep = moving > loss ? 1 - loss / moving : 0;
        vf *= keep; vl *= keep;
      }
      // Throttle / brake. The engine cannot push the car past its top speed
      // (lower on grass, lower when damaged); a car already going faster eases down to it.
      const limit = (onTrack ? this.maxSpeed : this.grassMaxSpeed) * power;
      const throttle = input.throttle ?? ((input.forward ? 1 : 0) - (input.backward ? 1 : 0));
      // (a damaged engine always keeps enough push to beat the drag, so the car cannot get stranded)
      const push = Math.max(this.accel * power * (onTrack ? 1 : this.grassAccel), (onTrack ? this.drag : this.grassDrag) + 1.5);
      if (throttle > 0 && !handbrake && vf < limit) vf = Math.min(limit, vf + throttle * push * dt);
      if (throttle < 0) {
        if (vf > 0.5) vf += throttle * this.brake * dt;          // braking
        else if (vf > -this.maxReverse && !handbrake) vf = Math.max(-this.maxReverse, vf + throttle * this.accel * 0.5 * dt);   // reversing
      }
      // Faster than the limit (just left the road, or knocked by a collision): ease back to it
      if (vf > limit) vf = Math.max(limit, vf - this.grassSlowdown * dt);
      if (vf < -this.maxReverse) vf = Math.min(-this.maxReverse, vf + this.grassSlowdown * dt);

      // Turn the car (plus any spin left over from a collision)
      const oldFx = fx, oldFz = fz;
      this.heading += ((vf / this.wheelBase) * Math.tan(this.steer) + this.spin) * dt;
      fx = Math.sin(this.heading); fz = Math.cos(this.heading);

      // The car now points a new way but is still moving the old way: that shows
      // up as sideways velocity, which the tyres cancel as far as their grip allows.
      // With the handbrake on, the locked rear wheels hold far less, so the car drifts.
      const wx = oldFx * vf + oldFz * vl, wz = oldFz * vf - oldFx * vl;   // world velocity
      vf = wx * fx + wz * fz;
      vl = wx * fz - wz * fx;
      if (handbrake) grip *= HANDBRAKE_GRIP;
      const hold = grip * (this.skidding ? this.slideGrip : 1) * dt;
      const slide = vl;
      if (Math.abs(vl) <= hold) vl = 0; else vl -= Math.sign(vl) * hold;
      // Powering out of a slide: with the throttle down (and the handbrake off) the driven
      // wheels turn part of the sideways motion into forward motion instead of wasting it.
      // (never faster than the tyres could push the car: no catapult when it is fully sideways)
      if (this.skidding && throttle > 0 && !handbrake && vf > 0) vf = Math.min(vf + grip * dt, Math.sqrt(vf * vf + DRIFT_CARRY * throttle * (slide * slide - vl * vl)));
      // Sliding sideways is a skid; so are locked rear wheels while the car is still moving
      this.skidding = Math.abs(vl) > (this.skidding ? 0.4 : 1.2) || (handbrake && Math.hypot(vf, vl) > 1.5);
      if (this.skidding) vf -= Math.sign(vf) * Math.min(Math.abs(vf), this.skidScrub * grip * dt);
    } else {
      this.heading += this.spin * dt;
      const wx = fx * vf + fz * vl, wz = fz * vf - fx * vl;
      fx = Math.sin(this.heading); fz = Math.cos(this.heading);
      vf = wx * fx + wz * fz;
      vl = wx * fz - wz * fx;
      this.skidding = false;
    }
    this.spin *= Math.exp(-5 * dt);

    this.speed = vf;      // forward speed (what the speedometer and the AI see)
    this.slip = vl;       // sideways sliding speed
    this.vx = fx * vf + fz * vl;
    this.vz = fz * vf - fx * vl;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    // walls and other solid things belonging to the track (the stadium has them)
    if (this.track.constrain) {
      this.sinceWall = (this.sinceWall ?? 9) + dt;
      const hit = this.track.constrain(this);
      if (hit > 0) {
        fx = Math.sin(this.heading); fz = Math.cos(this.heading);      // the wall may have turned the car
        this.slip = this.vx * fz - this.vz * fx; this.speed = this.vx * fx + this.vz * fz;
        // a real knock, not just rubbing along; the rebound straight afterwards is part of the same knock
        if (hit > 1) { if (this.sinceWall > 0.6) { this.wallHit = hit; this.wallHits = (this.wallHits ?? 0) + 1; } this.sinceWall = 0; }
      }
    }
    this.followTerrain(fx, fz);
    this.apply(dt);
  }

  // Up-and-down motion. The road height under the car is the average of the
  // height under its front and rear axles. On the ground the car follows the
  // road. A bump taken quickly kicks the car upwards; once the road stops
  // rising as fast as the car is moving up (near the top of the bump) the car
  // leaves the ground and flies until it comes down again. The faster the car,
  // the harder the kick and the higher and longer the hop. Hitting a bump faster than the car's safe speed
  // (which depends on its ground clearance) damages it.
  updateHeight(fx, fz, dt) {
    const half = this.wheelBase / 2, t = this.track;
    const heights = (x, z) => [t.bumpHeightAt(x + fx * half, z + fz * half), t.bumpHeightAt(x - fx * half, z - fz * half)];
    let [front, rear] = heights(this.x, this.z);
    const speed = Math.hypot(this.vx, this.vz);
    // Damage is charged once per bump, when the first axle reaches it: after that the
    // car has to travel its own length past the bump before it can be charged again
    // (the second axle arrives a moment later and must not count as a new hit).
    this.bumpGuard = Math.max(0, this.bumpGuard - speed * dt);
    if (front > 0 || rear > 0) {
      if (this.bumpGuard === 0 && !this.airborne) this.hitBump(speed);
      this.bumpGuard = this.wheelBase + 2.5;
    }

    // A fast car covers a good part of a bump in one step, so look at the road in
    // slices of at most 15 cm between where the car was and where it is now.
    const slices = Math.max(1, Math.min(8, Math.ceil((speed * dt) / 0.15))), h = dt / slices;
    for (let k = 1; k <= slices; k++) {
      const back = (1 - k / slices) * dt;
      if (k < slices) [front, rear] = heights(this.x - this.vx * back, this.z - this.vz * back);
      else [front, rear] = heights(this.x, this.z);
      const ground = (front + rear) / 2;
      // how fast the road under the car is rising (unknown just after the car was put somewhere)
      const rise = this.groundY === null ? 0 : (ground - this.groundY) / h;
      this.groundY = ground;
      if (!this.airborne) {
        // the upward kick the body has picked up from the rising road so far
        this.bodyVy = Math.max(SUSPENSION * rise, this.bodyVy - GRAVITY * h, 0);
        if (rise < this.bodyVy - GRAVITY * h && this.bodyVy > TAKEOFF_SPEED) {
          this.airborne = true;                       // the road stopped pushing: take off
          this.vy = this.bodyVy;
        } else {
          this.vy = 0;
        }
        this.y = ground;
        this.pitch = Math.atan2(front - rear, this.wheelBase);
      } else {
        this.vy -= GRAVITY * h;
        this.y += this.vy * h;
        this.pitch *= Math.exp(-6 * h);
        if (this.y <= ground) { this.y = ground; this.vy = 0; this.bodyVy = 0; this.airborne = false; }   // landed
      }
    }
  }

  // On a track whose ground is not flat (the stadium): how high the ground is under
  // the car, and how the car tips forwards/backwards and sideways to sit on it.
  followTerrain(fx, fz) {
    const t = this.track;
    if (!t.heightAt) { this.terrainY = 0; this.roll = 0; this.terrainPitch = 0; return; }
    const half = this.wheelBase / 2, w = this.halfWidth;
    const front = t.heightAt(this.x + fx * half, this.z + fz * half), rear = t.heightAt(this.x - fx * half, this.z - fz * half);
    const left = t.heightAt(this.x + fz * w, this.z - fx * w), right = t.heightAt(this.x - fz * w, this.z + fx * w);
    this.terrainY = (front + rear) / 2;
    this.terrainPitch = Math.atan2(front - rear, this.wheelBase);   // nose up is positive
    this.roll = Math.atan2(left - right, 2 * w);                    // left side up is positive
  }

  hitBump(speed) {
    const excess = speed - this.bumpSafeSpeed;
    if (excess <= 0) return;
    this.damage = Math.min(100, this.damage + BUMP_DAMAGE * excess);
    this.bumpHits++;
  }

  apply(dt = 0) {
    if (!this.mesh) return;   // no 3D model when simulating outside the browser (AI training)
    this.mesh.position.set(this.x, this.altitude, this.z);
    this.mesh.rotation.set(-(this.pitch + (this.terrainPitch ?? 0)), this.heading, this.roll ?? 0, 'YXZ');
    const wheels = this.mesh.userData.wheels;
    for (const p of wheels.front) p.rotation.y = this.steer;
    // wheels turn with the road; the rear pair (listed last) stands still while the handbrake locks it
    wheels.all.forEach((w, i) => { if (!(this.handbrake && i >= 2)) w.rotation.x += (this.speed * dt) / 0.44; });
  }

  get kmh() { return Math.hypot(this.vx, this.vz) * 3.6; }
  // height of the car above the zero level: the ground it is on plus any hop
  get altitude() { return (this.terrainY ?? 0) + this.y; }
}
