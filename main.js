import * as THREE from 'three';
import { buildTrack } from './track.js';
import { buildModel, CarController, CAR_TYPES } from './car.js';
import { NeuralNet, AIDriver, SENSOR_ANGLES, LAYERS } from './ai.js';
import { collideCars } from './collision.js';
import { SkidMarks } from './skidmarks.js';
import { TYRES, DEFAULT_TYRE, tyreFits } from './tyres.js';
import { createGarage } from './garage.js';
import { buildStadium } from './stadium.js';
import { PitStop, PIT_TIMES } from './pitstop.js';
import { NIGHT, createNightSky, createTrackLighting } from './night.js';
import { Field, RaceCar, PlayerDriver, LapCounter, planAIs, raceNumbers, playerGridPlace } from './field.js';
import { OvalDriver } from './ovaldriver.js';
import { makeLivery } from './livery.js';

// ---------- Scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.autoUpdate = false;   // shadows are worked out once per frame (see the loop), not once per camera
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ec9ff);

const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(80, 140, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -160, right: 160, top: 160, bottom: -160, near: 10, far: 450 });
const ambient = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(sun, sun.target, ambient);
const SUN_FROM = new THREE.Vector3(80, 140, 60);   // where the daylight comes from
const lightFrom = SUN_FROM.clone();                // ...and the light now: the sun by day, the moon at night
const nightSky = createNightSky();
scene.add(nightSky.group);
let night = false;                                 // day or night (N, or the menu)
let trackLighting = null;                          // the stadium's lights at night; made with the stadium

const track = buildTrack({ anisotropy: renderer.capabilities.getMaxAnisotropy() });
scene.add(track.group);

const skidMarks = new SkidMarks();
scene.add(skidMarks.mesh);

// ---------- Your car (standard, F1-style or Neon) and its tyres; chosen in the garage ----------
const PLAYER_COLORS = { standard: 0xe0342c, f1: 0xff6a00, neon: 0x2a2e48 };
// The garage remembers which car you drive and which tyres are on each car
const SAVE_KEY = 'car-game-garage';
const saved = (() => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) ?? {}; } catch { return {}; } })();
const tyresByCar = { ...DEFAULT_TYRE };
for (const [type, tyre] of Object.entries(saved.tyresByCar ?? {})) if (Object.hasOwn(CAR_TYPES, type) && Object.hasOwn(TYRES, tyre) && tyreFits(tyre, type)) tyresByCar[type] = tyre;
const firstType = typeof saved.carType === 'string' && Object.hasOwn(CAR_TYPES, saved.carType) ? saved.carType : 'standard';

const carNumber = 1 + Math.floor(Math.random() * 99);   // your car's race number (1-99), painted on the car and shown on the tower
const playerLivery = makeLivery(0, carNumber);
let carMesh = buildModel(firstType, PLAYER_COLORS[firstType], { wheelSize: TYRES[tyresByCar[firstType]].size, livery: playerLivery });
scene.add(carMesh);
const car = new CarController(carMesh, track, { lane: -3.5, type: firstType, tyre: tyresByCar[firstType] });   // you start in the left lane

// Give the player another car and/or other tyres (rebuilds the 3D model to match)
function setPlayerCar(type, tyre = tyresByCar[type]) {
  if (pitStop.active && !pitSwapping) cancelPitStop();        // changing car in the garage during a stop ends the stop
  tyresByCar[type] = tyre;
  scene.remove(carMesh);
  carMesh.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });   // free the old model
  carMesh = buildModel(type, PLAYER_COLORS[type], { wheelSize: TYRES[tyre].size, livery: playerLivery });
  scene.add(carMesh);
  car.setType(type, tyre, carMesh);
  if (playerCar) playerCar.mesh = carMesh;
  car.apply();
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ carType: type, tyresByCar })); } catch { /* private mode: just don't remember */ }
  updateCarLabels();
}
function updateCarLabels() {
  const text = CAR_TYPES[car.type].name + ' car, ' + TYRES[car.tyre].name + ' tyres';
  document.getElementById('btn-garage').textContent = document.getElementById('btn-garage').disabled ? 'Garage: closed during the race' : 'Garage (' + text + ')';
  document.getElementById('tyre-name').textContent = text;
}
function switchCar() {
  const types = Object.keys(CAR_TYPES);
  setPlayerCar(types[(types.indexOf(car.type) + 1) % types.length]);
}

// ---------- AI car (blue, "AI" on the roof, driven by a neural network) ----------
const aiMesh = buildModel('standard', 0x2468d8, { label: 'AI' });
scene.add(aiMesh);
const aiCar = new CarController(aiMesh, track, { lane: 3.5 });    // AI starts in the right lane
let ai = null;            // AIDriver, once the trained network has loaded
let aiEnabled = true;
const aiStatus = { text: 'AI: loading…' };
fetch('./ai-weights.json', { cache: 'no-store' })
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((j) => {
    // a network trained for an older version of the game has the wrong number of inputs
    if (JSON.stringify(j.layers) !== JSON.stringify(LAYERS)) { aiStatus.text = 'AI: saved network is out of date (run node train.mjs)'; return; }
    ai = new AIDriver(aiCar, NeuralNet.fromJSON(j)); aiStatus.text = '';
  })
  .catch(() => { aiStatus.text = 'AI: no trained network found (run node train.mjs)'; });

// Sensor rays, drawn as lines from the AI car (toggle with V)
let showSensors = false;
const rayGeo = new THREE.BufferGeometry();
rayGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(SENSOR_ANGLES.length * 6), 3));
rayGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(SENSOR_ANGLES.length * 6), 3));
const rayLines = new THREE.LineSegments(rayGeo, new THREE.LineBasicMaterial({ vertexColors: true }));
rayLines.visible = false;
rayLines.frustumCulled = false;
scene.add(rayLines);
function updateRays() {
  if (!ai || !showSensors || !aiEnabled || venue !== 'circuit') { rayLines.visible = false; return; }
  rayLines.visible = true;
  const pos = rayGeo.attributes.position.array, col = rayGeo.attributes.color.array;
  SENSOR_ANGLES.forEach((a, k) => {
    const d = ai.rays[k], h = aiCar.heading + a;
    pos.set([aiCar.x, 1.6, aiCar.z, aiCar.x + Math.sin(h) * d, 1.6, aiCar.z + Math.cos(h) * d], k * 6);
    const c = new THREE.Color().setHSL((d / 40) * 0.33, 1, 0.5);   // red = edge is close, green = far
    col.set([c.r, c.g, c.b, c.r, c.g, c.b], k * 6);
  });
  rayGeo.attributes.position.needsUpdate = true;
  rayGeo.attributes.color.needsUpdate = true;
}

