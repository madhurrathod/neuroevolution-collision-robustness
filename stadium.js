// The stadium: a big oval for tournaments. The lap is a rounded rectangle (two
// long straights, two short ones, four turns), the turns are banked (the outside
// of the road is higher than the inside), the whole lap rises and falls gently,
// and grandstands with stepped rows run all the way round. There is a pit lane
// inside the front straight and 43 painted places on the starting grid.
//
// Everything is described in "track coordinates":
//   s = distance along the lap, in metres, from the start/finish line
//   d = distance sideways from the middle of the road (+ = towards the outside,
//       which is the right-hand side of a car driving the lap; - = towards the infield)
// buildStadiumData() has no drawing in it, so the driving physics and the AI
// can use it later; buildStadium() draws it.
import * as THREE from 'three';

const DEG = Math.PI / 180;
export const MILE = 1609.344;
export const STADIUM = {
  lapLength: 2 * MILE,  // one lap, measured along the middle of the road: 2 miles (3,218.7 m)
  chute: 160,           // length of the two short straights at the ends (m)
  radius: 205,          // radius of the four turns, measured at the middle of the road (m)
                        // (the two long straights take up whatever is left of the lap: about 805 m each)
  width: 20,            // width of the road (m): room for six cars side by side
  apron: 5,             // flat strip inside the road (m)
  bankStraight: 2 * DEG,   // sideways tilt of the road on the straights
  bankTurn: 10 * DEG,      // ...and in the turns
  bankBlend: 120,       // the tilt changes gradually over about this many metres either side of where a turn begins or ends
                        // (long enough that a fast car is not thrown upwards where the road twists)
  rise: 15,             // the back straight is this much higher than the front straight (m)
  cars: 43,             // places on the starting grid and boxes in the pit lane
  samples: 1500,        // points stored along the middle of the road
  tower: { x: 0, z: 0, radius: 8 },   // the screen tower in the middle of the infield (solid: cars cannot drive through it)
};

