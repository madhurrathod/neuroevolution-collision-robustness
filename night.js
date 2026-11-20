// Night: a dark sky with a few stars and a moon, and the stadium's track lights
// really lighting the road in pools.
import * as THREE from 'three';

// All the numbers of the night are here.
export const NIGHT = {
  sky: 0x02030a,              // almost black
  stars: 130,                 // "a few"
  moon: { azimuth: 2.2, elevation: 0.3, size: 0.085 },   // where the moon hangs (radians; size = its width as a fraction of its distance):
                                                         // low over the infield, ahead and to the left as you leave the start line
  moonlightFrom: 0.7,         // the moonlight itself comes from higher up than the moon is drawn, so shadows are not absurdly long
  moonlight: 0x9fb6ff,        // pale blue
  // One track light: a cone of warm light from the lamp head down onto the road
  track: { colour: 0xffdcaa, power: 620, angle: 1.12, soft: 0.85, aimAt: 1.5 },   // aimAt: the cone points at the road this far from its middle (m, towards the outside)
  // One pit light: a white lamp under the edge of the garage roof, every second box
  pit: { colour: 0xf1f5ff, power: 150, angle: 1.15, soft: 0.8, every: 2, lampAt: -39.3, height: 4.9, aimAt: -33 },
  near: 6,                    // this many of the nearest lights are real lights (they light the cars);
                              // the others are drawn as pools of light painted on the ground
  shadows: 1,                 // of the real lights, the very nearest casts shadows (one is enough: half-way between two lamps,
                              // where the nearest lamp changes, neither reaches the car, so the change cannot be seen)
  fade: 25,                   // a light changes from painted to real over this many metres, so nothing pops
  paint: 0.03,                // how bright the painted pools are (matched by eye to the real lights on tarmac)
};