// ---------- Camera (top-down) ----------
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.6, 9000);
camera.up.set(0, 0, -1); // so "north" (-z) is up on screen
let cameraMode = 'follow'; // 'follow' (your car), 'follow-ai' (the AI car), 'overview' (whole track) or 'chase' (behind your car)
const FOLLOW_HEIGHT = 55;
const OVERVIEW_HEIGHT = 270;
const camTarget = new THREE.Vector3();

// Which view is showing. On the circuit: cameraMode. In the stadium: stadiumView.
let venue = 'circuit';                 // 'circuit' or 'stadium': which track you are on
let stadium = null;                    // built the first time it is shown
const STADIUM_VIEWS = { chase: 'behind your car (mouse look)', follow: 'above your car', heli: 'helicopter', orbit: 'free look', stand: 'from the grandstand', pit: 'pit lane', lamp: 'track light close-up' };
let stadiumView = 'chase';
const currentView = () => (venue === 'stadium' ? stadiumView : cameraMode);

// Mouse look. Behind the car (either track): drag to swing the camera round the car,
// wheel to move closer or further, double-click to go back behind the car. In the
// stadium's free look: drag to circle the stadium, wheel to zoom, Shift+drag to move.
const ORBIT_DEFAULT = { yaw: 0, pitch: 0.36, distance: 12 };   // yaw 0 = straight behind the car; angles in radians
const orbit = { ...ORBIT_DEFAULT };
const LOOK_DEFAULT = { yaw: 0.5, pitch: 0.5, distance: 1500, x: 0, z: 0 };
const look = { ...LOOK_DEFAULT };      // free look: the camera circles the point (x, 0, z) on the ground
const canvas = renderer.domElement;
let dragging = false;
const mouseTarget = () => (currentView() === 'chase' ? orbit : venue === 'stadium' && stadiumView === 'orbit' ? look : null);
const mouseLook = () => !paused && mouseTarget();
const mouseCursor = () => (mouseTarget() ? 'grab' : '');
canvas.addEventListener('pointerdown', (e) => {
  if (!mouseLook()) return;
  dragging = true;
  canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = 'grabbing';
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  if (mouseTarget() === look) {
    if (e.shiftKey || (e.buttons & 2)) {
      // Shift or the right button: slide the point the camera looks at across the ground
      const k = look.distance * 0.0016, c = Math.cos(look.yaw), s = Math.sin(look.yaw);
      look.x = THREE.MathUtils.clamp(look.x - (c * e.movementX + s * e.movementY) * k, -900, 900);
      look.z = THREE.MathUtils.clamp(look.z - (-s * e.movementX + c * e.movementY) * k, -550, 550);
    } else {
      look.yaw -= e.movementX * 0.005;
      look.pitch = THREE.MathUtils.clamp(look.pitch + e.movementY * 0.004, 0.05, 1.5);
    }
    return;
  }
  orbit.yaw -= e.movementX * 0.006;
  orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + e.movementY * 0.005, 0.04, 1.5);
});
const endDrag = () => { dragging = false; canvas.style.cursor = mouseCursor(); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => {
  if (!mouseLook()) return;
  e.preventDefault();
  if (mouseTarget() === look) look.distance = THREE.MathUtils.clamp(look.distance * Math.exp(e.deltaY * 0.0012), 10, 3200);
  else orbit.distance = THREE.MathUtils.clamp(orbit.distance * Math.exp(e.deltaY * 0.0012), 5, 45);
}, { passive: false });
canvas.addEventListener('dblclick', () => { if (mouseLook()) Object.assign(mouseTarget(), mouseTarget() === look ? LOOK_DEFAULT : ORBIT_DEFAULT); });
canvas.addEventListener('contextmenu', (e) => { if (mouseCursor()) e.preventDefault(); });

// ---------- The stadium: the 2-mile oval ----------
// The tower's big screens show what a second camera sees: a helicopter following your car.
const screenPicture = new THREE.WebGLRenderTarget(640, 360);
const heliCam = new THREE.PerspectiveCamera(22, 16 / 9, 1, 6000);   // a long lens: the car fills a good part of the picture
const heliSpot = new THREE.Vector3();
let heliJump = true;
function updateHelicopter(dt) {
  // above, behind and to one side of the car, looking down at it
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  heliSpot.set(car.x - fx * 26 + fz * 20, car.altitude + 28, car.z - fz * 26 - fx * 20);
  if (heliJump || heliCam.position.distanceTo(heliSpot) > 400) { heliCam.position.copy(heliSpot); heliJump = false; }   // the car was put somewhere else: go straight there
  else heliCam.position.lerp(heliSpot, 1 - Math.exp(-2.5 * dt));
  heliCam.lookAt(car.x + fx * 6, car.altitude + 1, car.z + fz * 6);
}