const mod = (a, n) => ((a % n) + n) % n;
const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------
// Shape and heights (no drawing)
// ---------------------------------------------------------------------------
export function buildStadiumData(cfg = STADIUM) {
  const B = cfg.chute / 2, R = cfg.radius, W = cfg.width, HALF = W / 2;
  const ARC = (Math.PI / 2) * R;
  const length = cfg.lapLength;
  const straight = (length - 2 * cfg.chute - 4 * ARC) / 2, A = straight / 2;   // the long straights fill the rest of the lap

  // The lap in order, starting at the start/finish line in the middle of the front
  // straight and going anticlockwise seen from above (every turn is a left turn).
  // A position on a turn is centre + R * (sin a, cos a); the car's heading there is a + 90 degrees.
  const pieces = [
    { len: A, from: [0, B + R], dir: [1, 0] },                    // second half of the front straight
    { len: ARC, centre: [A, B], a0: 0 },                          // turn 1
    { len: 2 * B, from: [A + R, B], dir: [0, -1] },               // short straight
    { len: ARC, centre: [A, -B], a0: Math.PI / 2 },               // turn 2
    { len: 2 * A, from: [A, -B - R], dir: [-1, 0] },              // back straight
    { len: ARC, centre: [-A, -B], a0: Math.PI },                  // turn 3
    { len: 2 * B, from: [-A - R, -B], dir: [0, 1] },              // short straight
    { len: ARC, centre: [-A, B], a0: 1.5 * Math.PI },             // turn 4
    { len: A, from: [-A, B + R], dir: [1, 0] },                   // first half of the front straight
  ];
  let at = 0;
  for (const p of pieces) { p.start = at; at += p.len; }

  // Middle of the road at distance s: { x, z, tx, tz (direction of travel), nx, nz (towards the outside), turn }
  function centreAt(s) {
    s = mod(s, length);
    let p = pieces[pieces.length - 1];
    for (const q of pieces) if (s < q.start + q.len) { p = q; break; }
    const u = s - p.start;
    let x, z, tx, tz;
    if (p.centre) {
      const a = p.a0 + u / R;
      x = p.centre[0] + R * Math.sin(a); z = p.centre[1] + R * Math.cos(a);
      tx = Math.cos(a); tz = -Math.sin(a);
    } else {
      x = p.from[0] + p.dir[0] * u; z = p.from[1] + p.dir[1] * u;
      tx = p.dir[0]; tz = p.dir[1];
    }
    return { x, z, tx, tz, nx: -tz, nz: tx, turn: !!p.centre };
  }

  // Height of the middle-of-the-road reference line (the inside edge of the road):
  // lowest at the start line, highest half a lap later.
  const elevationAt = (s) => (cfg.rise / 2) * (1 - Math.cos((2 * Math.PI * s) / length));

  // Banking. Turns are banked, straights almost flat. The change is spread over
  // bankBlend metres either side of each place where a turn begins or ends, along
  // a smooth S-shaped curve, so the road twists gently and never has a kink.
  const N = cfg.samples, ds = length / N, K = cfg.bankBlend;
  const ramp = (u) => (u <= -1 ? 0 : u >= 1 ? 1 : 0.5 + u / 2 + Math.sin(Math.PI * u) / (2 * Math.PI));   // 0 -> 1 as u goes -1 -> 1
  const turns = pieces.filter((p) => p.centre);
  // How much "in a turn" the road is at distance s: 0 on a long straight, 1 deep in a turn
  function turnShare(s) {
    s = mod(s, length);
    let share = 0;
    for (const t of turns) for (const lap of [-length, 0, length]) share += ramp((s - (t.start + lap)) / K) - ramp((s - (t.start + t.len + lap)) / K);
    return share;
  }
  const bankAt = (s) => cfg.bankStraight + (cfg.bankTurn - cfg.bankStraight) * turnShare(s);
  const bank = Float64Array.from({ length: N }, (_, i) => bankAt(i * ds));

  // Where is a point of the ground in track coordinates? Exact for this shape:
  // the middle of the road is everything exactly R away from a rectangle.
  function locate(x, z) {
    const qx = Math.min(A, Math.max(-A, x)), qz = Math.min(B, Math.max(-B, z));
    const inside = qx === x && qz === z;              // deep in the infield, inside that rectangle
    let d, s;
    if (inside) {
      // nearest straight decides; d is very negative here
      const gaps = [B - z, A - x, z + B, x + A];      // to the front, right, back, left sides of the rectangle
      const k = gaps.indexOf(Math.min(...gaps));
      d = -(R + gaps[k]);
      s = k === 0 ? x : k === 1 ? A + ARC + (B - z) : k === 2 ? A + 2 * ARC + 2 * B + (A - x) : 3 * A + 3 * ARC + 2 * B + (z + B);
    } else {
      d = Math.hypot(x - qx, z - qz) - R;
      const right = x > A, left = x < -A, front = z > B, back = z < -B;
      const angle = (cx, cz) => mod(Math.atan2(x - cx, z - cz), 2 * Math.PI);
      if (right && front) s = A + R * angle(A, B);                                             // turn 1
      else if (right && back) s = A + ARC + 2 * B + R * (angle(A, -B) - Math.PI / 2);          // turn 2
      else if (left && back) s = 3 * A + 2 * ARC + 2 * B + R * (angle(-A, -B) - Math.PI);      // turn 3
      else if (left && front) s = 3 * A + 3 * ARC + 4 * B + R * (angle(-A, B) - 1.5 * Math.PI); // turn 4
      else if (front) s = x;                                                                    // front straight
      else if (right) s = A + ARC + (B - z);                                                    // right-hand short straight
      else if (back) s = A + 2 * ARC + 2 * B + (A - x);                                         // back straight
      else s = 3 * A + 3 * ARC + 2 * B + (z + B);                                               // left-hand short straight
    }
    return { s: mod(s, length), d };
  }

  // Sideways layout of the ground, from the infield outwards (all in metres of d)
  const zones = {
    infieldFlat: -115,                // further in than this the infield is level ground at height 0
    vergeTop: -60,                    // between here and infieldFlat the ground slopes down to the infield (the pit lane is on the level part)
    apronInner: -HALF - cfg.apron,    // inside edge of the apron
    roadInner: -HALF,
    roadOuter: HALF,
    wallOuter: HALF + WALL,           // the outer wall stands on the road's outside edge
    standFront: HALF + STAND_GAP,     // a service road, then the grandstand begins
  };

  // Height of the outside edge of the road (the stands are built up from this)
  const outerHeightAt = (s) => elevationAt(s) + W * Math.tan(bankAt(s));

  // Height of the ground at track coordinates (s, d): the banked road, the level
  // apron and infield strip beside it, the slope down to the infield, and the
  // service road outside the wall. (Walls, stands and buildings are not "ground".)
  function heightAtSD(s, d) {
    const e = elevationAt(s);
    if (d >= zones.roadOuter) return e + W * Math.tan(bankAt(s));
    if (d >= zones.roadInner) return e + (d + HALF) * Math.tan(bankAt(s));
    if (d >= zones.vergeTop) return e;
    if (d >= zones.infieldFlat) return e * ((d - zones.infieldFlat) / (zones.vergeTop - zones.infieldFlat));
    return 0;
  }
  const heightAt = (x, z) => { const p = locate(x, z); return heightAtSD(p.s, p.d); };

  // Roughly how high the top of whatever is built at (x, z) is: the ground, or the
  // grandstand over it. Used to keep the free-look camera out of the stands.
  const standRise = 2.6 + (STAND.lowerRows + STAND.upperRows) * STAND.riser + 1.2 + 1.1, standDepth = (STAND.lowerRows + STAND.upperRows) * STAND.tread + 2.5 + 1.6;
  function topAt(x, z) {
    const p = locate(x, z);
    if (p.d < zones.wallOuter) return heightAtSD(p.s, p.d) + (p.d > zones.roadOuter ? 1 : 0);
    const into = p.d - zones.standFront;
    if (into > standDepth + 1) return 0;
    return outerHeightAt(p.s) + (into < 0 ? 1 : Math.min(standRise, 2.6 + (into / standDepth) * (standRise - 2.6) + 1));
  }

  // A point of the ground in the world, from track coordinates
  function pointAt(s, d, lift = 0) {
    const c = centreAt(s);
    return new THREE.Vector3(c.x + c.nx * d, heightAtSD(s, d) + lift, c.z + c.nz * d);
  }

  // Which way is "up" for a car standing at (x, z): the slope of the ground there
  function normalAt(x, z) {
    const h = 0.25;
    const gx = (heightAt(x + h, z) - heightAt(x - h, z)) / (2 * h), gz = (heightAt(x, z + h) - heightAt(x, z - h)) / (2 * h);
    return new THREE.Vector3(-gx, 1, -gz).normalize();
  }

  // Stored points along the middle of the road, in the same form as the first track
  const centerline = [], tangents = [], normals = [];
  for (let i = 0; i < N; i++) {
    const c = centreAt(i * ds);
    centerline.push(new THREE.Vector3(c.x, heightAtSD(i * ds, 0), c.z));
    tangents.push(new THREE.Vector3(c.tx, 0, c.tz));
    normals.push(new THREE.Vector3(c.nx, 0, c.nz));
  }

  // Starting grid: two columns, the right-hand column half a row behind, filling
  // the front straight backwards from the start line. Place 1 is pole position.
  const ROW = 7, grid = [];
  for (let k = 0; k < cfg.cars; k++) {
    const s = -8 - ROW * Math.floor(k / 2) - (k % 2 ? ROW / 2 : 0), d = k % 2 ? 4.5 : -4.5;
    const c = centreAt(s), p = pointAt(s, d);
    grid.push({ place: k + 1, s: mod(s, length), d, x: p.x, y: p.y, z: p.z, heading: Math.atan2(c.tx, c.tz) });
  }

  // Pit lane: inside the front straight. The pit road runs parallel to the track;
  // the 43 boxes where cars stop are on its infield side.
  const BOX = 12;                                       // length of one pit box along the pit road (m): room for the car and its crew
  const boxesLength = cfg.cars * BOX;                   // 516 m for 43 boxes
  const pit = {
    roadOuter: -20, roadInner: -32,                     // the pit road, in d (12 m wide: a lane to drive along and room to pull in)
    boxOuter: -32, boxInner: -40,                       // the strip of pit boxes (8 m deep)
    wall: -19,                                          // low wall between the track side and the pit road
    boxesFrom: -boxesLength / 2, boxesTo: boxesLength / 2,   // s range of the boxes (the start line is at s = 0)
    roadFrom: -300, roadTo: 300,                        // where the pit road runs at full width
    entryFrom: -450, exitTo: 450,                       // where it leaves and rejoins the apron: from the end of the last turn to the start of the first
    wallFrom: -285, wallTo: 285,                        // s range of the pit wall
    building: { from: -boxesLength / 2, to: boxesLength / 2, outer: -42, inner: -52 },   // the garages behind the boxes
    boxLength: BOX,
    boxes: [],
  };
  for (let k = 0; k < cfg.cars; k++) {
    const s = pit.boxesFrom + BOX * (k + 0.5), d = (pit.boxOuter + pit.boxInner) / 2;
    const c = centreAt(s), p = pointAt(s, d);
    pit.boxes.push({ box: k + 1, s: mod(s, length), d, x: p.x, y: p.y, z: p.z, heading: Math.atan2(c.tx, c.tz) });
  }
  // The two sides of the pit road at distance s (it narrows and swings out to meet the apron at each end)
  pit.roadAt = (s) => {
    const signed = s > length / 2 ? s - length : s;     // -L/2 .. L/2 around the start line
    const t = signed < pit.roadFrom ? smooth((signed - pit.entryFrom) / (pit.roadFrom - pit.entryFrom))
      : signed > pit.roadTo ? smooth((pit.exitTo - signed) / (pit.exitTo - pit.roadTo)) : 1;
    if (signed <= pit.entryFrom || signed >= pit.exitTo) return null;
    return { outer: zones.roadInner - 0.5 + (pit.roadOuter - (zones.roadInner - 0.5)) * t, inner: zones.apronInner + (pit.roadInner - zones.apronInner) * t };
  };

  // Tarmac or grass? Tarmac is the road, the apron, the pit road and the pit boxes.
  function isPaved(x, z) {
    const p = locate(x, z);
    if (p.d <= zones.roadOuter && p.d >= zones.apronInner) return true;
    const r = pit.roadAt(p.s);
    if (r && p.d <= r.outer && p.d >= r.inner) return true;
    const signed = p.s > length / 2 ? p.s - length : p.s;
    return signed >= pit.boxesFrom && signed <= pit.boxesTo && p.d <= pit.boxOuter && p.d >= pit.boxInner;
  }

  // How steeply the ground rises at (x, z), towards +x and towards +z (1 = 45 degrees)
  function slopeAt(x, z) {
    const h = 0.5;
    return { gx: (heightAt(x + h, z) - heightAt(x - h, z)) / (2 * h), gz: (heightAt(x, z + h) - heightAt(x, z - h)) / (2 * h) };
  }

  // Solid things. Keeps a car (anything with x, z, vx, vz and halfWidth) out of the
  // outer wall, the pit wall, the pit building and the screen tower: the car is moved
  // back out, bounces a little and loses some speed along the wall. Returns how hard
  // it hit (m/s into the obstacle), 0 if it touched nothing.
  const WALL_BOUNCE = 0.25, WALL_SCRUB = 0.04;
  const WALL_DRAG = 0.006;   // share of its speed a car loses in each 1/120 s step that it rubs along the outer wall:
                             // leaning on the wall through a turn is much slower than driving round it
  const blocks = [
    { s0: pit.wallFrom, s1: pit.wallTo, d0: pit.wall - 0.4, d1: pit.wall },
    { s0: pit.building.from, s1: pit.building.to, d0: pit.building.inner, d1: pit.building.outer },
  ];
  function bounce(car, nx, nz) {            // (nx, nz): unit direction pointing out of the obstacle
    const into = -(car.vx * nx + car.vz * nz);
    if (into <= 0) return 0;
    car.vx += (1 + WALL_BOUNCE) * into * nx; car.vz += (1 + WALL_BOUNCE) * into * nz;
    const keep = Math.max(0.5, 1 - WALL_SCRUB * into);     // scraping along the wall costs speed
    car.vx *= keep; car.vz *= keep;
    return into;
  }
  // A car pressed against a long wall is turned to run along it (it scrapes along the
  // wall instead of stopping dead with its nose against it).
  function alignTo(car, tx, tz, into) {
    if (car.heading === undefined || into <= 0.05 || (car.speed ?? 0) < 0) return;
    const way = car.vx * tx + car.vz * tz >= 0 ? 1 : -1;
    let error = Math.atan2(tx * way, tz * way) - car.heading;
    error = Math.atan2(Math.sin(error), Math.cos(error));
    car.heading += Math.max(-0.03, Math.min(0.03, error));
  }
  function constrain(car) {
    const hw = car.halfWidth ?? 1.15, hl = car.halfLength ?? 2.15;
    const fx = Math.sin(car.heading ?? 0), fz = Math.cos(car.heading ?? 0);
    // How far the car's body reaches in the direction (nx, nz): half its width when it is
    // side-on to a wall, half its length when it is nose-on. (So the nose never pokes through.)
    const reach = (nx, nz) => Math.abs(fx * nx + fz * nz) * hl + Math.abs(fz * nx - fx * nz) * hw;
    let hit = 0, p = locate(car.x, car.z);
    // the outer wall, all the way round
    {
      const c = centreAt(p.s), limit = zones.roadOuter - reach(c.nx, c.nz);
      // pressing against the wall while moving along it rubs speed off
      if (p.d > limit - 0.02 && car.vx * c.nx + car.vz * c.nz > 0.005) { car.vx *= 1 - WALL_DRAG; car.vz *= 1 - WALL_DRAG; }
      if (p.d > limit) {
        car.x -= c.nx * (p.d - limit); car.z -= c.nz * (p.d - limit);
        const into = bounce(car, -c.nx, -c.nz);
        alignTo(car, c.tx, c.tz, into);
        hit = Math.max(hit, into);
        p = { s: p.s, d: limit };
      }
    }
    // the pit wall and pit building (both on the front straight)
    const signed = p.s > length / 2 ? p.s - length : p.s;
    for (const b of blocks) {
      const c = centreAt(p.s), along = reach(c.tx, c.tz), across = reach(c.nx, c.nz);
      const gaps = [signed - (b.s0 - along), (b.s1 + along) - signed, p.d - (b.d0 - across), (b.d1 + across) - p.d];   // how far inside each of the four sides
      if (Math.min(...gaps) <= 0) continue;
      const k = gaps.indexOf(Math.min(...gaps));
      const [nx, nz] = k === 0 ? [-c.tx, -c.tz] : k === 1 ? [c.tx, c.tz] : k === 2 ? [-c.nx, -c.nz] : [c.nx, c.nz];
      car.x += nx * gaps[k]; car.z += nz * gaps[k];
      const into = bounce(car, nx, nz);
      if (k >= 2) alignTo(car, c.tx, c.tz, into);      // the long sides
      hit = Math.max(hit, into);
      p = locate(car.x, car.z);
    }
    // the screen tower
    const dx = car.x - cfg.tower.x, dz = car.z - cfg.tower.z, dist = Math.hypot(dx, dz);
    if (dist > 1e-6) {
      const clear = cfg.tower.radius + reach(dx / dist, dz / dist);
      if (dist < clear) {
        car.x += (dx / dist) * (clear - dist); car.z += (dz / dist) * (clear - dist);
        hit = Math.max(hit, bounce(car, dx / dist, dz / dist));
      }
    }
    return hit;
  }

  const start = centreAt(0);
  return {
    name: 'Stadium',
    config: cfg,
    length,
    width: W,
    edge: HALF,                       // cars are "on the track" within this distance of the middle of the road
    segmentLength: ds,
    centerline, tangents, normals, bank,
    zones, pit, grid,
    centreAt, elevationAt, bankAt, outerHeightAt, locate, heightAtSD, heightAt, topAt, pointAt, normalAt, slopeAt, constrain, isPaved,
    straight,
    // the same questions the first track answers, so the cars can be pointed at this one later
    start: { position: new THREE.Vector3(start.x, heightAtSD(0, 0), start.z), heading: Math.atan2(start.tx, start.tz) },
    distanceAt: (x, z) => Math.abs(locate(x, z).d),
    isOnTrack: (p) => isPaved(p.x, p.z),          // what the driving physics asks: tarmac (full grip) or grass?
    isOnRoad: (p) => Math.abs(locate(p.x, p.z).d) <= HALF,   // on the racing surface itself (not apron or pits)
    nearest: (p) => { const q = locate(p.x, p.z), index = Math.round(q.s / ds) % N; return { index, dist: Math.abs(q.d), point: centerline[index], tangent: tangents[index] }; },
    nearestLocal: (x, z) => { const q = locate(x, z); return { index: Math.round(q.s / ds) % N, dist: Math.abs(q.d) }; },
    bumps: [], bumpHeightAt: () => 0, distanceToBump: () => Infinity,
  };
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
const COLOURS = {
  grass: 0x3f8a3a, verge: 0x3f8a3a, apron: 0x56565b, pitRoad: 0x3d3d41, service: 0x4a4a4e,
  wall: 0xf0f0ec, concrete: 0xb9b9b4, concreteDark: 0x8f8f8a, walkway: 0xa5a5a0,
  seatsLow: [0x2f6db5, 0x2a5f9e], seatsHigh: [0xc8452f, 0xb03c28], aisle: 0xd0d0cb, back: 0x6f7378,
};

// The grandstands: rows of steps like a wide staircase, in two levels with a walkway between.
export const STAND = { lowerRows: 12, upperRows: 14, tread: 1.2, riser: 0.7 };   // each row is 1.2 m deep and 0.7 m above the one in front

const WALL = 0.4, STAND_GAP = 7;   // thickness of the outer wall; distance from the road's edge to the front of the stands (m)

// Grandstand cross-section, built outwards from the outside edge of the road.
// Returns the corner points [d, height above the road's outside edge] and what each face is.
function standProfile(halfWidth) {
  const pts = [], kinds = [];
  let d = halfWidth, y = 0;
  const to = (nd, ny, kind) => { if (!pts.length) pts.push([d, y]); d = nd; y = ny; pts.push([d, y]); kinds.push(kind); };
  to(d, 1.0, 'wall'); to(d + WALL, 1.0, 'wall'); to(d, 0, 'wall');      // outer wall of the track, 1 m high
  to(halfWidth + STAND_GAP, 0, 'service');                                       // service road behind the wall
  to(d, 2.6, 'concrete');                                                // front of the stand
  for (let r = 0; r < STAND.lowerRows; r++) { to(d + STAND.tread, y, 'seatsLow'); to(d, y + STAND.riser, 'riser'); }     // lower level
  to(d + 2.5, y, 'walkway'); to(d, y + 1.2, 'concrete');                 // walkway between the levels
  for (let r = 0; r < STAND.upperRows; r++) { to(d + STAND.tread, y, 'seatsHigh'); to(d, y + STAND.riser, 'riser'); }    // upper level
  to(d + 1.2, y, 'walkway'); to(d, y + 1.1, 'concrete'); to(d + 0.4, y, 'concrete');          // top walkway and rim
  to(d, null, 'back');                                                   // back wall, down to the ground (height filled in later)
  return { pts, kinds };
}

// A surface swept along the lap. profileAt(s) gives the cross-section there as
// [d, height] points (or null for "nothing here"); every face gets one flat
// colour from colourOf(face number, ring number).
function sweep(data, from, to, profileAt, colourOf, { shadow = true } = {}) {
  const rings = Math.max(1, Math.round((to - from) / data.segmentLength));
  const pos = [], col = [], c = new THREE.Color();
  let prev = null;
  for (let i = 0; i <= rings; i++) {
    const s = from + ((to - from) * i) / rings, centre = data.centreAt(s), profile = profileAt(s);
    const ring = profile && profile.map(([d, y]) => [centre.x + centre.nx * d, y, centre.z + centre.nz * d]);
    if (ring && prev) {
      for (let k = 0; k < ring.length - 1; k++) {
        const a = prev[k], b = prev[k + 1], e = ring[k], f = ring[k + 1];
        pos.push(...a, ...b, ...e, ...b, ...f, ...e);
        c.set(colourOf(k, i - 1));
        for (let v = 0; v < 6; v++) col.push(c.r, c.g, c.b);
      }
    }
    prev = ring;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.receiveShadow = true; mesh.castShadow = shadow;
  return mesh;
}

// A painted patch lying on the ground between s0..s1 and d0..d1, with a picture on it.
// The picture's left-right runs along `across` ('d' or 's') and its top is at the far end of the other direction.
function decal(data, s0, s1, d0, d1, material, lift = 0.04) {
  const n = Math.max(1, Math.ceil(Math.abs(s1 - s0) / 2));
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    for (const [d, u] of [[d0, 0], [d1, 1]]) {
      const p = data.pointAt(s, d, lift);
      pos.push(p.x, p.y, p.z);
      uv.push(u, i / n);
    }
    if (i < n) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}

function paint(width, height, draw, anisotropy) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
// Paint that sits just above the surface it is on, without flickering against it
const painted = (map, extra = {}) => new THREE.MeshLambertMaterial({ map, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, ...extra });

// screen: the picture shown on the tower's four big screens (a texture; grey if left out)
export function buildStadium({ anisotropy = 8, screen = null } = {}) {
  const data = buildStadiumData();
  const { length, width: W, zones, pit } = data, HALF = W / 2, L = length;
  const group = new THREE.Group();

  // Level ground everywhere (the infield, and the land outside the stands)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshLambertMaterial({ color: COLOURS.grass }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.06; ground.receiveShadow = true;
  group.add(ground);

  // The road: one banked strip with its edge lines painted in the texture
  {
    const tex = paint(512, 256, (g, w, h) => {
      g.fillStyle = '#303033'; g.fillRect(0, 0, w, h);
      let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 5000; i++) { const v = 40 + Math.floor(rnd() * 20); g.fillStyle = `rgb(${v},${v},${v + 2})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
      g.fillStyle = '#e9c400'; g.fillRect(8, 0, 7, h);            // yellow line along the inside
      g.fillStyle = '#ececec'; g.fillRect(w - 15, 0, 7, h);       // white line along the outside
    }, anisotropy);
    tex.wrapT = THREE.RepeatWrapping;
    const N = data.centerline.length, pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const s = (i % N) * data.segmentLength;
      for (const [d, u] of [[-HALF, 0], [HALF, 1]]) { const p = data.pointAt(s, d); pos.push(p.x, p.y, p.z); uv.push(u, (i * data.segmentLength) / 8); }
      if (i < N) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const road = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    road.receiveShadow = true;
    group.add(road);
  }

  // Inside the road: apron, a level strip of grass, and the slope down to the infield
  {
    const kinds = ['apron', 'grass', 'verge'];
    group.add(sweep(data, 0, L, (s) => {
      const e = data.elevationAt(s);
      return [[zones.roadInner, e], [zones.apronInner, e], [zones.vergeTop, e], [zones.infieldFlat, 0]];
    }, (k) => COLOURS[kinds[k]], { shadow: false }));
  }

  // Outside the road: wall, service road and the grandstands, all the way round.
  // Seats are coloured in blocks, with a pale stairway between blocks.
  {
    const shape = standProfile(HALF);
    const BLOCK = 18;   // rings per block of seats (about 20 m)
    group.add(sweep(data, 0, L, (s) => {
      const ho = data.outerHeightAt(s);
      return shape.pts.map(([d, y]) => [d, y === null ? -0.06 : ho + y]);
    }, (k, ring) => {
      const kind = shape.kinds[k], block = Math.floor(ring / BLOCK);
      if (kind === 'seatsLow' || kind === 'seatsHigh') return ring % BLOCK === 0 ? COLOURS.aisle : COLOURS[kind][block % 2];
      if (kind === 'riser') return ring % BLOCK === 0 ? COLOURS.concrete : COLOURS.concreteDark;
      return COLOURS[kind];
    }));
  }

  // Start / finish line and the 43 numbered places of the starting grid
  {
    const checker = paint(320, 48, (g, w, h) => {
      for (let x = 0; x < w / 16; x++) for (let y = 0; y < h / 16; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f2f2f2'; g.fillRect(x * 16, y * 16, 16, 16); }
    }, anisotropy);
    group.add(decal(data, -1.2, 1.2, -HALF + 0.6, HALF - 0.6, painted(checker)));
    for (const slot of data.grid) {
      const tex = paint(96, 192, (g, w, h) => {
        g.clearRect(0, 0, w, h);
        g.strokeStyle = '#f4f4f4'; g.lineWidth = 8;
        g.beginPath(); g.moveTo(6, 70); g.lineTo(6, 6); g.lineTo(w - 6, 6); g.lineTo(w - 6, 70); g.stroke();   // an open box: the front and the two front corners
        g.fillStyle = '#f4f4f4'; g.font = 'bold 64px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(slot.place), w / 2, 122);
      }, anisotropy);
      const signedS = slot.s > L / 2 ? slot.s - L : slot.s;
      group.add(decal(data, signedS - 3.2, signedS + 2.4, slot.d - 1.4, slot.d + 1.4, painted(tex, { transparent: true })));
    }
  }

  // Pit lane: the pit road (leaving the apron in turn 4, rejoining it in turn 1),
  // a low wall on the track side, the strip of 43 numbered boxes, and a pit building
  {
    group.add(sweep(data, pit.entryFrom, pit.exitTo, (s) => {
      const r = pit.roadAt(mod(s, L)), e = data.elevationAt(s) + 0.05;
      return r && [[r.outer, e], [r.inner, e]];
    }, () => COLOURS.pitRoad, { shadow: false }));
    group.add(sweep(data, pit.wallFrom, pit.wallTo, (s) => {
      const e = data.elevationAt(s);
      return [[pit.wall, e], [pit.wall, e + 0.9], [pit.wall - 0.4, e + 0.9], [pit.wall - 0.4, e]];
    }, () => COLOURS.wall));
    // The boxes: each one outlined, numbered, with a yellow line where the car stops.
    // Drawn as one long picture laid along the lane, read from the pit road.
    const PX = 128;   // picture width per box
    const boxes = paint(data.config.cars * PX, 96, (g, w, h) => {
      g.fillStyle = '#4b4b50'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < data.config.cars; k++) {
        const x0 = k * PX;
        g.strokeStyle = '#f4f4f4'; g.lineWidth = 3; g.strokeRect(x0 + 2, 2, PX - 4, h - 4);
        g.fillStyle = '#ffd23f'; g.fillRect(x0 + PX * 0.72, 10, 5, h - 20);                  // stop line in front of the car's nose
        g.fillStyle = '#f4f4f4'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(k + 1), x0 + PX * 0.36, h * 0.78);
      }
    }, anisotropy);
    const strip = decal(data, pit.boxesFrom, pit.boxesTo, pit.boxOuter, pit.boxInner, painted(boxes), 0.05);
    const uv = strip.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i));   // picture runs along the lane
    group.add(strip);

    // Four spare tyres stacked at the back of every box
    const tyreGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 18);
    const stacks = new THREE.InstancedMesh(tyreGeo, new THREE.MeshLambertMaterial({ color: 0x1a1a1c }), data.config.cars * 4);
    stacks.castShadow = true;
    const m = new THREE.Matrix4();
    data.pit.boxes.forEach((box, k) => {
      const signed = box.s > L / 2 ? box.s - L : box.s, spot = data.pointAt(signed - pit.boxLength * 0.3, pit.boxInner + 0.9);
      for (let j = 0; j < 4; j++) stacks.setMatrixAt(k * 4 + j, m.makeTranslation(spot.x, spot.y + 0.14 + j * 0.29, spot.z));
    });
    group.add(stacks);

    // The garages: one long building with a numbered door for every box
    const mid = data.centreAt(0), dMid = (pit.building.outer + pit.building.inner) / 2, lengthAlong = pit.building.to - pit.building.from, depth = pit.building.outer - pit.building.inner;
    const doors = paint(data.config.cars * 128, 96, (g, w, h) => {
      g.fillStyle = '#d6d6d1'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < data.config.cars; k++) {
        const x0 = k * 128;
        g.fillStyle = '#5d6670'; g.fillRect(x0 + 14, 22, 100, h - 22);                       // roller door
        g.fillStyle = '#6d7680'; for (let y = 28; y < h; y += 9) g.fillRect(x0 + 14, y, 100, 3);
        g.fillStyle = '#1f2226'; g.fillRect(x0 + 44, 2, 40, 18);
        g.fillStyle = '#ffd23f'; g.font = 'bold 16px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(k + 1), x0 + 64, 12);
      }
    }, anisotropy);
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xcfcfca });
    // (its walls go a little way into the ground, because the ground is not quite level along its length)
    const building = new THREE.Mesh(new THREE.BoxGeometry(lengthAlong, 6.2, depth),
      [wallMat, wallMat, wallMat, wallMat, new THREE.MeshLambertMaterial({ map: doors }), wallMat]);   // the side facing the pit road has the doors
    building.position.set(mid.x + mid.nx * dMid, 2.2, mid.z + mid.nz * dMid);
    building.rotation.y = Math.atan2(mid.tx, mid.tz) - Math.PI / 2;
    building.castShadow = building.receiveShadow = true;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(lengthAlong + 2, 0.3, depth + 3), new THREE.MeshLambertMaterial({ color: 0x44474d }));
    roof.position.set(building.position.x + mid.nx * 1.5, 5.35, building.position.z + mid.nz * 1.5);
    roof.rotation.y = building.rotation.y; roof.castShadow = true;
    group.add(building, roof);
  }

  // Gantry over the start line
  const startLamps = [];
  {
    const steel = new THREE.MeshLambertMaterial({ color: 0x2b2e33 });
    // one post on the grass between the apron and the pit wall, the other behind the outer wall
    const inner = data.pointAt(0, zones.apronInner - 1.5), outer = data.pointAt(0, HALF + 2), top = Math.max(inner.y, outer.y) + 8.5;
    for (const p of [inner, outer]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, top - p.y, 0.5), steel);
      post.position.set(p.x, (top + p.y) / 2, p.z); post.castShadow = true; group.add(post);
    }
    const span = inner.distanceTo(outer);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.4, span + 0.5), steel);
    beam.position.set((inner.x + outer.x) / 2, top - 0.7, (inner.z + outer.z) / 2);
    beam.rotation.y = Math.atan2(outer.x - inner.x, outer.z - inner.z); beam.castShadow = true;
    group.add(beam);
    const sign = paint(1024, 64, (g, w, h) => {
      g.fillStyle = '#15171a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#f4f4f4'; g.font = 'bold 44px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('S T A R T   /   F I N I S H', w / 2, h / 2 + 2);
    }, anisotropy);
    const over = data.pointAt(0, 0);                                   // the sign hangs over the middle of the road
    const board = new THREE.Mesh(new THREE.PlaneGeometry(W - 1, 1.2), new THREE.MeshBasicMaterial({ map: sign, side: THREE.DoubleSide }));
    board.position.set(over.x - 0.32, beam.position.y, over.z);        // on the side the cars arrive from
    board.rotation.y = -Math.PI / 2;
    group.add(board);
    // Three start lights hanging under the beam, over the middle of the road, facing the grid
    const housing = new THREE.MeshLambertMaterial({ color: 0x15171a });
    for (const across of [-1.3, 0, 1.3]) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.1, 1.1), housing);
      box.position.set(over.x - 0.1, beam.position.y - 1.25, over.z + across); box.castShadow = true;
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.4, 28), new THREE.MeshBasicMaterial({ color: START_LIGHT.off }));
      lens.position.set(over.x - 0.31, beam.position.y - 1.25, over.z + across); lens.rotation.y = -Math.PI / 2;
      group.add(box, lens);
      startLamps.push(lens);
    }
  }

  // Track lights: slim poles that stand just behind the outer wall, rise, and bend
  // over the track in one smooth curve, with a lamp at the tip shining down.
  const lights = buildLights(data);
  group.add(lights.group);

  // The tower in the middle of the infield, built like a scoring pylon. From the top
  // down: four big screens (one facing each way), a block with the lap number, then
  // five blocks, one for each of the first five places, showing that car's number.
  const TOWER = { column: 9, height: 140, screenWidth: 96, screenHeight: 54, screenBottom: 84,
    lapWidth: 26, lapHeight: 14, placeWidth: 20, placeHeight: 10, gap: 2, places: 5 };
  const panels = [];      // the lap block's picture first, then one per place
  {
    const t = data.config.tower, steel = new THREE.MeshLambertMaterial({ color: 0x2b2e33 });
    const tower = new THREE.Group();
    tower.position.set(t.x, 0, t.z);
    const column = new THREE.Mesh(new THREE.BoxGeometry(TOWER.column, TOWER.height, TOWER.column), steel);
    column.position.y = TOWER.height / 2; column.castShadow = true;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(t.radius, t.radius + 1, 3, 24), new THREE.MeshLambertMaterial({ color: 0xb9b9b4 }));
    base.position.y = 1.5; base.castShadow = base.receiveShadow = true;
    tower.add(column, base);

    // A box round the column with the same picture on its four sides
    const block = (width, height, bottom, material, depth = width) => {
      const box = new THREE.Mesh(new THREE.BoxGeometry(depth - 0.6, height, depth - 0.6), steel);
      box.position.y = bottom + height / 2; box.castShadow = true;
      tower.add(box);
      const faces = [];
      for (let k = 0; k < 4; k++) {
        const angle = (k * Math.PI) / 2, out = depth / 2 - 0.2;
        const face = new THREE.Mesh(new THREE.PlaneGeometry(width - 1.2, height - 1.2), material);
        face.position.set(Math.sin(angle) * out, bottom + height / 2, Math.cos(angle) * out);
        face.rotation.y = angle;
        tower.add(face); faces.push(face);
      }
      return faces;
    };
    const screenMat = new THREE.MeshBasicMaterial(screen ? { map: screen, toneMapped: false } : { color: 0x30343a });
    group.userData.screens = block(TOWER.screenWidth, TOWER.screenHeight, TOWER.screenBottom, screenMat);

    const panel = () => {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = anisotropy;
      const p = { canvas, texture, shown: undefined, material: new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }) };
      panels.push(p);
      return p;
    };
    let y = TOWER.screenBottom - TOWER.gap - TOWER.lapHeight;
    block(TOWER.lapWidth, TOWER.lapHeight, y, panel().material);
    for (let k = 0; k < TOWER.places; k++) {
      y -= TOWER.gap + TOWER.placeHeight;
      block(TOWER.placeWidth, TOWER.placeHeight, y, panel().material);
    }
    group.add(tower);
  }
  // Puts the lap number on the lap block and car numbers on the place blocks.
  // order: the car numbers in running order, leader first (up to five are shown).
  function setBoard({ lap = 0, order = [] } = {}) {
    panels.forEach((p, k) => {
      const text = k === 0 ? String(lap) : order[k - 1] === undefined ? '' : String(order[k - 1]);
      if (p.shown === text) return;                     // nothing changed on this block
      p.shown = text;
      const g = p.canvas.getContext('2d'), w = p.canvas.width, h = p.canvas.height;
      g.fillStyle = '#0c0e12'; g.fillRect(0, 0, w, h);
      g.textBaseline = 'middle';
      if (k === 0) {                                    // the lap block: "LAP" and the number
        g.fillStyle = '#ffd23f'; g.textAlign = 'left'; g.font = 'bold 84px sans-serif'; g.fillText('LAP', 30, h / 2 + 6);
        g.textAlign = 'right'; g.font = 'bold 200px sans-serif';
        const room = w - 28 - 215, size = Math.min(200, Math.floor((200 * room) / Math.max(1, g.measureText(text).width)));   // long texts ("120/200") get smaller
        g.font = 'bold ' + size + 'px sans-serif'; g.fillText(text, w - 28, h / 2 + 14 * (size / 200));
      } else {                                          // a place block: the place on a coloured tab, then the car's number
        g.fillStyle = k === 1 ? '#ffd23f' : '#3a7bd5'; g.fillRect(0, 0, 150, h);
        g.fillStyle = k === 1 ? '#111' : '#fff'; g.textAlign = 'center'; g.font = 'bold 170px sans-serif'; g.fillText(String(k), 75, h / 2 + 12);
        g.fillStyle = '#ffffff'; g.font = 'bold 210px sans-serif'; g.fillText(text || '–', 150 + (w - 150) / 2, h / 2 + 14);
      }
      p.texture.needsUpdate = true;
    });
  }
  setBoard({ lap: 0 });

  // The start lights: reds = how many are lit red (0-3); go = all three green
  function setStartLights(reds, go = false) {
    startLamps.forEach((lens, k) => lens.material.color.set(go ? START_LIGHT.green : k < reds ? START_LIGHT.red : START_LIGHT.off));
  }

  return { ...data, group, setBoard, setStartLights, tower: TOWER, screens: group.userData.screens, lights: lights.places };
}

const START_LIGHT = { off: 0x2a2d33, red: 0xff2a1f, green: 0x2dff5a };

// The track lights. One light: a round pole that goes straight up for a few metres and
// then sweeps over towards the track in a single curve (no corners, no boxes), a small
// collar at its foot, a slim rounded lamp head at the tip and a glowing lens under it.
// All the shape's numbers are here.
export const LIGHT = {
  spacing: 40,        // metres between lights along the track
  behindEdge: 1.6,    // the pole stands this far outside the road's edge (just behind the wall)
  straight: 5.5,      // height of the straight part of the pole (m)
  height: 9.4,        // highest point of the curve (m)
  overhang: 4.6,      // how far the tip reaches in over the track (m)
  tipDrop: 0.6,       // the tip ends this far below the highest point (m)
  thickness: 0.11,    // radius of the pole (m)
};
function buildLights(data) {
  const L = LIGHT, count = Math.round(data.length / L.spacing);
  // the pole's centre line, drawn in a flat plane: x = towards the track, y = up
  const path = new THREE.CurvePath();
  path.add(new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, L.straight, 0)));
  path.add(new THREE.CubicBezierCurve3(
    new THREE.Vector3(0, L.straight, 0), new THREE.Vector3(0, L.height + 0.2, 0),
    new THREE.Vector3(L.overhang * 0.35, L.height + 0.45, 0), new THREE.Vector3(L.overhang, L.height - L.tipDrop, 0)));
  const tip = path.getPoint(1), tipDir = path.getTangent(1);
  const metal = new THREE.MeshStandardMaterial({ color: 0xaab2bb, metalness: 0.15, roughness: 0.5 });   // pale galvanised steel
  const parts = [
    { geo: new THREE.TubeGeometry(path, 64, L.thickness, 12, false), mat: metal },
    { geo: new THREE.CylinderGeometry(L.thickness * 1.9, L.thickness * 2.5, 0.7, 16).translate(0, 0.35, 0), mat: metal },
  ];
  // lamp head: a flattened, stretched ball lying along the end of the curve
  const tilt = Math.atan2(tipDir.y, tipDir.x);
  const place = (geo, along, down) => geo.rotateZ(tilt).translate(tip.x + tipDir.x * along + tipDir.y * down, tip.y + tipDir.y * along - tipDir.x * down, 0);
  parts.push({ geo: place(new THREE.SphereGeometry(0.5, 20, 12).scale(1.25, 0.24, 0.5), 0.5, 0), mat: metal });
  parts.push({ geo: place(new THREE.SphereGeometry(0.5, 20, 12).scale(0.95, 0.12, 0.36), 0.55, 0.09), mat: new THREE.MeshBasicMaterial({ color: 0xfff3cf }) });

  const group = new THREE.Group(), places = [], m = new THREE.Matrix4();
  const meshes = parts.map((p) => { const mesh = new THREE.InstancedMesh(p.geo, p.mat, count); mesh.castShadow = true; mesh.frustumCulled = false; group.add(mesh); return mesh; });
  for (let i = 0; i < count; i++) {
    const s = (i + 0.5) * (data.length / count), c = data.centreAt(s);
    const foot = data.pointAt(s, data.width / 2 + L.behindEdge);
    // local x points in towards the track, y up, z along the track
    m.makeBasis(new THREE.Vector3(-c.nx, 0, -c.nz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(c.nz, 0, -c.nx)).setPosition(foot);
    for (const mesh of meshes) mesh.setMatrixAt(i, m);
    places.push({ s, x: foot.x, y: foot.y, z: foot.z, lampX: foot.x - c.nx * (L.overhang + 0.5), lampY: foot.y + L.height - L.tipDrop, lampZ: foot.z - c.nz * (L.overhang + 0.5) });
  }
  return { group, places };
}
