// The track: a closed loop with a wide lane, built from a smooth centerline.
// Other parts of the game (and later the AI) use track.centerline, track.width
// and track.nearest(point) to know where the road is.
import * as THREE from 'three';

export const TRACK_WIDTH = 14;   // lane width in metres (wide, room for several cars)
const HALF = TRACK_WIDTH / 2;
const CURB_WIDTH = 1.4;          // red/white curb on each side
const CURB_HEIGHT = 0.12;        // curbs are slightly raised at their outer edge
const STRIPE_LENGTH = 3;         // length of one red or one white curb block (m)
const DASH_PERIOD = 8;           // centre line: one dash + gap (m)
const SAMPLES = 1200;            // points along the centerline (more = smoother edges)
const BUMP_COUNT = 3;            // speed bumps round the loop
const BUMP_HEIGHT = 0.12;        // metres
const BUMP_HALF_LENGTH = 0.9;    // metres from the crest to where the bump ends, along the road

// Shape of the loop: a stretched circle whose radius swells and shrinks gently.
// Every bend has a radius of at least ~34 m, so there are no sudden sharp turns.
function shape(t) {
  const r = 80 + 10 * Math.cos(2 * t) + 9 * Math.sin(3 * t + 0.6) + 4 * Math.cos(5 * t + 1);
  return new THREE.Vector3(1.15 * r * Math.cos(t), 0, r * Math.sin(t));
}

// The track's shape and the questions you can ask about it (where is the road,
// how far along the loop is a point). No drawing here, so it also runs outside
// the browser (the AI training script uses it).
export function buildTrackData() {
  // Build a smooth closed curve through densely sampled points, then resample it
  // evenly by distance so every segment of road has the same length.
  const raw = [];
  for (let i = 0; i < 240; i++) raw.push(shape((i / 240) * Math.PI * 2));
  const curve = new THREE.CatmullRomCurve3(raw, true, 'centripetal');
  const length = curve.getLength();

  const center = [];   // sampled centerline points
  const tangent = [];  // direction of travel at each sample
  const normal = [];   // direction to the right of travel
  for (let i = 0; i < SAMPLES; i++) {
    const t = i / SAMPLES;
    center.push(curve.getPointAt(t));
    const tg = curve.getTangentAt(t).setY(0).normalize();
    tangent.push(tg);
    normal.push(new THREE.Vector3(-tg.z, 0, tg.x));
  }
  const h0 = Math.atan2(tangent[0].x, tangent[0].z);
  const EDGE = HALF + CURB_WIDTH;   // road plus curbs counts as "on track"; beyond that is grass

  // Lookup grid of "distance to the centre line", 0.5 m cells, filled in only
  // near the road. Makes on-road checks (and the AI's sensor rays) very cheap.
  const CELL = 0.5, REACH = EDGE + 4, FAR = 99;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of center) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  minX -= REACH + 1; minZ -= REACH + 1; maxX += REACH + 1; maxZ += REACH + 1;
  const GW = Math.ceil((maxX - minX) / CELL), GH = Math.ceil((maxZ - minZ) / CELL);
  const grid = new Float32Array(GW * GH).fill(FAR);
  const r = Math.ceil(REACH / CELL);
  for (const p of center) {
    const cx = Math.floor((p.x - minX) / CELL), cz = Math.floor((p.z - minZ) / CELL);
    for (let j = cz - r; j <= cz + r; j++) for (let i = cx - r; i <= cx + r; i++) {
      if (i < 0 || j < 0 || i >= GW || j >= GH) continue;
      const d = Math.hypot(minX + (i + 0.5) * CELL - p.x, minZ + (j + 0.5) * CELL - p.z);
      if (d < grid[j * GW + i]) grid[j * GW + i] = d;
    }
  }
  const distanceAt = (x, z) => {
    const i = Math.floor((x - minX) / CELL), j = Math.floor((z - minZ) / CELL);
    return (i < 0 || j < 0 || i >= GW || j >= GH) ? FAR : grid[j * GW + i];
  };

  // Speed bumps: spread evenly round the loop (none near the start line), each
  // nudged to the straightest piece of road nearby. A bump is a smooth hump
  // across the whole road, curbs included.
  const bend = (i) => 1 - tangent[(i + 10) % SAMPLES].dot(tangent[(i - 10 + SAMPLES) % SAMPLES]);   // 0 = straight
  const bumps = [];
  for (let k = 0; k < BUMP_COUNT; k++) {
    const around = Math.round(((k + 0.5) / BUMP_COUNT) * SAMPLES);
    let index = around;
    for (let i = around - 60; i <= around + 60; i++) if (bend(i) < bend(index)) index = i;
    const p = center[index], tg = tangent[index], nr = normal[index];
    bumps.push({ index, x: p.x, z: p.z, tx: tg.x, tz: tg.z, nx: nr.x, nz: nr.z, height: BUMP_HEIGHT, halfLength: BUMP_HALF_LENGTH });
  }
  // Height of the road surface above normal at a point (0 everywhere except on a bump)
  const bumpHeightAt = (x, z) => {
    for (const b of bumps) {
      const dx = x - b.x, dz = z - b.z;
      const along = dx * b.tx + dz * b.tz;
      if (Math.abs(along) >= b.halfLength || Math.abs(dx * b.nx + dz * b.nz) > EDGE) continue;   // bumps run across the curbs too
      const c = Math.cos((Math.PI * along) / (2 * b.halfLength));
      return b.height * c * c;
    }
    return 0;
  };
  // Distance along the track from a centerline sample to the next bump ahead (m)
  const distanceToBump = (index) => {
    let best = Infinity;
    for (const b of bumps) best = Math.min(best, (((b.index - index) % SAMPLES) + SAMPLES) % SAMPLES);
    return best * (length / SAMPLES);
  };
  return {
    curve,
    length,
    centerline: center,
    tangents: tangent,
    normals: normal,
    width: TRACK_WIDTH,
    edge: EDGE,
    segmentLength: length / SAMPLES,
    // Start pose: on the start line, facing along the track
    start: { position: center[0].clone(), heading: h0 },
    // Nearest centerline sample to a world point: { index, dist, point, tangent }
    nearest(p) { const n = nearestTo(center, p.x, p.z); return { ...n, point: center[n.index], tangent: tangent[n.index] }; },
    // Faster version that only looks at samples within `window` of a known index
    nearestLocal(x, z, hint, window = 80) { return nearestLocal(center, x, z, hint, window); },
    // Distance from a point to the centre line (approximate, 99 if far from the road)
    distanceAt,
    bumps,
    bumpHeightAt,
    distanceToBump,
    isOnTrack(p) { return distanceAt(p.x, p.z) <= EDGE; },
  };
}