// Laps and the running order in the stadium: see field.js (LapCounter, Field). Every car,
// yours included, is a RaceCar built from parts: a driver (your keys, or the AI in
// ovaldriver.js) and a lap counter. The race clock starts at the green light; the first lap is
// timed from the green light too (the cars start a few metres behind the line).
const FIELD_SIZE = 43;                 // cars in a stadium race, you included
let field = null, playerCar = null;    // made with the stadium
const playerLaps = () => playerCar.get('laps');
const lapNumber = () => Math.min(raceControl.laps, Math.max(1, playerLaps().lap + 1));
let boardAge = 99;
const clock = (t) => (t === null ? '-:--.-' : Math.floor(t / 60) + ':' + (t % 60).toFixed(1).padStart(4, '0'));
const ordinal = (n) => { const r = n % 100; return n + (r >= 11 && r <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'); };
function updateBoard(dt) {
  boardAge += dt;
  if (boardAge < 0.5) return;                                // redraw the scoreboard twice a second
  boardAge = 0;
  const lap = raceControl.phase === 'setup' || raceControl.phase === 'lights' ? 0 : raceControl.phase === 'finished' ? raceControl.laps : lapNumber();
  const order = raceControl.phase === 'setup' || raceControl.phase === 'lights' ? gridOrder.map((c) => c.number) : field.standings().map((c) => c.number);
  stadium.setBoard({ lap: lap + '/' + raceControl.laps, order });
}

// The 42 other cars: each its own kind of car, tyres, driving style, colours and number
let gridOrder = [];                    // the cars in grid order (pole first) for the race being set up
function buildField() {
  field = new Field(stadium);
  playerCar = field.add(new RaceCar({ number: carNumber, controller: car, livery: playerLivery, isPlayer: true }));
  playerCar.attach(new PlayerDriver(input, { busy: () => pitStop.active })).attach(new LapCounter());
  playerCar.on('finish', () => finishRace());
  const plans = planAIs(FIELD_SIZE - 1, raceNumbers(FIELD_SIZE - 1, carNumber));
  plans.forEach((plan, k) => {
    const livery = makeLivery(k + 1, plan.number);
    const mesh = buildModel(plan.type, undefined, { livery, wheelSize: TYRES[plan.tyre].size });
    mesh.userData.shadowParts = []; mesh.traverse((o) => { if (o.castShadow) mesh.userData.shadowParts.push(o); });
    stadium.group.add(mesh);
    const ai = field.add(new RaceCar({ number: plan.number, type: plan.type, tyre: plan.tyre, track: stadium, mesh, livery }));
    ai.attach(new OvalDriver(plan.style)).attach(new LapCounter());
  });
}
// Everybody onto the grid: you last, or somewhere in the last 30% (decided afresh each time)
function gridUp() {
  const place = playerGridPlace(FIELD_SIZE), places = [];
  let next = 1;
  for (const c of field.cars) { if (c.isPlayer) places.push(place); else { if (next === place) next++; places.push(next++); } }
  field.toGrid(places);
  field.hold(true);
  gridOrder = field.cars.map((c, k) => [places[k], c]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  raceControl.gridPlace = place;
}
// Only the cars near you cast shadows (43 cars' shadows would be too slow to draw)
function budgetShadows() {
  for (const c of field.ais) {
    const near = (c.x - car.x) ** 2 + (c.z - car.z) ** 2 < 160 * 160;
    if (near === c.mesh.userData.shadowOn) continue;
    c.mesh.userData.shadowOn = near;
    for (const part of c.mesh.userData.shadowParts) part.castShadow = near;
  }
}

// The sun's shadows are sharp only near what you are looking at: the shadow area follows it
const sunReach = { value: 160 };
function aimSun(x, z, reach) {
  const k = reach / 160, gx = Math.round(x / 8) * 8, gz = Math.round(z / 8) * 8;
  sun.target.position.set(gx, 0, gz);
  sun.position.set(gx + lightFrom.x * k, lightFrom.y * k, gz + lightFrom.z * k);
  if (reach !== sunReach.value) {
    sunReach.value = reach;
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 10, far: 450 * k });
    sun.shadow.camera.updateProjectionMatrix();
    // a small offset, about half a shadow-map dot, stops striped shadows on the stadium's big
    // flat walls without lifting the cars' own shadows off the ground
    sun.shadow.normalBias = venue === 'stadium' ? (0.6 * 2 * reach) / 4096 : 0;
  }
}

function setVenue(next) {
  venue = next;
  const circuit = venue === 'circuit';
  if (!circuit && !stadium) { stadium = buildStadium({ anisotropy: renderer.capabilities.getMaxAnisotropy(), screen: screenPicture.texture }); scene.add(stadium.group); markMyBox(); trackLighting = createTrackLighting(stadium); stadium.group.add(trackLighting.group); buildField(); }
  track.group.visible = circuit;
  aiMesh.visible = circuit && aiEnabled;
  if (stadium) stadium.group.visible = !circuit;
  // put your car on the new track's start line
  car.track = circuit ? track : stadium;
  toStartLine();
  sun.shadow.bias = circuit ? 0 : -0.0003;
  applyDayOrNight();
  for (const k in input) input[k] = false;
  dragging = false;
  document.getElementById('lap-line').style.display = circuit ? 'none' : '';
  document.getElementById('ai-info').style.display = circuit ? '' : 'none';
  for (const id of ['btn-ai', 'btn-sensors']) document.getElementById(id).style.display = circuit ? '' : 'none';
  document.getElementById('menu-text').innerHTML = circuit
    ? 'Drive your car around the loop — the blue one is driven by a neural network.<br>Turn too hard for your speed and you skid. Slow down for the speed bumps.'
    : 'Race round the 2-mile stadium oval: choose how many laps, wait for the lights, go.<br>The tower in the middle shows you from a helicopter. The outer wall is solid.';
  updateCameraLabel();
  canvas.style.cursor = mouseCursor();
  if (circuit) closeRacePanels(); else enterRaceSetup();     // the stadium always begins with choosing a race
  updateMenuButtons();
}
// Day or night. At night the sky is black with a few stars and a moon, the only light
// everywhere is weak blue moonlight, and in the stadium the track lights and pit lights are on.
const dimmed = new Map();      // things that glow by themselves on the circuit (the start line), toned down at night
function applyDayOrNight() {
  const circuit = venue === 'circuit';
  scene.background.set(night ? NIGHT.sky : 0x9ec9ff);
  sun.color.set(night ? NIGHT.moonlight : 0xffffff);
  sun.intensity = night ? (circuit ? 0.6 : 0.32) : 2.2;       // the circuit has no lamps, so its moon is brighter
  ambient.color.set(night ? 0x7088cc : 0xffffff);
  ambient.intensity = night ? (circuit ? 0.22 : 0.13) : 0.8;
  sun.castShadow = !night || circuit;                         // in the stadium at night the shadows come from the lamps; the weak moon casts none
  if (night) lightFrom.copy(nightSky.lightDirection).multiplyScalar(SUN_FROM.length()); else lightFrom.copy(SUN_FROM);
  nightSky.group.visible = night;
  if (trackLighting) trackLighting.setOn(night);
  track.group.traverse((o) => {
    const mat = o.material;
    if (!mat?.isMeshBasicMaterial) return;
    if (!dimmed.has(mat)) dimmed.set(mat, mat.color.clone());
    mat.color.copy(dimmed.get(mat)).multiplyScalar(night ? 0.18 : 1);
  });
  sunReach.value = -1;                              // make aimSun set the shadow area up afresh
  if (circuit) aimSun(0, 0, 160);
  document.getElementById('btn-night').textContent = night ? 'Time: night' : 'Time: day';
}
function setNight(on) {
  night = on;
  applyDayOrNight();
  try { localStorage.setItem('car-game-night', night ? '1' : ''); } catch { /* private mode: just don't remember */ }
}
function toggleNight() { setNight(!night); }
// Your car (and on the circuit the AI car) back to the start, standing still
function toStartLine() {
  cancelPitStop();
  if (venue === 'stadium') {
    gridUp();
    heliJump = true;
  } else {
    car.reset(); aiCar.reset();
    if (ai) ai.resetProgress();
  }
  skidMarks.clear();
}

function updateStadiumCamera(dt) {
  const half = stadium.width / 2;
  camera.up.set(0, 1, 0);
  if (stadiumView === 'heli') {
    camera.position.copy(heliCam.position);
    camera.quaternion.copy(heliCam.quaternion);
  } else if (stadiumView === 'orbit') {
    const flat = look.distance * Math.cos(look.pitch);
    camTarget.set(look.x + Math.sin(look.yaw) * flat, look.distance * Math.sin(look.pitch), look.z + Math.cos(look.yaw) * flat);
    camTarget.y = Math.max(camTarget.y, stadium.topAt(camTarget.x, camTarget.z) + 2.5);   // never under the road or inside the stands
    camera.position.lerp(camTarget, 1 - Math.exp(-12 * dt));
    camera.position.y = Math.max(camera.position.y, stadium.topAt(camera.position.x, camera.position.z) + 1.5);
    camera.lookAt(look.x, 0, look.z);
  } else if (stadiumView === 'stand') {
    // The top row of the stand by the start line, watching your car
    const c = stadium.centreAt(-60), d = half + 41;
    camera.position.set(c.x + c.nx * d, stadium.outerHeightAt(-60) + 25, c.z + c.nz * d);
    camera.lookAt(car.x, car.altitude + 1, car.z);
  } else if (stadiumView === 'lamp') {
    // Standing on the track a little way from one of the track lights, looking up at it
    const lamp = stadium.lights[1];
    camera.position.copy(stadium.pointAt(lamp.s - 9, 3.5, 2.2));
    camera.lookAt(lamp.lampX, lamp.lampY - 2.2, lamp.lampZ);
  } else {
    // Above the pit entry, looking down the pit lane towards your box
    camera.position.copy(stadium.pointAt(-330, -23, 12));
    camera.lookAt(stadium.pointAt(-215, -35, 0));
  }
}

function updateCamera(dt) {
  const view = currentView();
  // far things need a far-reaching camera; close-up views need a near one
  const near = view === 'orbit' && look.distance > 400 ? 4 : 0.6, fov = view === 'heli' ? heliCam.fov : 50;   // the helicopter uses a long lens
  if (camera.near !== near || camera.fov !== fov) { camera.near = near; camera.fov = fov; camera.updateProjectionMatrix(); }
  if (view === 'chase') {
    // Third-person camera that travels with your car. It sits on a ball round the car:
    // orbit.yaw turns it sideways from "straight behind", orbit.pitch lifts it.
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const around = car.heading + Math.PI + orbit.yaw;               // direction from the car to the camera
    const flat = orbit.distance * Math.cos(orbit.pitch);
    camTarget.set(car.x + Math.sin(around) * flat, car.altitude + 1 + orbit.distance * Math.sin(orbit.pitch), car.z + Math.cos(around) * flat);
    camera.position.lerp(camTarget, 1 - Math.exp(-(dragging ? 25 : 7) * dt));
    camera.up.set(0, 1, 0);
    const lead = 6 * Math.max(0, Math.cos(orbit.yaw)) * Math.cos(orbit.pitch);   // from behind, look a little ahead of the car
    camera.lookAt(car.x + fx * lead, car.altitude + 1, car.z + fz * lead);
    return;
  }
  if (venue === 'stadium' && view !== 'follow') return updateStadiumCamera(dt);
  camera.up.set(0, 0, -1);   // top-down: "north" (-z) is up on screen
  if (view === 'overview') {
    camTarget.set(0, OVERVIEW_HEIGHT, 0.001);
  } else {
    // Follow a car: look a little ahead of it and rise higher the faster it goes
    const c = view === 'follow-ai' && aiEnabled ? aiCar : car;
    const speed = Math.hypot(c.vx, c.vz);
    camTarget.set(c.x + c.vx * 0.35, c.altitude + FOLLOW_HEIGHT + speed * 0.6, c.z + c.vz * 0.35);
  }
  camera.position.lerp(camTarget, 1 - Math.exp(-5 * dt));
  camera.lookAt(camera.position.x, 0, camera.position.z - 0.001);
}
camera.position.set(car.x, FOLLOW_HEIGHT, car.z);

// ---------- Input ----------
const input = { forward: false, backward: false, left: false, right: false, handbrake: false };
const keyMap = { KeyW: 'forward', ArrowUp: 'forward', KeyS: 'backward', ArrowDown: 'backward',
                 KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'handbrake' };
window.addEventListener('keydown', (e) => {
  if (!startScreen.classList.contains('hidden')) return;                                   // the first screen is mouse only
  if (controlsOpen) { if (e.code === 'Escape' && !e.repeat) closeControls(); return; }   // the Controls screen only listens for Esc
  if (racePanelOpen()) { if (e.code === 'Escape' && !e.repeat) { closeRacePanels(); showMenu(true); } return; }   // so is the race setup (its number box needs the keys)
  if (keyMap[e.code]) { if (!paused) { input[keyMap[e.code]] = true; e.preventDefault(); } }   // in the menu, Space/arrows keep their normal job
  else if (e.repeat) return;
  else if (e.code === 'Escape') toggleMenu();
  else if (e.code === 'KeyN') toggleNight();
  else if (venue === 'stadium' && ['KeyI', 'KeyV'].includes(e.code)) return;   // the AI car is not in the stadium yet
  else if (e.code === 'KeyC') toggleCamera();
  else if (e.code === 'KeyI') toggleAI();
  else if (e.code === 'KeyV') toggleSensors();
  else if (e.code === 'KeyF') { if (!raceLocked()) switchCar(); }
  else if (e.code === 'KeyG') { if (!raceLocked()) openGarage(); }
  else if (e.code === 'KeyH') openControls();
  else if (/^Digit[1-9]$/.test(e.code)) choosePitTyre(Number(e.code.slice(5)));
});
window.addEventListener('keyup', (e) => { if (keyMap[e.code]) input[keyMap[e.code]] = false; });
window.addEventListener('blur', () => { for (const k in input) input[k] = false; });

// ---------- Menu ----------
const menu = document.getElementById('menu');
let paused = true;
// The first screen asks which track; "Change track" in the menu switches later (there is no key for it)
const startScreen = document.getElementById('start-screen');
function chooseTrack(which) {
  startScreen.classList.add('hidden');
  setVenue(which);
  if (which === 'circuit') showMenu(true);
}
document.getElementById('start-circuit').addEventListener('click', () => chooseTrack('circuit'));
document.getElementById('start-stadium').addEventListener('click', () => chooseTrack('stadium'));
document.getElementById('btn-track').addEventListener('click', () => chooseTrack(venue === 'circuit' ? 'stadium' : 'circuit'));
menu.classList.add('hidden');
function showMenu(show) {
  paused = show;
  menu.classList.toggle('hidden', !show);
  for (const k in input) input[k] = false;
  if (!show) document.activeElement?.blur();   // so Space and Enter drive the car, not the button that was clicked
}
// (in the stadium before a race, "carrying on" means choosing the race)
function toggleMenu() { if (paused && venue === 'stadium' && raceControl.phase === 'setup') openRaceSetup(); else showMenu(!paused); }
function toggleAI() {
  aiEnabled = !aiEnabled;
  aiMesh.visible = aiEnabled && venue === 'circuit';
  document.getElementById('btn-ai').textContent = 'AI car: ' + (aiEnabled ? 'on' : 'off');
}
function toggleSensors() {
  showSensors = !showSensors;
  document.getElementById('btn-sensors').textContent = 'AI sensors: ' + (showSensors ? 'shown' : 'hidden');
}
function toggleCamera() {
  if (venue === 'stadium') {
    const views = Object.keys(STADIUM_VIEWS);
    stadiumView = views[(views.indexOf(stadiumView) + 1) % views.length];
  } else {
    const modes = ['follow', 'follow-ai', 'overview', 'chase'];
    cameraMode = modes[(modes.indexOf(cameraMode) + 1) % modes.length];
  }
  updateCameraLabel();
  canvas.style.cursor = mouseCursor();
  dragging = false;
}
function updateCameraLabel() {
  const help = { chase: 'drag to look round the car, wheel to zoom, double-click to reset', follow: '', heli: 'the picture shown on the tower\'s screens', orbit: 'drag to look round, wheel to zoom, Shift+drag to move, double-click to reset', stand: 'the top row by the start line, watching your car', pit: 'looking down the pit lane from its entry', lamp: 'one of the lights along the outside of the track' };
  const name = venue === 'stadium' ? STADIUM_VIEWS[stadiumView]
    : { follow: 'follow your car', 'follow-ai': 'follow AI car', overview: 'whole track', chase: 'behind your car (3D, mouse look)' }[cameraMode];
  document.getElementById('btn-camera').textContent = 'Camera: ' + name;
  const box = document.getElementById('view-info');
  box.style.display = venue === 'stadium' ? '' : 'none';
  box.textContent = 'View: ' + name + (help[stadiumView] ? ' — ' + help[stadiumView] : '');
}
// ---------- Garage (choose car and tyres, repair) ----------
const garage = createGarage({
  getState: () => ({ carType: car.type, tyre: car.tyre, damage: car.damage, tyresByCar: { ...tyresByCar } }),
  onSelectCar: (type) => setPlayerCar(type),
  onSelectTyre: (tyre) => { if (tyreFits(tyre, car.type)) setPlayerCar(car.type, tyre); },
  onRepair: () => car.repair(),
  onClose: () => { if (garageFromSetup) { garageFromSetup = false; openRaceSetup(); } else showMenu(true); },
});
let garageFromSetup = false;    // the garage was opened from the race setup: go back there afterwards
function openGarage() { if (raceLocked()) return; showMenu(true); menu.classList.add('hidden'); garage.open(); }   // the game stays paused behind it
document.getElementById('btn-garage').addEventListener('click', openGarage);

// ---------- Controls screen (the list of every key and mouse control) ----------
const controlsScreen = document.getElementById('controls');
let controlsOpen = false;
function openControls() { showMenu(true); menu.classList.add('hidden'); controlsScreen.classList.remove('hidden'); controlsOpen = true; }
function closeControls() { controlsScreen.classList.add('hidden'); controlsOpen = false; showMenu(true); }
document.getElementById('btn-controls').addEventListener('click', openControls);
document.getElementById('btn-controls-back').addEventListener('click', closeControls);
document.getElementById('btn-resume').addEventListener('click', () => { if (venue === 'stadium' && raceControl.phase === 'setup') openRaceSetup(); else showMenu(false); });
document.getElementById('btn-night').addEventListener('click', toggleNight);
document.getElementById('btn-camera').addEventListener('click', toggleCamera);
document.getElementById('btn-ai').addEventListener('click', toggleAI);
document.getElementById('btn-sensors').addEventListener('click', toggleSensors);

// ---------- Pit stops (stadium) ----------
// Your box is box 1, the first one after the pit entry. Stop in it (below 4 km/h) and
// the crew takes over: jacks, four wheels off, four new ones on, GO. While the old
// wheels come off you can pick which tyres go on with the number keys.
const pitStop = new PitStop(scene);
let pitSwapping = false;        // true while the pit stop itself is swapping the car's model
let pitArmed = true;            // a new stop can start (the car has left the box since the last one)
let pitTyre = null;             // the tyres chosen for this stop
let pitMessageTime = 0;
const pitPanel = document.getElementById('pit-panel');
const myBox = () => stadium.pit.boxes[0];
const pitTyreChoices = () => Object.keys(TYRES).filter((id) => tyreFits(id, car.type));
function checkPitStop() {
  const box = myBox(), p = stadium.locate(car.x, car.z), L = stadium.length;
  let along = p.s - box.s; along -= Math.round(along / L) * L;
  const inBox = Math.abs(along) < 4.5 && p.d < stadium.pit.boxOuter + 0.8 && p.d > stadium.pit.boxInner + 0.8;
  if (!inBox) { if (Math.abs(along) > 8 || p.d > stadium.pit.boxOuter + 3) pitArmed = true; return; }
  if (!pitArmed || car.kmh > 4) return;
  pitArmed = false;
  pitTyre = car.tyre;
  pitStop.begin(car, { x: box.x, z: box.z, heading: box.heading }, () => {
    pitSwapping = true;
    setPlayerCar(car.type, pitTyre);      // the car's model with the new tyres
    pitSwapping = false;
  });
}
function cancelPitStop() { pitStop.cancel(); pitArmed = true; pitPanel.style.display = 'none'; }
function choosePitTyre(n) {
  const choices = pitTyreChoices();
  if (pitStop.active && pitStop.time < PIT_TIMES.carry && choices[n - 1]) pitTyre = choices[n - 1];
}
function updatePitPanel(dt) {
  if (!pitStop.active) {
    pitMessageTime = pitStop.done ? pitMessageTime + dt : 99;
    if (pitStop.done && pitMessageTime < 1.5) { pitPanel.style.display = ''; pitPanel.innerHTML = '<b style="font-size:30px; color:#5fd068">GO!</b><br>New ' + TYRES[car.tyre].name + ' tyres'; }
    else pitPanel.style.display = 'none';
    return;
  }
  pitMessageTime = 0;
  const P = PIT_TIMES, t = pitStop.time;
  const stage = t < P.settle ? 'Stopping on the mark' : t < P.jackUp ? 'Jacking the car up' : t < P.unbolt ? 'Undoing the wheels'
    : t < P.carry ? 'Old wheels off' : t < P.fetch ? 'New wheels coming' : t < P.bolt ? 'Fitting the new wheels' : t < P.jackDown ? 'Letting the car down' : 'Go!';
  const choosing = t < P.carry;
  const options = pitTyreChoices().map((id, k) => (id === pitTyre ? '<b style="color:#ffd23f">[' + (k + 1) + '] ' + TYRES[id].name + '</b>' : '[' + (k + 1) + '] ' + TYRES[id].name)).join(' &nbsp; ');
  pitPanel.style.display = '';
  pitPanel.innerHTML = '<b style="font-size:20px">PIT STOP</b> &nbsp; ' + stage + ' &nbsp; <span style="color:#9cc4ff">' + Math.max(0, P.go - t).toFixed(1) + ' s</span><br>'
    + (choosing ? 'New tyres (press a number): ' + options : 'Fitting: ' + TYRES[pitTyre].name + ' tyres') + '<br><span style="color:#aaa">The crew has the car: your keys do nothing until GO</span>';
}

// A yellow frame round your box and a sign above it
let boxMarker = null;
function markMyBox() {
  const box = myBox(), c = stadium.centreAt(box.s), half = stadium.pit.boxLength / 2 - 0.3;
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
  boxMarker = new THREE.Group();
  const d0 = stadium.pit.boxOuter - 0.3, d1 = stadium.pit.boxInner + 0.3, dMid = (d0 + d1) / 2;
  const bar = (along, across, lengthAlong, lengthAcross) => {
    const p = stadium.pointAt(box.s + along, across, 0.08);
    const m = new THREE.Mesh(new THREE.BoxGeometry(lengthAcross, 0.04, lengthAlong), mat);
    m.position.copy(p); m.rotation.y = Math.atan2(c.tx, c.tz); boxMarker.add(m);
  };
  bar(-half, dMid, 0.3, d0 - d1); bar(half, dMid, 0.3, d0 - d1); bar(0, d0, 2 * half, 0.3); bar(0, d1, 2 * half, 0.3);
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = 'rgba(20,22,26,0.85)'; g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#ffd23f'; g.font = 'bold 52px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('YOUR BOX · CAR ' + carNumber, 256, 66);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }));
  const top = stadium.pointAt(box.s, dMid, 5.5);
  sign.position.copy(top); sign.scale.set(8, 2, 1);
  boxMarker.add(sign);
  stadium.group.add(boxMarker);
}

// ---------- Races (stadium) ----------
// Before every race you choose its length; the car waits on pole position while three
// red lights come on one by one, then all three turn green and the race is on. There is
// no reset during a race: the way out is to retire (menu) or to finish.
const RACES = { sprint: { name: 'Sprint', laps: 5 }, championship: { name: 'Championship', laps: 10 }, endurance: { name: 'Endurance', laps: 20 } };
const MAX_LAPS = 200;
const START = { firstRed: 0.8, between: 1.0, holdMin: 0.6, holdMax: 1.6, greenShown: 1.6 };   // seconds: the reds come on 1 s apart, then a short random wait before green
const RACE_KEY = 'car-game-race';
const savedRace = (() => { try { return JSON.parse(localStorage.getItem(RACE_KEY)) ?? {}; } catch { return {}; } })();
const raceControl = {
  phase: 'setup',           // 'setup' (choosing), 'lights' (on the grid, lights coming on), 'racing', 'finished'
  kind: Object.hasOwn(RACES, savedRace.kind) || savedRace.kind === 'custom' ? savedRace.kind : 'sprint',
  custom: Number.isInteger(savedRace.custom) && savedRace.custom >= 1 && savedRace.custom <= MAX_LAPS ? savedRace.custom : 50,
  laps: 5,                  // laps in this race
  clock: 0,                 // seconds since the lights sequence began
  hold: 1,                  // the random wait between the third red and green
  greenAge: 99,             // seconds since green (the green lights and "GO!" show for a moment)
  finishTime: null,
};
const raceLocked = () => venue === 'stadium' && (raceControl.phase === 'lights' || raceControl.phase === 'racing');   // no garage or car change now
const raceName = () => (raceControl.kind === 'custom' ? 'Custom race' : RACES[raceControl.kind].name) + ', ' + raceControl.laps + (raceControl.laps === 1 ? ' lap' : ' laps');

const setupPanel = document.getElementById('race-setup'), resultsPanel = document.getElementById('race-results'), lightsPanel = document.getElementById('start-lights');
const customInput = document.getElementById('race-custom-laps');
const racePanelOpen = () => !setupPanel.classList.contains('hidden') || !resultsPanel.classList.contains('hidden');
function closeRacePanels() { setupPanel.classList.add('hidden'); resultsPanel.classList.add('hidden'); }

// The stadium's starting state: your car on pole, standing, the lights off, the setup open
function enterRaceSetup() {
  raceControl.phase = 'setup';
  toStartLine();
  stadium.setStartLights(0);
  updateMenuButtons();
  lightsPanel.style.display = 'none';
  openRaceSetup();
}
function openRaceSetup() {
  showMenu(true); menu.classList.add('hidden'); resultsPanel.classList.add('hidden');
  setupPanel.classList.remove('hidden');
  customInput.value = raceControl.custom;
  drawRaceSetup();
}
// Which race is chosen, and is the custom number valid?
function customLaps() {
  const text = customInput.value.trim(), n = Number(text);
  return /^\d+$/.test(text) && n >= 1 && n <= MAX_LAPS ? n : null;
}
function chosenLaps() { return raceControl.kind === 'custom' ? customLaps() : RACES[raceControl.kind].laps; }
function drawRaceSetup() {
  for (const el of setupPanel.querySelectorAll('[data-race]')) el.classList.toggle('chosen', el.dataset.race === raceControl.kind);
  const laps = chosenLaps(), start = document.getElementById('race-start');
  start.disabled = laps === null;
  start.textContent = laps === null ? 'Start race' : 'Start race: ' + laps + (laps === 1 ? ' lap' : ' laps');
  document.getElementById('race-custom-error').style.visibility = raceControl.kind === 'custom' && laps === null ? 'visible' : 'hidden';
  document.getElementById('race-car').textContent = CAR_TYPES[car.type].name + ' car, ' + TYRES[car.tyre].name + ' tyres';
}
for (const el of setupPanel.querySelectorAll('[data-race]')) el.addEventListener('click', () => { raceControl.kind = el.dataset.race; drawRaceSetup(); if (el.dataset.race === 'custom') customInput.focus(); });
customInput.addEventListener('input', () => { raceControl.kind = 'custom'; drawRaceSetup(); });
customInput.addEventListener('focus', () => { raceControl.kind = 'custom'; drawRaceSetup(); });
customInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); startRace(); } });
document.getElementById('race-start').addEventListener('click', () => startRace());
document.getElementById('race-garage').addEventListener('click', () => { closeRacePanels(); garageFromSetup = true; openGarage(); });
document.getElementById('race-back').addEventListener('click', () => { closeRacePanels(); showMenu(true); });