// ---------------------------------------------------------------------------
// The sky: stars and a moon that stay infinitely far away (they travel with the camera)
// ---------------------------------------------------------------------------
export function createNightSky() {
  const group = new THREE.Group(), R = 1000;
  group.visible = false;

  // Stars: scattered over the upper half of the sky, most of them faint
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pos = [], col = [];
  for (let i = 0; i < NIGHT.stars; i++) {
    const az = rnd() * Math.PI * 2, el = Math.asin(0.06 + rnd() * 0.94);
    pos.push(Math.sin(az) * Math.cos(el) * R, Math.sin(el) * R, Math.cos(az) * Math.cos(el) * R);
    const b = 0.25 + 0.75 * rnd() ** 3, warm = rnd();
    col.push(b * (0.85 + 0.15 * warm), b * 0.92, b * (1 - 0.15 * warm));
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  starGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const sky = { depthTest: false, depthWrite: false, fog: false, toneMapped: false };   // drawn first, behind everything
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, ...sky }));
  stars.renderOrder = -1000; stars.frustumCulled = false;
  group.add(stars);

  // The moon: a pale disc with a few grey seas and a soft glow round it
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const g = canvas.getContext('2d');
  const glow = g.createRadialGradient(128, 128, 50, 128, 128, 128);
  glow.addColorStop(0, 'rgba(150,170,220,0.55)'); glow.addColorStop(0.35, 'rgba(90,110,170,0.16)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = glow; g.fillRect(0, 0, 256, 256);
  g.save(); g.beginPath(); g.arc(128, 128, 56, 0, Math.PI * 2); g.clip();
  const face = g.createRadialGradient(110, 108, 10, 128, 128, 60);
  face.addColorStop(0, '#fbfbf2'); face.addColorStop(1, '#d9dbd6');
  g.fillStyle = face; g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(120,126,140,0.35)';
  for (const [x, y, r] of [[108, 104, 17], [140, 96, 11], [150, 132, 15], [116, 146, 10], [96, 128, 7], [134, 160, 6]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  g.restore();
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const M = NIGHT.moon;
  const direction = new THREE.Vector3(Math.sin(M.azimuth) * Math.cos(M.elevation), Math.sin(M.elevation), Math.cos(M.azimuth) * Math.cos(M.elevation));
  // (its black surround adds nothing to the sky: the picture is added to what is behind it)
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(R * M.size * 256 / 112, R * M.size * 256 / 112),
    new THREE.MeshBasicMaterial({ map: texture, blending: THREE.AdditiveBlending, ...sky }));
  moon.position.copy(direction).multiplyScalar(R);
  moon.lookAt(0, 0, 0);
  moon.renderOrder = -999; moon.frustumCulled = false;
  group.add(moon);

  const lightDirection = new THREE.Vector3(Math.sin(M.azimuth) * Math.cos(NIGHT.moonlightFrom), Math.sin(NIGHT.moonlightFrom), Math.cos(M.azimuth) * Math.cos(NIGHT.moonlightFrom));
  return { group, moonDirection: direction, lightDirection, follow(camera) { group.position.copy(camera.position); group.updateMatrixWorld(true); } };
}

// ---------------------------------------------------------------------------
// The stadium's lights at night
// ---------------------------------------------------------------------------
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function softDot() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

// stadium: what buildStadium returns. Add .group to stadium.group; call setOn(true) at night
// and update(x, z) every frame with the place being looked at (your car, normally).
export function createTrackLighting(stadium) {
  const group = new THREE.Group(), nightOnly = new THREE.Group();
  nightOnly.visible = false;
  group.add(nightOnly);
  const T = NIGHT.track, P = NIGHT.pit, pit = stadium.pit;

  // Every light: where the lamp is, where its cone points, and which patch of ground it reaches
  const lights = [];
  for (const l of stadium.lights) {
    lights.push({ kind: T, lamp: new THREE.Vector3(l.lampX, l.lampY - 0.25, l.lampZ), aim: stadium.pointAt(l.s, T.aimAt),
      patch: { s0: l.s - 24, s1: l.s + 24, ds: 3, d0: stadium.width / 2, d1: -24, dd: 2 } });
  }
  // Pit lights: small white lamps under the edge of the garage roof
  const fixtureGeo = new THREE.BoxGeometry(1.1, 0.12, 0.4), count = Math.ceil(stadium.config.cars / P.every);
  const fixtures = new THREE.InstancedMesh(fixtureGeo, new THREE.MeshBasicMaterial({ color: 0xf6f8ff }), count);
  const m = new THREE.Matrix4();
  for (let k = 0; k < count; k++) {
    const s = pit.boxesFrom + pit.boxLength * (k * P.every + 0.5), c = stadium.centreAt(s);
    const lamp = stadium.pointAt(s, P.lampAt, P.height);
    m.makeRotationY(Math.atan2(c.tx, c.tz) + Math.PI / 2).setPosition(lamp.x, lamp.y + 0.12, lamp.z);
    fixtures.setMatrixAt(k, m);
    lights.push({ kind: P, lamp, aim: stadium.pointAt(s, P.aimAt),
      patch: { s0: s - 14, s1: s + 14, ds: 2, d0: pit.roadOuter, d1: pit.building.outer + 0.5, dd: 1.5 } });
  }
  fixtures.frustumCulled = false;
  group.add(fixtures);

  // How much light a lamp throws on a point of the ground (the same sum the real lights do)
  const toLamp = new THREE.Vector3();
  function brightness(light, p, normal) {
    const k = light.kind;
    toLamp.copy(light.lamp).sub(p);
    const dist = toLamp.length(); toLamp.divideScalar(dist);
    const facing = Math.max(0, normal.dot(toLamp));
    const inCone = smoothstep(Math.cos(k.angle), Math.cos(k.angle * (1 - k.soft)), -toLamp.dot(light.dir));
    return (k.power * inCone * facing) / (dist * dist);
  }

  // The painted pools: one patch of ground per light, coloured by how much light reaches each point
  const pos = [], base = [], idx = [];
  for (const light of lights) {
    light.dir = light.aim.clone().sub(light.lamp).normalize();
    light.colour = new THREE.Color(light.kind.colour);
    const a = light.patch, cols = Math.round((a.s1 - a.s0) / a.ds), rows = Math.round((a.d0 - a.d1) / a.dd), first = pos.length / 3;
    light.first = first; light.count = (cols + 1) * (rows + 1);
    for (let i = 0; i <= cols; i++) for (let j = 0; j <= rows; j++) {
      const d = a.d0 + ((a.d1 - a.d0) * j) / rows - (j === 0 ? 0.05 : 0);
      const p = stadium.pointAt(a.s0 + a.ds * i, d, 0.09);
      const edge = Math.min(i, cols - i, j < rows ? 9 : 0) === 0 ? 0 : 1;      // the patch's far edges are always dark, so it has no visible border
      const e = brightness(light, p, stadium.normalAt(p.x, p.z)) * NIGHT.paint * edge;
      pos.push(p.x, p.y, p.z);
      base.push(light.colour.r * e, light.colour.g * e, light.colour.b * e);
      if (i < cols && j < rows) { const q = first + i * (rows + 1) + j; idx.push(q, q + 1, q + rows + 1, q + 1, q + rows + 2, q + rows + 1); }
    }
    light.painted = -1;    // how strongly its pool is painted now (set in update)
  }
  const poolGeo = new THREE.BufferGeometry();
  poolGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const colours = new THREE.Float32BufferAttribute(new Float32Array(base.length), 3);
  poolGeo.setAttribute('color', colours);
  poolGeo.setIndex(idx);
  const pools = new THREE.Mesh(poolGeo, new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
  pools.frustumCulled = false; pools.renderOrder = 2;
  nightOnly.add(pools);

  // A glow at every lamp: a soft ball close up, a bright dot from far away
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(lights.flatMap((l) => [l.lamp.x, l.lamp.y, l.lamp.z]), 3));
  glowGeo.setAttribute('color', new THREE.Float32BufferAttribute(lights.flatMap((l) => [l.colour.r, l.colour.g, l.colour.b]), 3));
  const dot = softDot();
  const glowMat = (size, attenuate, opacity) => new THREE.PointsMaterial({ map: dot, size, sizeAttenuation: attenuate, vertexColors: true, opacity,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  for (const mat of [glowMat(4.5, true, 0.8), glowMat(5, false, 0.9)]) { const pts = new THREE.Points(glowGeo, mat); pts.frustumCulled = false; pts.renderOrder = 3; nightOnly.add(pts); }

  // The real lights: a handful, moved every frame to the lamps nearest the car.
  // The nearest casts shadows.
  const spots = [];
  for (let k = 0; k < NIGHT.near; k++) {
    const spot = new THREE.SpotLight(0xffffff, 0, 0, 1, 0.8, 2);
    if (k < NIGHT.shadows) { spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.camera.near = 0.6; spot.shadow.camera.far = 40; spot.shadow.radius = 2.5; spot.shadow.bias = -0.0015; spot.shadow.normalBias = 0.03; }
    nightOnly.add(spot, spot.target);
    spots.push(spot);
  }

  const order = lights.map((_, i) => i);
  function update(x, z) {
    if (!nightOnly.visible) return;
    for (const l of lights) l.far = Math.hypot(l.aim.x - x, l.aim.z - z);
    order.sort((a, b) => lights[a].far - lights[b].far);
    const reach = lights[order[NIGHT.near]].far;          // the first light that gets no real lamp
    let changed = false;
    order.forEach((i, rank) => {
      const l = lights[i], real = rank < NIGHT.near ? Math.min(1, (reach - l.far) / NIGHT.fade) : 0;
      if (rank < NIGHT.near) {
        const spot = spots[rank], k = l.kind;
        spot.position.copy(l.lamp); spot.target.position.copy(l.aim);
        spot.color.copy(l.colour); spot.intensity = k.power * real; spot.angle = k.angle; spot.penumbra = k.soft;
      }
      const painted = 1 - real;
      if (painted !== l.painted) {
        l.painted = painted; changed = true;
        const arr = colours.array;
        for (let q = l.first * 3, end = (l.first + l.count) * 3; q < end; q++) arr[q] = base[q] * painted;
      }
    });
    if (changed) colours.needsUpdate = true;
  }

  return { group, lights, spots, update, get on() { return nightOnly.visible; }, setOn(on) { nightOnly.visible = on; for (const l of lights) l.painted = -1; } };
}
