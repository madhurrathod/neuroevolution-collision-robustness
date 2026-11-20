// The tyres you can fit in the garage. Numbers are relative to the car's own
// figures (1 = the car's normal value) unless a unit is given.
//
//   fits          which kinds of car the tyre can be fitted to
//   roadGrip      sideways grip on the road (higher = corners faster, skids later)
//   friction      rolling friction on the road (lower = accelerates and coasts better)
//   topSpeed      top speed on the road
//   offroadGrip   grip on grass, as a fraction of the car's road grip
//   offroadSpeed  top speed on grass in m/s (for a car of normal ride height)
//   offroadDrag   how hard grass holds the car back (m/s²)
//   size          wheel size (1 = the car's normal wheels; off-road tyres are big)
//   clearance     how much the tyre raises (+) or lowers (-) the car, in metres
export const TYRES = {
  street: {
    name: 'Street', fits: ['standard'],
    description: 'The all-rounder the car comes with.',
    roadGrip: 1.0, friction: 1.0, topSpeed: 1.0, offroadGrip: 0.45, offroadSpeed: 12.8, offroadDrag: 4, size: 1.0, clearance: 0,
  },
  sport: {
    name: 'Sport', fits: ['standard'],
    description: 'Wide, low and sticky: more grip and less friction on the road, poor on grass, and the car sits lower.',
    roadGrip: 1.2, friction: 0.85, topSpeed: 1.0, offroadGrip: 0.3, offroadSpeed: 10, offroadDrag: 5, size: 1.0, clearance: -0.02,
  },
  eco: {
    name: 'Low-friction', fits: ['standard'],
    description: 'Hard, narrow tyres that roll very freely: quicker off the line and a higher top speed, but less grip in bends.',
    roadGrip: 0.88, friction: 0.45, topSpeed: 1.05, offroadGrip: 0.4, offroadSpeed: 12, offroadDrag: 4, size: 1.0, clearance: 0,
  },
  allTerrain: {
    name: 'All-terrain', fits: ['standard'],
    description: 'A compromise: a little slower on the road, much happier on grass, slightly taller.',
    roadGrip: 0.92, friction: 1.25, topSpeed: 0.97, offroadGrip: 0.7, offroadSpeed: 17, offroadDrag: 3, size: 1.12, clearance: 0.04,
  },
  offroad: {
    name: 'Off-road', fits: ['standard'],
    description: 'Big knobbly tyres: the car rides high, shrugs off bumps and is fast on grass, but is slow and slides early on the road.',
    roadGrip: 0.8, friction: 1.6, topSpeed: 0.9, offroadGrip: 0.9, offroadSpeed: 21, offroadDrag: 2.5, size: 1.35, clearance: 0.1,
  },
  slick: {
    name: 'Racing slick', fits: ['f1'],
    description: 'The hard racing tyre the F1 car comes with. Useless on grass.',
    roadGrip: 1.0, friction: 1.0, topSpeed: 1.0, offroadGrip: 0.22, offroadSpeed: 12.8, offroadDrag: 4, size: 1.0, clearance: 0,
  },
  softSlick: {
    name: 'Soft slick', fits: ['f1'],
    description: 'Sticky compound: noticeably more grip in bends, a little more friction and a slightly lower top speed.',
    roadGrip: 1.15, friction: 1.3, topSpeed: 0.98, offroadGrip: 0.2, offroadSpeed: 12.8, offroadDrag: 4, size: 1.0, clearance: 0,
  },
  grooved: {
    name: 'Grooved', fits: ['f1'],
    description: 'Treaded racing tyre: less grip on the road, but it copes better when you run onto the grass.',
    roadGrip: 0.9, friction: 1.0, topSpeed: 1.0, offroadGrip: 0.38, offroadSpeed: 16, offroadDrag: 3.5, size: 1.0, clearance: 0,
  },
  supercar: {
    name: 'Supercar', fits: ['neon'],
    description: 'The wide low-profile tyre the Neon car comes with: made for 220 mph on the road, poor on grass.',
    roadGrip: 1.0, friction: 1.0, topSpeed: 1.0, offroadGrip: 0.28, offroadSpeed: 12.8, offroadDrag: 4, size: 1.0, clearance: 0,
  },
  trackDay: {
    name: 'Track-day', fits: ['neon'],
    description: 'A sticky tyre for the Neon car: more grip in bends, a little more friction and a slightly lower top speed.',
    roadGrip: 1.15, friction: 1.3, topSpeed: 0.97, offroadGrip: 0.22, offroadSpeed: 12.8, offroadDrag: 4, size: 1.0, clearance: 0,
  },
};

// The tyre each kind of car starts with
export const DEFAULT_TYRE = { standard: 'street', f1: 'slick', neon: 'supercar' };

export function tyreFits(tyreId, carType) { return TYRES[tyreId].fits.includes(carType); }

// What a car with a given ride height and tyre can do. `base` is the car's entry in
// CAR_TYPES (car.js). Used by the driving physics and shown in the garage.
export function carSetup(base, tyreId) {
  const t = TYRES[tyreId];
  const clearance = base.clearance + t.clearance;                       // metres between the car's floor and the road
  const rideHeight = Math.min(1.3, Math.max(0.7, 0.7 + 1.9 * clearance)); // low cars drag their belly on grass
  return {
    tyre: tyreId,
    clearance,
    grip: base.grip * t.roadGrip,                 // m/s² sideways on the road
    drag: base.drag * t.friction,                 // m/s² rolling friction on the road
    maxSpeed: base.maxSpeed * t.topSpeed,         // m/s on the road
    grassGrip: t.offroadGrip,                     // fraction of road grip
    grassMaxSpeed: t.offroadSpeed * rideHeight,   // m/s on grass
    grassDrag: t.offroadDrag,
    bumpSafeSpeed: 4 + 45 * clearance,            // m/s: faster than this over a speed bump damages the car
    wheelSize: t.size,
  };
}