// Off to the grid: the lights sequence begins
function startRace(laps = chosenLaps()) {
  if (!Number.isInteger(laps) || laps < 1 || laps > MAX_LAPS) return;
  raceControl.laps = laps;
  if (raceControl.kind === 'custom') raceControl.custom = laps;
  try { localStorage.setItem(RACE_KEY, JSON.stringify({ kind: raceControl.kind, custom: raceControl.custom })); } catch { /* private mode */ }
  toStartLine();
  Object.assign(raceControl, { phase: 'lights', clock: 0, hold: START.holdMin + Math.random() * (START.holdMax - START.holdMin), greenAge: 99, lapTimes: [], finishTime: null });
  closeRacePanels();
  updateMenuButtons();
  showMenu(false);
}
const redsLit = () => (raceControl.phase !== 'lights' ? 0 : Math.max(0, Math.min(3, Math.floor((raceControl.clock - START.firstRed) / START.between) + 1)));
// One physics step while the car waits on the grid
function runStart(dt) {
  if (raceControl.phase !== 'lights') return;
  raceControl.clock += dt;
  if (raceControl.clock >= START.firstRed + 2 * START.between + raceControl.hold) {   // the third red, then a random wait: GREEN
    raceControl.phase = 'racing';
    raceControl.greenAge = 0;
    field.hold(false); field.startTiming(raceControl.laps);        // the race clock starts now
    updateMenuButtons();
  }
}
// The three big lights on screen and the three on the gantry
const lampEls = [...lightsPanel.querySelectorAll('.lamp')];
function updateStartLights(dt) {
  const phase = raceControl.phase;
  if (phase === 'racing') raceControl.greenAge += dt;
  const green = phase === 'racing' && raceControl.greenAge < START.greenShown;
  const reds = redsLit();
  stadium.setStartLights(reds, green);
  if (phase === 'lights' || green) {
    lightsPanel.style.display = '';
    lampEls.forEach((el, k) => { el.className = 'lamp' + (green ? ' green' : k < reds ? ' red' : ''); });
    document.getElementById('start-text').textContent = green ? 'GO!' : reds === 3 ? 'Wait for green…' : 'Get ready';
    document.getElementById('start-text').className = green ? 'go' : '';
  } else lightsPanel.style.display = 'none';
}

