// Liveries: a different look for each of the cars in a race. makeLivery picks the
// colours and the pattern for a car from its place in the field, applyLivery paints
// them on a car model (the race number on the top and both sides, and the pattern
// as thin accent-coloured strips laid on the body).
//
// A livery is a plain object:
//   body    - the paint colour of the car, as 0xRRGGBB (buildModel uses it when no colour is given)
//   accent  - the colour of the pattern, chosen to stand out against the body, as 0xRRGGBB
//   plate   - the colour behind the white race number (dark, or the accent on dark cars), as 0xRRGGBB
//   pattern - one of 'plain' (numbers only), 'stripe' (one stripe down the middle),
//             'twoStripes' (two stripes), 'roof' (accent-coloured roof / engine cover),
//             'flank' (a band along both sides) or 'chevron' (a V on the nose)
//   number  - the race number painted on the car
//   family  - a word naming the colour family (red, orange, ... , white, black, silver): for checking
//             that no two cars share both colour family and pattern
import * as THREE from 'three';

export const PATTERNS = ['plain', 'stripe', 'twoStripes', 'roof', 'flank', 'chevron'];

// Bodies that are not a hue: every seventh car gets one of these
const SPECIALS = [
  { body: 0xf4f4f4, accent: 0xd01818, plate: 0x17171b, family: 'white' },
  { body: 0x141416, accent: 0xffc400, plate: 0xffc400, family: 'black' },
  { body: 0xbfc4cb, accent: 0x0a2a8a, plate: 0x17171b, family: 'silver' },
  { body: 0x3a3d45, accent: 0x35d6ff, plate: 0x35d6ff, family: 'gunmetal' },
  { body: 0x12183a, accent: 0xff4a1c, plate: 0xff4a1c, family: 'navy' },
  { body: 0xf3e9cf, accent: 0x1a7a3c, plate: 0x17171b, family: 'cream' },
  { body: 0x2d1a10, accent: 0xe8c16a, plate: 0xe8c16a, family: 'brown' },
];
const FAMILIES = ['red', 'orange', 'yellow', 'lime', 'green', 'teal', 'cyan', 'azure', 'blue', 'violet', 'magenta', 'pink'];

