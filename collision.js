// Car-to-car collisions. Each car is treated as a rectangle lying on the ground.
// When two rectangles overlap, the cars are pushed apart and bounce off each
// other: speed is exchanged along the direction of the hit, and a hit away from
// a car's centre also makes it spin a little.

const BOUNCE = 0.35;       // 0 = cars stick together, 1 = perfectly bouncy
const SPIN = 0.12;         // how strongly an off-centre hit turns the car
const MAX_SPIN = 2.5;      // radians per second

function corners(c) {
  const fx = Math.sin(c.heading), fz = Math.cos(c.heading);   // forward; sideways is (fz, -fx)
  const out = [];
  for (const [a, b] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    out.push({ x: c.x + fx * c.halfLength * a + fz * c.halfWidth * b, z: c.z + fz * c.halfLength * a - fx * c.halfWidth * b });
  }
  return out;
}

function contains(c, p) {
  const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
  const dx = p.x - c.x, dz = p.z - c.z;
  return Math.abs(dx * fx + dz * fz) <= c.halfLength && Math.abs(dx * fz - dz * fx) <= c.halfWidth;
}

// If cars a and b overlap: returns { nx, nz, depth } where (nx, nz) points from a
// towards b along the shallowest overlap. Otherwise returns null.
export function overlap(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const reach = a.halfLength + a.halfWidth + b.halfLength + b.halfWidth;
  if (dx * dx + dz * dz > reach * reach) return null;           // far apart: skip the detailed test
  let best = null;
  for (const c of [a, b]) {
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    for (const [ax, az] of [[fx, fz], [fz, -fx]]) {               // each rectangle's two axes
      const extent = (k) => {
        const kx = Math.sin(k.heading), kz = Math.cos(k.heading);
        return k.halfLength * Math.abs(kx * ax + kz * az) + k.halfWidth * Math.abs(kz * ax - kx * az);
      };
      const d = dx * ax + dz * az;
      const depth = extent(a) + extent(b) - Math.abs(d);
      if (!(depth > 0)) return null;                              // a gap along this axis (or a broken position): no contact
      if (!best || depth < best.depth) best = { nx: d < 0 ? -ax : ax, nz: d < 0 ? -az : az, depth };
    }
  }
  return best;
}

// Detects and resolves a collision between two cars (CarController objects).
// Returns the strength of the hit in m/s (0 if they only touch), or null if no contact.
export function collideCars(a, b) {
  const hit = overlap(a, b);
  if (!hit) return null;
  const { nx, nz, depth } = hit;

  // Where they touch: the corners of one car that are inside the other
  const inside = [...corners(a).filter((p) => contains(b, p)), ...corners(b).filter((p) => contains(a, p))];
  const px = inside.length ? inside.reduce((s, p) => s + p.x, 0) / inside.length : (a.x + b.x) / 2;
  const pz = inside.length ? inside.reduce((s, p) => s + p.z, 0) / inside.length : (a.z + b.z) / 2;

  // Push them apart so they no longer overlap
  a.x -= (nx * depth) / 2; a.z -= (nz * depth) / 2;
  b.x += (nx * depth) / 2; b.z += (nz * depth) / 2;

  // Bounce, if they are moving into each other (equal weights)
  const closing = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
  let impulse = 0;
  if (closing < 0) {
    impulse = (-(1 + BOUNCE) * closing) / 2;
    a.vx -= impulse * nx; a.vz -= impulse * nz;
    b.vx += impulse * nx; b.vz += impulse * nz;
    // Off-centre hits turn the car: lever arm (centre -> contact) crossed with the push
    const spin = (c, sx, sz) => {
      const rx = px - c.x, rz = pz - c.z;
      c.spin = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, c.spin + SPIN * (rz * sx - rx * sz)));
    };
    spin(a, -impulse * nx, -impulse * nz);
    spin(b, impulse * nx, impulse * nz);
  }
  a.apply(); b.apply();
  return impulse;
}