// The chequered flag: the results, then race again or choose another race
function finishRace() {
  raceControl.phase = 'finished';
  raceControl.finishTime = playerLaps().finishTime;
  raceControl.finishPosition = field.finishOrder.indexOf(playerCar) + 1;
  updateMenuButtons();
  setTimeout(showResults, 2500);                                   // let the car cross the line first
}
function showResults() {
  if (venue !== 'stadium' || raceControl.phase !== 'finished' || racePanelOpen()) return;
  const times = playerLaps().lapTimes, best = Math.min(...times), bestLap = times.indexOf(best) + 1;
  document.getElementById('results-title').textContent = ordinal(raceControl.finishPosition) + ' of ' + FIELD_SIZE + ' — ' + raceName();
  document.getElementById('results-summary').innerHTML =
    'Race time <b>' + clock(raceControl.finishTime) + '</b> &nbsp;·&nbsp; best lap <b>' + clock(best) + '</b> (lap ' + bestLap + ')' +
    ' &nbsp;·&nbsp; average lap <b>' + clock(raceControl.finishTime / times.length) + '</b>';
  document.getElementById('results-laps').innerHTML = times.map((t, k) =>
    '<tr' + (k + 1 === bestLap ? ' class="best"' : '') + '><td>Lap ' + (k + 1) + '</td><td>' + clock(t) + '</td></tr>').join('');
  document.getElementById('results-again').textContent = 'Race again (' + raceControl.laps + (raceControl.laps === 1 ? ' lap)' : ' laps)');
  showMenu(true); menu.classList.add('hidden');
  resultsPanel.classList.remove('hidden');
}
document.getElementById('results-again').addEventListener('click', () => startRace(raceControl.laps));
document.getElementById('results-new').addEventListener('click', () => enterRaceSetup());
document.getElementById('results-drive').addEventListener('click', () => { closeRacePanels(); showMenu(false); });

