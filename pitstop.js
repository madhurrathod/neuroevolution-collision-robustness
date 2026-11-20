// A pit stop: the car stands in its box, a crew jacks it up, takes the four wheels
// off and puts four new ones on, lets it down, and the lollipop man turns his sign
// from STOP to GO. Everything is an animation on the car's 3D model; the driving
// code simply does not move the car while the stop is running.
import * as THREE from 'three';

// When each part of the stop happens (seconds from the start)
export const PIT_TIMES = {
  settle: 0.6,     // the car rolls the last bit onto its mark
  jackUp: 1.0,     // ...and is lifted on the jacks
  unbolt: 1.8,     // the crew undo the wheels and slide them off the hubs
  carry: 2.9,      // ...carry the old wheels out and lay them down
  fetch: 4.2,      // ...bring the new wheels from the tyre stack to the car
  bolt: 5.0,       // ...push them onto the hubs and tighten them
  jackDown: 5.6,   // the car is let down
  go: 6.0,         // the sign turns to GO: the driver has the car back
};
const LIFT = 0.14;  // how high the jacks lift the car (m)

const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const phase = (t, from, to) => ease((t - from) / (to - from));

// A simple crew member: overalls, helmet, two arms
function crewMember(colour) {
  const person = new THREE.Group();
  const suit = new THREE.MeshLambertMaterial({ color: colour });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.62, 4, 10), suit);
  body.position.y = 0.95; body.castShadow = true;
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.45, 4, 10), new THREE.MeshLambertMaterial({ color: 0x22252a }));
  legs.position.y = 0.42; legs.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
  head.position.y = 1.58; head.castShadow = true;
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.172, 14, 10, -0.9, 1.8, 1.1, 0.7), new THREE.MeshLambertMaterial({ color: 0x1d2733 }));
  visor.position.y = 1.58;
  person.add(body, legs, head, visor);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.5, 4, 8), suit);
    arm.position.set(side * 0.3, 1.02, 0.22); arm.rotation.x = -1.1; arm.castShadow = true;   // reaching forwards
    person.add(arm);
  }
  return person;
}

// The lollipop man's round sign on a pole: red STOP or green GO
function lollipopSign() {
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const draw = (go) => {
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = go ? '#2fb24a' : '#d8322b'; g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold ' + (go ? 56 : 36) + 'px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(go ? 'GO' : 'STOP', 64, 68);
    texture.needsUpdate = true;
  };
  draw(false);
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.3, 8), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
  pole.position.y = 0.65;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.3, 24), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, transparent: true }));
  disc.position.y = 1.45;
  group.add(pole, disc);
  return { group, draw };
}