// hue (degrees), saturation and lightness (0..1) to 0xRRGGBB, as CSS would
function hsl(h, s, l) {
  const f = (n) => {
    const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

// The look of car number 'index' in the field (0, 1, 2, ...). The same index always
// gives the same livery. Hues go round the colour circle in steps, each with its own
// saturation and lightness, so neighbours in the list are clearly different cars.
export function makeLivery(index, number = index + 1) {
  const i = Math.max(0, Math.floor(index));
  const pattern = PATTERNS[(i + Math.floor(i / PATTERNS.length)) % PATTERNS.length];
  if (i % 7 === 6) {
    const s = SPECIALS[Math.floor(i / 7) % SPECIALS.length];
    return { body: s.body, accent: s.accent, plate: s.plate, pattern, number, family: s.family };
  }
  const k = i - Math.floor((i + 1) / 7);             // the car's place among the coloured cars
  const hue = (k * 360 / 37 + 8) % 360;              // 37 coloured cars among the first 43
  const sat = [0.92, 0.62, 0.8, 0.5][k % 4];
  const light = [0.5, 0.36, 0.6, 0.42, 0.3][k % 5];
  const body = hsl(hue, sat, light);
  const family = FAMILIES[Math.floor(hue / 30) % 12];
  // the accent: white, near-black or the opposite hue - whichever shows on this body
  let accent;
  const choice = k % 3;
  if (choice === 0 && light < 0.58) accent = 0xf6f6f6;
  else if (choice === 1 && light > 0.38) accent = 0x111114;
  else accent = hsl(hue + 180, 0.95, light < 0.4 ? 0.6 : 0.45);
  const plate = light < 0.38 && accent !== 0xf6f6f6 ? accent : 0x17171b;
  return { body, accent, plate, pattern, number, family };
}

// The race number as a picture: a white number on a rounded plate with a thin white rim,
// on a transparent background (the picture is square; the number fills it).
function numberTexture(number, plate) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  const r = 40, m = 10;
  g.beginPath(); g.roundRect(m, m, 256 - 2 * m, 256 - 2 * m, r);
  g.fillStyle = '#' + new THREE.Color(plate).getHexString(); g.fill();
  g.lineWidth = 8; g.strokeStyle = '#ffffff'; g.stroke();
  const text = String(number);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 190px sans-serif';
  if (g.measureText(text).width > 210) g.font = 'bold ' + Math.floor(190 * 210 / g.measureText(text).width) + 'px sans-serif';
  g.fillText(text, 128, 140);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Paints a livery on a car model from buildCarModel / buildF1Model / buildNeonModel.
// type is 'standard', 'f1' or 'neon'. Everything added sits just outside the body and
// casts no shadow. Positions are in car space: x across, y up, z forward.
export function applyLivery(car, type, livery) {
  const tex = numberTexture(livery.number, livery.plate);
  const numberMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const accent = new THREE.MeshStandardMaterial({ color: livery.accent, metalness: 0.2, roughness: 0.5 });
  const add = (mesh) => { mesh.castShadow = false; mesh.receiveShadow = false; car.add(mesh); return mesh; };

  // A number plate lying on top of the car, the top of the number towards the front.
  // tilt > 0 leans its front edge down, to follow a sloping bonnet or nose.
  const topPlate = (size, x, y, z, tilt = 0) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(size, size), numberMat);
    p.rotation.set(-Math.PI / 2 + tilt, 0, Math.PI);
    p.position.set(x, y, z);
    return add(p);
  };
  // A number plate on each side of the car, at half width hw, w wide and h tall
  const sidePlates = (w, h, hw, y, z) => {
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), numberMat);
      p.rotation.y = sx * Math.PI / 2;             // facing out of its side; the number reads from that side
      p.position.set(sx * hw, y, z);
      add(p);
    }
  };
  // A thin accent-coloured strip: w across, l along the car, lying at (x, y, z).
  // tilt leans it like topPlate, yaw turns it about the vertical (for a chevron).
  const strip = (w, l, x, y, z, tilt = 0, yaw = 0, thick = 0.012) => {
    const s = new THREE.Mesh(new THREE.BoxGeometry(w, thick, l), accent);
    s.rotation.set(-tilt, yaw, 0);            // turned first, then leant over with the surface
    s.position.set(x, y, z);
    return add(s);
  };
  // A band along a side of the car, at half width hw (the band stands just outside the body)
  const sideBand = (h, l, hw, y, z) => { for (const sx of [-1, 1]) strip(0.02, l, sx * hw, y, z, 0, 0, h); };
  // A V on the nose, its point forwards: two strips turned in towards the tip
  const chevron = (w, l, spread, y, z, tilt = 0) => {
    for (const sx of [-1, 1]) strip(w, l, sx * spread, y, z, tilt, -sx * 0.6);
  };
  const p = livery.pattern;

  if (type === 'f1') {
    // The body is a 0.72 m wide box (top at y 0.66) from z -1.45 to 1.05, the engine cover a
    // 0.42 m wide box (top y 1.02) from z -1.9 to -0.4, the side pods 0.46 m wide boxes
    // (outer faces at x +-0.81, top y 0.58) from z -1.5 to 0.2, and the nose a cone from
    // z 1.0 (radius 0.34) to z 2.7 (radius 0.09) round y 0.4.
    const noseTop = (z) => 0.4 + 0.34 - (0.34 - 0.09) * (z - 1.0) / 1.7, noseTilt = Math.atan(0.25 / 1.7);
    topPlate(0.5, 0, noseTop(1.45) + 0.03, 1.45, noseTilt);
    sidePlates(0.6, 0.36, 0.215, 0.82, -1.15);
    if (p === 'stripe') { strip(0.14, 1.48, 0, 1.026, -1.15); strip(0.1, 1.5, 0, noseTop(1.85) + 0.008, 1.85, noseTilt); }
    if (p === 'twoStripes') { for (const x of [-0.12, 0.12]) strip(0.1, 1.48, x, 1.026, -1.15); for (const x of [-0.58, 0.58]) strip(0.14, 1.68, x, 0.586, -0.65); }
    if (p === 'roof') { strip(0.44, 1.52, 0, 1.02, -1.15, 0, 0, 0.03); for (const x of [-0.58, 0.58]) strip(0.48, 1.72, x, 0.58, -0.65, 0, 0, 0.03); }
    if (p === 'flank') { sideBand(0.12, 1.7, 0.82, 0.46, -0.65); sideBand(0.1, 1.5, 0.22, 0.68, -1.15); }
    if (p === 'chevron') chevron(0.08, 0.5, 0.1, noseTop(2.15) + 0.01, 2.15, noseTilt);
  } else if (type === 'neon') {
    // The body is a 1.96 m wide wedge: the bonnet slopes from y 0.72 at z 0.9 down to 0.46 at z 2.05,
    // the deck behind the cabin is at about y 0.83 (z -2.25 to -1.35), the painted roof is a
    // 1.36 m wide panel at y 1.125 from z -0.8 to 0.12, and the sides are at x +-0.98 (the dark
    // sills stick out to 1.03 below y 0.36).
    const bonnet = (z) => 0.72 - 0.226 * (z - 0.9), bonnetTilt = Math.atan(0.226);
    topPlate(0.8, 0, 1.16, -0.34);
    sidePlates(0.5, 0.3, 0.995, 0.63, -0.4);
    if (p === 'stripe') { strip(0.26, 0.86, 0, 1.131, -0.34); strip(0.26, 1.1, 0, bonnet(1.45) + 0.008, 1.45, bonnetTilt); strip(0.26, 0.85, 0, 0.846, -1.8, -Math.atan(0.05)); }
    if (p === 'twoStripes') for (const x of [-0.36, 0.36]) { strip(0.16, 0.86, x, 1.131, -0.34); strip(0.16, 1.1, x, bonnet(1.45) + 0.008, 1.45, bonnetTilt); strip(0.16, 0.85, x, 0.846, -1.8, -Math.atan(0.05)); }
    if (p === 'roof') { strip(1.38, 0.9, 0, 1.125, -0.34, 0, 0, 0.035); strip(1.92, 0.44, 0, 1.111, -2.0, 0, 0, 0.02); }
    if (p === 'flank') sideBand(0.08, 4.4, 0.985, 0.42, 0);
    if (p === 'chevron') chevron(0.1, 0.7, 0.32, bonnet(1.7) + 0.01, 1.7, bonnetTilt);
  } else {
    // The standard car: a 2.0 x 0.6 x 4.2 m box body (top at y 0.85, sides at x +-1.0), a glass
    // cabin from z -1.2 to 0.8 and a 1.6 m square roof panel at y 1.4 (top 1.44) centred on z -0.3.
    // The bonnet is the body top from z 0.8 to 2.1, the boot from -2.1 to -1.2. Wheels fill
    // the sides from z 0.93 to 1.77 and -1.77 to -0.93.
    topPlate(0.9, 0, 0.88, 1.3);
    sidePlates(0.62, 0.44, 1.005, 0.5, 0);
    if (p === 'stripe') { strip(0.32, 1.28, 0, 0.856, 1.45); strip(0.32, 1.62, 0, 1.446, -0.3); strip(0.32, 0.88, 0, 0.856, -1.65); }
    if (p === 'twoStripes') for (const x of [-0.36, 0.36]) { strip(0.18, 1.28, x, 0.856, 1.45); strip(0.18, 1.62, x, 1.446, -0.3); strip(0.18, 0.88, x, 0.856, -1.65); }
    if (p === 'roof') strip(1.64, 1.64, 0, 1.4, -0.3, 0, 0, 0.084);
    if (p === 'flank') sideBand(0.1, 4.2, 1.005, 0.79, 0);
    if (p === 'chevron') chevron(0.12, 0.6, 0.36, 0.856, 1.85);
  }
  return car;
}