// The menu's race button: retire from a race, or start a new one after finishing
function updateMenuButtons() {
  const btn = document.getElementById('btn-race'), phase = raceControl.phase;
  btn.style.display = venue === 'stadium' && phase !== 'setup' ? '' : 'none';
  btn.textContent = phase === 'finished' ? 'New race (choose laps)' : 'Retire from the race (choose a new one)';
  document.getElementById('btn-resume').textContent = venue === 'stadium' && phase === 'setup' ? 'Choose a race' : 'Drive';
  document.getElementById('btn-track').textContent = venue === 'circuit' ? 'Change track: to the stadium (43-car race)'
    : raceLocked() ? 'Change track: to the circuit (ends this race)' : 'Change track: to the circuit';
  const locked = raceLocked();
  document.getElementById('btn-garage').disabled = locked;
  document.getElementById('btn-garage').title = locked ? 'The garage is closed during a race' : '';
  updateCarLabels();
}
document.getElementById('btn-race').addEventListener('click', () => enterRaceSetup());

// The race line on the HUD
function raceLine() {
  const c = raceControl, head = 'Car ' + carNumber + ' · ';
  if (c.phase === 'setup') return head + 'grid place ' + c.gridPlace + ' of ' + FIELD_SIZE + ' · choose a race';
  if (c.phase === 'lights') return head + raceName() + ' · grid place ' + c.gridPlace + ' of ' + FIELD_SIZE;
  const laps = playerLaps();
  if (c.phase === 'finished') return head + 'FINISHED ' + ordinal(c.finishPosition) + ' of ' + FIELD_SIZE + ' · ' + raceName() + ' in ' + clock(c.finishTime) + ' · best lap ' + clock(laps.best);
  return head + 'P' + field.position(playerCar) + '/' + FIELD_SIZE + ' · Lap ' + lapNumber() + '/' + c.laps + ' · ' + clock(laps.time - laps.lapStart) + ' · last ' + clock(laps.last) + ' · best ' + clock(laps.best) + ' · race ' + clock(laps.time);
}