export class PitStop {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.time = 0;
    this.loose = [];            // old wheels lying on the ground after a stop
    this.crew = new THREE.Group();
    this.crew.visible = false;
    this.members = [0xd8322b, 0xd8322b, 0xd8322b, 0xd8322b].map((c) => crewMember(c));
    this.lollipopMan = crewMember(0xf0f0f0);
    this.sign = lollipopSign();
    this.sign.group.position.set(0.35, 0.55, 0.25);
    this.lollipopMan.add(this.sign.group);
    this.crew.add(...this.members, this.lollipopMan);
    scene.add(this.crew);
  }

  // car: the CarController; spot: { x, z, heading } where the car must stand;
  // swap(): called when the old wheels are off; it must give the car its new model
  // (with the new tyres) and return it.
  begin(car, spot, swap) {
    this.clearLoose();
    this.active = true; this.done = false;
    this.time = 0;
    this.car = car; this.swap = swap; this.swapped = false;
    this.from = { x: car.x, z: car.z, heading: car.heading };
    this.spot = spot;
    Object.assign(car, { vx: 0, vz: 0, speed: 0, slip: 0, steer: 0, spin: 0, skidding: false, handbrake: false });
    this.sign.draw(false);
    this.crew.visible = true;
    this.placeCrew();
  }

  // The four wheels of the car's model and where each is on the car (x > 0: the car's left)
  wheels(mesh) { return mesh.userData.wheels.all.map((w) => ({ mesh: w, pivot: w.parent, side: Math.sign(w.parent.position.x) })); }

  placeCrew() {
    const { x, z, heading } = this.spot;
    this.crew.position.set(x, this.car.altitude, z);
    this.crew.rotation.set(0, heading, 0);
    const wheels = this.wheels(this.car.mesh);
    wheels.forEach((w, k) => {
      const m = this.members[k];
      m.position.set(w.pivot.position.x + w.side * 1.45, 0, w.pivot.position.z);
      m.rotation.y = -w.side * Math.PI / 2;                  // facing the wheel
    });
    this.lollipopMan.position.set(0, 0, this.car.halfLength + 2.2);
    this.lollipopMan.rotation.y = Math.PI;                   // facing the car
  }

  // Moves the stop on by dt seconds. Returns true while the car must stay put.
  update(dt) {
    if (!this.active) return false;
    const P = PIT_TIMES, car = this.car;
    this.time += dt;
    const t = this.time;

    // roll onto the mark
    const k = phase(t, 0, P.settle);
    car.x = this.from.x + (this.spot.x - this.from.x) * k;
    car.z = this.from.z + (this.spot.z - this.from.z) * k;
    let turn = this.spot.heading - this.from.heading; turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    car.heading = this.from.heading + turn * k;
    car.apply(0);
    if (t < P.settle) { this.placeCrew(); return true; }

    // crouch down to work on the wheels while the car is up
    const working = phase(t, P.settle, P.jackUp) * (1 - phase(t, P.bolt, P.jackDown));
    this.members.forEach((m) => { m.scale.y = 1 - 0.3 * working; });

    // jacks
    const lift = LIFT * phase(t, P.settle, P.jackUp) * (1 - phase(t, P.bolt, P.jackDown));
    car.mesh.position.y = car.altitude + lift;

    // old wheels: slide off the hubs, then get carried out and laid flat on the ground
    if (t >= P.jackUp && !this.oldWheels) {
      this.oldWheels = this.wheels(car.mesh).map((w) => {
        const start = new THREE.Vector3(), quat = new THREE.Quaternion();
        w.mesh.getWorldPosition(start); w.mesh.getWorldQuaternion(quat);
        this.scene.attach(w.mesh);                            // from now on it is a loose wheel
        const outward = new THREE.Vector3(w.side, 0, 0).applyQuaternion(this.crew.quaternion);
        const backward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.crew.quaternion);
        const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2).premultiply(quat);
        return { mesh: w.mesh, pivot: w.pivot, start, quat, flat, outward, backward };
      });
      this.loose.push(...this.oldWheels.map((w) => w.mesh));
    }
    if (this.oldWheels) {
      const off = phase(t, P.jackUp, P.unbolt), carry = phase(t, P.unbolt, P.carry);
      for (const w of this.oldWheels) {
        // off the hub, then out past the crew member and down behind him
        const p = w.start.clone().addScaledVector(w.outward, 0.45 * off + 1.3 * carry).addScaledVector(w.backward, 1.5 * carry);
        p.y = w.start.y * (1 - carry) + (car.altitude + 0.2) * carry + 0.35 * Math.sin(Math.PI * carry);   // lifted over, then laid on the ground
        w.mesh.position.copy(p);
        w.mesh.quaternion.slerpQuaternions(w.quat, w.flat, carry);
      }
    }

    // new wheels: the car gets its new model (new tyres) with the wheels held away from
    // it, and the crew bring them in and fit them
    if (t >= P.carry && !this.swapped) {
      this.swapped = true;
      this.swap();
      car.mesh.position.y = car.altitude + lift;
      this.newWheels = this.wheels(car.mesh);
    }
    if (this.newWheels) {
      const fetch = phase(t, P.carry, P.fetch), fit = phase(t, P.fetch, P.bolt);
      for (const w of this.newWheels) {
        const out = 0.45 + 1.9 * (1 - fetch);                 // metres away from the hub, sideways
        // carried in from the front (the spare tyres wait by the crew), then pushed onto the hub
        w.mesh.position.set(w.side * out * (1 - fit) / (w.pivot.scale.x || 1), 0.25 * (1 - fetch) * Math.sin(Math.PI * fetch), 1.1 * (1 - fetch));
      }
    }

    // the sign turns to GO; after that the driver has the car back
    if (t >= P.go) {
      this.sign.draw(true);
      for (const w of this.newWheels ?? []) w.mesh.position.set(0, 0, 0);
      car.mesh.position.y = car.altitude;
      this.active = false; this.done = true;
      this.oldWheels = null; this.newWheels = null;
      this.releasedAt = 0;
      return false;
    }
    return true;
  }

  // After the car has gone: the crew stay a moment, the old wheels are cleared up later
  tidy(dt, carFar) {
    if (this.active || !this.crew.visible) return;
    this.releasedAt = (this.releasedAt ?? 0) + dt;
    if (this.releasedAt > 3 || carFar) { this.crew.visible = false; }
    if (this.releasedAt > 12) this.clearLoose();
  }

  clearLoose() {
    for (const m of this.loose) { this.scene.remove(m); m.geometry?.dispose(); }
    this.loose = [];
  }

  // Stop everything at once (the car was reset, or moved to the other track)
  cancel() {
    // wheels already off but the new ones not yet given: put the old ones back on the car
    if (this.active && this.oldWheels && !this.swapped) {
      for (const w of this.oldWheels) { w.pivot.add(w.mesh); w.mesh.position.set(0, 0, 0); w.mesh.quaternion.identity(); }
      this.loose = this.loose.filter((m) => !this.oldWheels.some((w) => w.mesh === m));
    }
    if (this.active) {
      for (const w of this.newWheels ?? []) w.mesh.position.set(0, 0, 0);
      if (this.car?.mesh) this.car.mesh.position.y = this.car.altitude;
    }
    this.active = false; this.oldWheels = null; this.newWheels = null;
    this.crew.visible = false;
    this.clearLoose();
  }
}