export function buildTrack({ anisotropy = 8 } = {}) {
  const data = buildTrackData();
  const { centerline: center, tangents: tangent, normals: normal, length } = data;
  const h0 = data.start.heading;

  const group = new THREE.Group();

  // Ground (grass)
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 800),
    new THREE.MeshLambertMaterial({ color: 0x3f8a3a })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.02;
  grass.receiveShadow = true;
  group.add(grass);

  // Road surface: one strip with the dashed centre line painted in its texture,
  // so the line always follows the road exactly.
  const dashRepeats = Math.round(length / DASH_PERIOD);
  const road = strip(center, normal, [[-HALF, 0, 0], [HALF, 0, 1]], dashRepeats,
    material(roadTexture(anisotropy)));
  group.add(road);

  // Curbs: their inner edge uses exactly the same points as the road edge.
  // Profile: road edge (flat) -> raised outer edge -> drop back down to the grass.
  const stripeRepeats = Math.round(length / (2 * STRIPE_LENGTH));
  const curbTex = curbTexture(anisotropy);
  const W = CURB_WIDTH, H = CURB_HEIGHT;
  group.add(strip(center, normal, [[HALF, 0.005, 0], [HALF + W, H, 1], [HALF + W, 0, 1]], stripeRepeats, material(curbTex)));
  group.add(strip(center, normal, [[-HALF - W, 0, 1], [-HALF - W, H, 1], [-HALF, 0.005, 0]], stripeRepeats, material(curbTex)));

  // Start / finish line at sample 0, lying across the road
  const start = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_WIDTH, 2.5), checkerMaterial(anisotropy));
  start.rotation.set(-Math.PI / 2, 0, h0, 'XYZ');
  start.position.copy(center[0]).setY(0.01);
  group.add(start);

  // Speed bumps: yellow and black humps across the asphalt
  const bumpMat = new THREE.MeshLambertMaterial({ map: bumpTexture(anisotropy) });
  for (const b of data.bumps) {
    const rows = 10, pos = [], uv = [], idx = [];
    for (let r = 0; r <= rows; r++) {
      const along = -b.halfLength + (2 * b.halfLength * r) / rows;
      const c = Math.cos((Math.PI * along) / (2 * b.halfLength)), y = b.height * c * c + 0.012;
      // four points across: outer edge of one curb, the two asphalt edges, outer edge of the other curb
      for (const [off, lift, u] of [[-HALF - CURB_WIDTH, CURB_HEIGHT, -0.7], [-HALF, 0, 0], [HALF, 0, 7], [HALF + CURB_WIDTH, CURB_HEIGHT, 7.7]]) {
        pos.push(b.x + b.tx * along + b.nx * off, y + lift, b.z + b.tz * along + b.nz * off);
        uv.push(u, r / rows);
      }
      if (r < rows) for (let k = 0; k < 3; k++) { const a = 4 * r + k; idx.push(a, a + 1, a + 4, a + 1, a + 5, a + 4); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const hump = new THREE.Mesh(geo, bumpMat);
    hump.material.side = THREE.DoubleSide;
    hump.receiveShadow = true;
    group.add(hump);
  }

  // A few trees around for scale, kept well away from the road
  const treeGeo = new THREE.ConeGeometry(2.5, 7, 8);
  const treeMat = new THREE.MeshLambertMaterial({ color: 0x2e6b2a });
  const trunkGeo = new THREE.CylinderGeometry(0.4, 0.5, 2, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
  const rnd = mulberry32(7);
  let placed = 0;
  while (placed < 70) {
    const x = (rnd() - 0.5) * 320, z = (rnd() - 0.5) * 280;
    if (nearestTo(center, x, z).dist < HALF + CURB_WIDTH + 6) continue;
    const tree = new THREE.Group();
    const cone = new THREE.Mesh(treeGeo, treeMat); cone.position.y = 5; cone.castShadow = true;
    const trunk = new THREE.Mesh(trunkGeo, trunkMat); trunk.position.y = 1;
    tree.add(cone, trunk);
    tree.position.set(x, 0, z);
    group.add(tree);
    placed++;
  }

  return { ...data, group };
}

function nearestLocal(center, x, z, hint, window) {
  const n = center.length;
  let best = hint, bestD = Infinity;
  for (let k = -window; k <= window; k++) {
    const i = ((hint + k) % n + n) % n;
    const dx = center[i].x - x, dz = center[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return { index: best, dist: Math.sqrt(bestD) };
}

function nearestTo(center, x, z) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < center.length; i++) {
    const dx = center[i].x - x, dz = center[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return { index: best, dist: Math.sqrt(bestD) };
}

// A band running all the way round the loop. `profile` is a list of
// [offset to the right of the centerline, height, texture u] points across it.
// Texture v runs along the loop, repeating `repeats` times so the pattern
// joins up seamlessly at the start line.
function strip(center, normal, profile, repeats, mat) {
  const n = center.length, m = profile.length;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {          // last ring repeats the first one (with v = repeats)
    const c = center[i % n], nr = normal[i % n];
    for (const [off, y, u] of profile) {
      pos.push(c.x + nr.x * off, y, c.z + nr.z * off);
      uv.push(u, (i / n) * repeats);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < m - 1; k++) {
      const a = i * m + k, b = a + 1, c = a + m, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function material(map) {
  return new THREE.MeshLambertMaterial({ map, side: THREE.DoubleSide });
}

function canvasTexture(w, h, draw, anisotropy) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Asphalt with a white dash down the middle (one dash per texture repeat)
function roadTexture(anisotropy) {
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#3b3b3d'; g.fillRect(0, 0, w, h);
    // a little grain so the surface isn't flat grey
    const rnd = mulberry32(3);
    for (let i = 0; i < 6000; i++) {
      const v = 50 + Math.floor(rnd() * 18);
      g.fillStyle = `rgb(${v},${v},${v + 2})`;
      g.fillRect(rnd() * w, rnd() * h, 2, 2);
    }
    // thin white edge lines just inside the curbs
    g.fillStyle = '#e8e8e8';
    g.fillRect(6, 0, 8, h); g.fillRect(w - 14, 0, 8, h);
    // centre dash: 3/8 of the period
    g.fillRect(w / 2 - 6, 0, 12, h * 0.375);
  }, anisotropy);
}

// One red block and one white block, stacked along the road
function curbTexture(anisotropy) {
  return canvasTexture(64, 256, (g, w, h) => {
    g.fillStyle = '#d42a2a'; g.fillRect(0, 0, w, h / 2);
    g.fillStyle = '#f4f4f4'; g.fillRect(0, h / 2, w, h / 2);
  }, anisotropy);
}

// Diagonal yellow and black warning stripes (repeats across the road)
function bumpTexture(anisotropy) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f5c400'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#1a1a1a';
  for (let k = -2; k < 3; k++) { g.beginPath(); g.moveTo(k * 128, 128); g.lineTo(k * 128 + 64, 128); g.lineTo(k * 128 + 192, 0); g.lineTo(k * 128 + 128, 0); g.fill(); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function checkerMaterial(anisotropy) {
  const c = document.createElement('canvas');
  c.width = 448; c.height = 80;
  const g = c.getContext('2d');
  const s = 40;
  for (let x = 0; x < c.width / s; x++) for (let y = 0; y < 2; y++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#f2f2f2';
    g.fillRect(x * s, y * s, s, s);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: tex });
}

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