// ---------- HUD ----------
const speedEl = document.getElementById('speed');
const surfaceEl = document.getElementById('surface');
const aiEl = document.getElementById('ai-info');
const skidEl = document.getElementById('skid');
const handbrakeEl = document.getElementById('handbrake');
const bumpEl = document.getElementById('bump');
const damageEl = document.getElementById('damage');
const damageBar = document.getElementById('damage-bar');
const hitEl = document.getElementById('bump-hit');
const lapEl = document.getElementById('lap-info');
let bumpTimer = 0, hitTimer = 0, seenBumpHits = 0, seenWallHits = 0;
updateCarLabels();

// ---------- Physics: fixed small steps, so the game behaves the same at any frame rate ----------
const STEP = 1 / 120;
let pending = 0;
const stats = { collisions: 0, lastImpact: 0 };

function physicsStep() {
  if (venue === 'stadium') {            // only your car drives in the stadium so far
    if (raceControl.phase === 'setup' || raceControl.phase === 'lights') { runStart(STEP); return; }   // everybody held on the grid until the green light
    // during a pit stop the crew has your car: the driver's keys do nothing
    if (pitStop.active) pitStop.update(STEP);
    field.update(STEP);                                        // every car drives, then the collisions between them
    if (!pitStop.active) checkPitStop();
    pitStop.tidy(STEP, !pitStop.active && pitArmed);
    if ((car.wallHits ?? 0) !== seenWallHits) { seenWallHits = car.wallHits ?? 0; bumpTimer = 0.6; }
    skidMarks.update(car);
    return;
  }
  car.update(input, STEP);              // the circuit
  if (aiEnabled) {
    if (ai) ai.update(STEP); else aiCar.update({}, STEP);
    const impact = collideCars(car, aiCar);
    if (impact > 1) { stats.collisions++; stats.lastImpact = impact; bumpTimer = 0.6; }
    if (ai) {
      // Rescue the AI car: 2 s on the grass or 3 s facing the wrong way -> back onto the road
      // where it is; 4 s standing still (blocked by your car) -> back onto the road 15 m further on
      if (ai.offTrackTime > 2 || ai.wrongWayTime > 3) { ai.respawn(); aiCar.repair(); }
      else if (ai.stuckTime > 4) { ai.respawn(15); aiCar.repair(); }
    }
    skidMarks.update(aiCar);
  }
  skidMarks.update(car);
}

// ---------- Loop ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

try { if (localStorage.getItem('car-game-night')) setNight(true); } catch { /* private mode */ }

let last = performance.now();
function frame(now) {
  const dt = Math.max(0, Math.min((now - last) / 1000, 0.1));
  last = now;
  if (!paused) {
    pending += dt;
    while (pending >= STEP) { physicsStep(); pending -= STEP; }
  }
  updateRays();
  updateCamera(dt);
  speedEl.textContent = Math.round(car.kmh);
  surfaceEl.textContent = car.onTrack ? 'On track' : 'Off track (grass)';
  skidEl.style.visibility = car.skidding ? 'visible' : 'hidden';
  handbrakeEl.style.visibility = input.handbrake ? 'visible' : 'hidden';
  bumpTimer = Math.max(0, bumpTimer - dt);
  bumpEl.style.visibility = bumpTimer > 0 ? 'visible' : 'hidden';
  if (car.bumpHits !== seenBumpHits) { seenBumpHits = car.bumpHits; hitTimer = 1.2; }
  hitTimer = Math.max(0, hitTimer - dt);
  hitEl.style.visibility = hitTimer > 0 ? 'visible' : 'hidden';
  damageEl.textContent = Math.round(car.damage) + '%';
  damageBar.style.width = car.damage + '%';
  damageBar.style.background = car.damage < 35 ? '#5fd068' : car.damage < 70 ? '#ffd23f' : '#ff5b4d';
  aiEl.textContent = aiStatus.text || (aiEnabled ? `AI car: ${Math.round(aiCar.kmh)} km/h` : 'AI car: off');
  renderer.shadowMap.needsUpdate = true;
  if (venue === 'stadium') {
    lapEl.textContent = raceLine();
    updateStartLights(paused ? 0 : dt);
    updateHelicopter(dt);
    updateBoard(dt);
    budgetShadows();
    updatePitPanel(paused ? 0 : dt);
    // sharp shadows round your car; in free look, round whatever is being looked at
    if (stadiumView === 'orbit') aimSun(look.x, look.z, THREE.MathUtils.clamp(Math.round(look.distance / 100) * 80, 160, 960));
    else aimSun(car.x, car.z, 160);
    if (night) {
      // the real lights go to the lamps nearest what is being looked at
      if (stadiumView === 'orbit') trackLighting.update(look.x, look.z);
      else if (stadiumView === 'lamp' || stadiumView === 'pit') trackLighting.update(camera.position.x, camera.position.z);
      else trackLighting.update(car.x, car.z);
      nightSky.follow(heliCam);
    }
    // the picture for the tower's screens: the view from the helicopter
    // (the screens themselves are hidden meanwhile: a screen cannot show a picture of itself)
    for (const face of stadium.screens) face.visible = false;
    renderer.setRenderTarget(screenPicture);
    renderer.render(scene, heliCam);
    renderer.setRenderTarget(null);
    for (const face of stadium.screens) face.visible = true;
  }
  if (night) nightSky.follow(camera);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Exposed for debugging in the browser console
window.game = { setNight, get night() { return night; }, get trackLighting() { return trackLighting; }, nightSky, sun, ambient, renderer, scene, camera, heliCam, get field() { return field; }, get playerCar() { return playerCar; }, raceControl, startRace, enterRaceSetup, carNumber, pitStop, get pitTyre() { return pitTyre; }, orbit, look, setVenue, get venue() { return venue; }, get stadium() { return stadium; }, get stadiumView() { return stadiumView; }, track, car, input, switchCar, setPlayerCar, tyresByCar, garage, aiCar, skidMarks, stats, physicsStep, get ai() { return ai; } };
