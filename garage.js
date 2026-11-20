// The garage: a full-screen screen, opened from the menu, where you pick your car
// and the tyres fitted to it, and repair damage. Everything is free and unlocked.
//
// It builds its own page elements and styles, and knows nothing about three.js or
// the game loop; it talks to the game only through the callbacks given to createGarage:
//
//   getState()        -> { carType, tyre, damage (0..100), tyresByCar: { carType: tyreId } }
//   onSelectCar(id)   the player picked another car
//   onSelectTyre(id)  the player picked another tyre (always one that fits the current car)
//   onRepair()        the player pressed "Repair car"
//   onClose()         the player left the garage (Back button or Esc)
import { CAR_TYPES } from './car.js';
import { TYRES, DEFAULT_TYRE, tyreFits, carSetup } from './tyres.js';

const KMH = 3.6;

// The figures shown for a tyre. "value" turns a setup (from carSetup) into the number
// shown; "better" says whether a bigger (+1) or a smaller (-1) number is the good one.
const FIGURES = [
  { key: 'roadGrip', label: 'Road grip', unit: '', digits: 0, better: 1,
    help: 'How hard the car can corner on the road before it starts to slide.',
    value: (s) => s.grip },
  { key: 'friction', label: 'Rolling friction', note: 'lower is better', unit: '', digits: 1, better: -1,
    help: 'How much the tyres hold the car back on the road. Less friction means quicker acceleration and longer coasting.',
    value: (s) => s.drag },
  { key: 'topSpeed', label: 'Top speed', unit: 'km/h', digits: 0, better: 1,
    help: 'The fastest the car will go on the road.',
    value: (s) => s.maxSpeed * KMH },
  { key: 'offroadGrip', label: 'Off-road grip', unit: '', digits: 0, better: 1,
    help: 'How hard the car can corner on grass before it slides. Same scale as road grip.',
    value: (s) => s.grip * s.grassGrip },
  { key: 'offroadSpeed', label: 'Off-road top speed', unit: 'km/h', digits: 0, better: 1,
    help: 'The fastest the car will go on grass.',
    value: (s) => s.grassMaxSpeed * KMH },
  { key: 'bumpSpeed', label: 'Safe speed over speed bumps', unit: 'km/h', digits: 0, better: 1,
    help: 'Hit a speed bump faster than this and the car is damaged.',
    value: (s) => s.bumpSafeSpeed * KMH },
  { key: 'clearance', label: 'Ground clearance', unit: 'cm', digits: 0, better: 1,
    help: 'The gap between the bottom of the car and the ground. A higher car copes better with bumps and grass.',
    value: (s) => s.clearance * 100 },
];

const CSS = `
#garage {
  position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.78); font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.4; color: #eee;
}
#garage.garage-hidden { display: none; }
#garage, #garage * { box-sizing: border-box; }
#garage .g-panel {
  display: flex; flex-direction: column; width: min(1240px, calc(100vw - 24px)); max-height: calc(100vh - 24px);
  background: #222; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.6); outline: none;
}
#garage .g-head { display: flex; align-items: center; gap: 16px; padding: 14px 22px; border-bottom: 1px solid #383838; flex: none; }
#garage h1 { margin: 0; font-size: 26px; flex: 1; }
#garage h2 { margin: 0 0 8px; font-size: 16px; }
#garage h3 { margin: 14px 0 8px; font-size: 13px; font-weight: 600; color: #aaa; }
#garage .g-note { margin: 0 0 10px; color: #aaa; font-size: 13px; }
#garage .g-body { padding: 16px 22px 20px; overflow-y: auto; overscroll-behavior: contain; min-height: 0; }
#garage .g-top { display: flex; flex-wrap: wrap; gap: 18px 28px; margin-bottom: 18px; }
#garage .g-cars { flex: 1 1 420px; min-width: 0; }
#garage .g-condition { flex: 0 1 300px; min-width: 240px; }
#garage .g-grid { display: grid; gap: 12px; }
#garage .g-grid.cars { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
#garage .g-grid.tyres { grid-template-columns: repeat(auto-fill, minmax(255px, 1fr)); }

#garage .g-btn {
  font: inherit; font-size: 15px; padding: 10px 16px; border: 0; border-radius: 8px; background: #3a7bd5; color: #fff; cursor: pointer;
}
#garage .g-btn:hover { background: #4f8fe8; }
#garage .g-btn.secondary { background: #444; }
#garage .g-btn.secondary:hover { background: #555; }
#garage .g-btn:disabled { background: #333; color: #888; cursor: default; }
#garage kbd { background: #333; border: 1px solid #555; border-radius: 4px; padding: 1px 6px; font-family: monospace; color: #fff; font-size: 12px; margin-left: 6px; }

#garage .g-card {
  display: flex; flex-direction: column; justify-content: flex-start; align-items: stretch;
  width: 100%; margin: 0; padding: 12px 14px; font: inherit; color: inherit; text-align: left;
  background: #2c2c2c; border: 2px solid #3a3a3a; border-radius: 10px; position: relative;
}
#garage button.g-card { cursor: pointer; }
#garage button.g-card:hover { border-color: #4f8fe8; background: #313131; }
#garage button.g-card:focus-visible, #garage .g-btn:focus-visible { outline: 2px solid #9cc4ff; outline-offset: 2px; }
#garage .g-card.selected, #garage .g-card.selected:hover { border-color: #3a7bd5; background: #25324a; cursor: default; }
#garage .g-card.unfit { cursor: not-allowed; background: #272727; border-color: #303030; }
#garage .g-card.unfit > :not(.g-why) { opacity: 0.45; }
#garage .g-name { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600; min-height: 40px; }
#garage .g-name span.t { flex: 1; }
#garage .g-badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px; background: #3a7bd5; color: #fff; white-space: nowrap; }
#garage .g-badge.pick { background: transparent; border: 1px solid #555; color: #bbb; font-weight: 400; }
#garage .g-desc { margin: 4px 0 10px; color: #bbb; font-size: 13px; }
#garage .g-why { margin: 0 0 10px; color: #ffd23f; font-size: 13px; }
#garage .g-figs { margin-top: auto; }   /* figures line up along the bottom of a row of cards */
#garage .g-line { display: flex; justify-content: space-between; gap: 8px; color: #bbb; font-size: 13px; margin-top: 3px; }
#garage .g-line b { color: #eee; font-weight: 600; white-space: nowrap; }

/* a little picture of the wheel: bigger tyres draw bigger */
#garage .g-wheelbox { width: 40px; height: 40px; flex: none; display: flex; align-items: center; justify-content: center; }
#garage .g-wheel { border-radius: 50%; background: #9aa0a6; border: 7px solid #0b0b0b; box-shadow: 0 0 0 1px #555; }

/* one figure: label and number on the first line, bar and comparison on the second */
#garage .g-fig { margin-top: 7px; font-size: 12px; }
#garage .g-figs > :first-child { margin-top: 0; }
#garage .g-for { margin: 0 0 6px; font-size: 12px; color: #ccc; }
#garage .g-fig .top { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; color: #ccc; }
#garage .g-fig .top small { color: #999; font-size: 11px; }
#garage .g-fig .top b { color: #fff; font-size: 13px; white-space: nowrap; }
#garage .g-fig .bottom { display: flex; align-items: center; gap: 8px; margin-top: 2px; min-height: 15px; }
#garage .g-bar { flex: 1; height: 6px; background: #3d3d3d; border-radius: 3px; overflow: hidden; }
#garage .g-bar i { display: block; height: 100%; background: #6ea8f5; border-radius: 3px; }
#garage .g-diff { flex: none; width: 86px; text-align: right; font-size: 11px; white-space: nowrap; color: #777; }
#garage .g-diff.good { color: #5fd17a; font-weight: 600; }
#garage .g-diff.bad { color: #ff7a6b; font-weight: 600; }
#garage .g-legend .good { color: #5fd17a; font-weight: 600; }
#garage .g-legend .bad { color: #ff7a6b; font-weight: 600; }

#garage .g-damage { display: flex; align-items: baseline; justify-content: space-between; }
#garage .g-damage b { font-size: 22px; }
#garage .g-bar.big { height: 12px; border-radius: 6px; flex: none; margin: 6px 0 12px; }
#garage .g-bar.big i { border-radius: 6px; }
#garage .g-condition .g-btn { width: 100%; }
`;

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function carName(carType) { return CAR_TYPES[carType] ? CAR_TYPES[carType].name : carType; }

// What a car can do on a given tyre; if the tyre is unknown, the car's own figures.
function setupFor(carType, tyreId) {
  const base = CAR_TYPES[carType];
  if (TYRES[tyreId]) return carSetup(base, tyreId);
  return { tyre: null, clearance: base.clearance, grip: base.grip, drag: base.drag, maxSpeed: base.maxSpeed,
           grassGrip: 0.45, grassMaxSpeed: 12.8, grassDrag: 4, bumpSafeSpeed: 4 + 45 * base.clearance, wheelSize: 1 };
}

// The tyre a car is wearing: the current one for the current car, the remembered one for the others.
function tyreOn(carType, state) {
  if (carType === state.carType && TYRES[state.tyre]) return state.tyre;
  const remembered = state.tyresByCar && state.tyresByCar[carType];
  if (TYRES[remembered] && tyreFits(remembered, carType)) return remembered;
  if (TYRES[DEFAULT_TYRE[carType]]) return DEFAULT_TYRE[carType];
  return Object.keys(TYRES).find((id) => tyreFits(id, carType));   // may be undefined for a car with no tyres yet
}

function shown(fig, setup) { return Number(fig.value(setup).toFixed(fig.digits)); }
function withUnit(fig, number) { return number.toFixed(fig.digits) + (fig.unit ? ' ' + fig.unit : ''); }

// The longest bar for each figure = the best value any car can reach on any tyre that fits it,
// so bars can be compared between cards and between cars.
let scales = null;
function barScales() {
  if (scales) return scales;
  scales = {};
  for (const fig of FIGURES) scales[fig.key] = 0;
  for (const carType of Object.keys(CAR_TYPES)) {
    for (const tyreId of Object.keys(TYRES)) {
      if (!tyreFits(tyreId, carType)) continue;
      const s = carSetup(CAR_TYPES[carType], tyreId);
      for (const fig of FIGURES) scales[fig.key] = Math.max(scales[fig.key], fig.value(s));
    }
  }
  return scales;
}

export function createGarage({ getState, onSelectCar, onSelectTyre, onRepair, onClose }) {
  if (!document.getElementById('garage-style')) {
    const style = document.createElement('style');
    style.id = 'garage-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  const root = document.createElement('div');
  root.id = 'garage';
  root.className = 'garage-hidden';
  root.innerHTML =
    '<div class="g-panel" role="dialog" aria-modal="true" aria-label="Garage" tabindex="-1">' +
      '<div class="g-head"><h1>Garage</h1>' +
      '<button type="button" class="g-btn secondary" data-action="back">Back to menu <kbd>Esc</kbd></button></div>' +
      '<div class="g-body"></div>' +
    '</div>';
  document.body.appendChild(root);
  const panel = root.querySelector('.g-panel');
  const body = root.querySelector('.g-body');

  let open = false;
  let focusBefore = null;     // what had the keyboard focus before the garage opened
  let escHeld = false;        // Esc closed the garage and has not been released yet

  function readState() {
    const s = getState() || {};
    const carType = CAR_TYPES[s.carType] ? s.carType : Object.keys(CAR_TYPES)[0];
    const damage = Math.min(100, Math.max(0, Number(s.damage) || 0));
    return { carType, tyre: s.tyre, damage, tyresByCar: s.tyresByCar || {} };
  }

  function carCard(carType, state) {
    const current = carType === state.carType;
    const tyreId = tyreOn(carType, state);
    const s = setupFor(carType, tyreId);
    return '<button type="button" class="g-card' + (current ? ' selected' : '') + '" data-action="car" data-id="' + esc(carType) + '"' +
        ' aria-pressed="' + current + '">' +
      '<div class="g-name"><span class="t">' + esc(carName(carType)) + '</span>' +
        (current ? '<span class="g-badge">Your car</span>' : '<span class="g-badge pick">Click to drive</span>') + '</div>' +
      '<div class="g-line"><span>Top speed</span><b>' + Math.round(s.maxSpeed * KMH) +  ' km/h</b></div>' +
      '<div class="g-line"><span></span><b>' + Math.round(s.maxSpeed * 2.23694) + ' mph</b></div>' +
      '<div class="g-line"><span>Ground clearance</span><b>' + Math.round(s.clearance * 100) + ' cm</b></div>' +
      '<div class="g-line"><span>Tyres</span><b>' + (TYRES[tyreId] ? esc(TYRES[tyreId].name) : 'none') + '</b></div>' +
    '</button>';
  }

  // One figure of a tyre card. "fitted" is the setup with the tyre fitted now, or null when there is nothing to compare with.
  function figureRow(fig, setup, fitted) {
    const number = shown(fig, setup);
    const width = Math.max(0, Math.min(100, (fig.value(setup) / (barScales()[fig.key] || 1)) * 100));
    let diff = '<span class="g-diff"></span>';   // kept even when empty so every bar has the same length
    if (fitted) {
      const change = Number((number - shown(fig, fitted)).toFixed(fig.digits));
      if (change === 0) {
        diff = '<span class="g-diff">same</span>';
      } else {
        const good = change * fig.better > 0;
        diff = '<span class="g-diff ' + (good ? 'good' : 'bad') + '">' + (change > 0 ? '\u25B2 ' : '\u25BC ') +
          Math.abs(change).toFixed(fig.digits) + (good ? ' better' : ' worse') + '</span>';
      }
    }
    return '<div class="g-fig" data-fig="' + fig.key + '" title="' + esc(fig.help) + '">' +
      '<div class="top"><span>' + esc(fig.label) + (fig.note ? ' <small>(' + esc(fig.note) + ')</small>' : '') + '</span>' +
        '<b>' + withUnit(fig, number) + '</b></div>' +
      '<div class="bottom"><div class="g-bar"><i style="width:' + width.toFixed(1) + '%"></i></div>' + diff + '</div>' +
    '</div>';
  }

  function wheelPicture(size) {
    const px = Math.round(Math.min(40, Math.max(16, 28 * size)));
    return '<span class="g-wheelbox" aria-hidden="true"><span class="g-wheel" style="width:' + px + 'px;height:' + px + 'px;border-width:' +
      Math.round(px * 0.27) + 'px"></span></span>';
  }

  function tyreCard(tyreId, state, fittedSetup) {
    const tyre = TYRES[tyreId];
    const fits = tyreFits(tyreId, state.carType);
    const isFitted = fits && tyreId === state.tyre;
    const head = '<div class="g-name">' + wheelPicture(tyre.size) + '<span class="t">' + esc(tyre.name) + '</span>' +
      (isFitted ? '<span class="g-badge">Fitted</span>' : fits ? '<span class="g-badge pick">Click to fit</span>' : '') + '</div>';
    const desc = '<p class="g-desc">' + esc(tyre.description) + '</p>';

    if (fits) {
      const setup = carSetup(CAR_TYPES[state.carType], tyreId);
      const rows = '<div class="g-figs">' + FIGURES.map((fig) => figureRow(fig, setup, isFitted ? null : fittedSetup)).join('') + '</div>';
      return '<button type="button" class="g-card tyre' + (isFitted ? ' selected' : '') + '" data-action="tyre" data-id="' + esc(tyreId) + '"' +
        ' aria-pressed="' + isFitted + '">' + head + desc + rows + '</button>';
    }

    // Does not fit: show it greyed out, with its figures on the first car it does fit
    const otherCars = tyre.fits.filter((c) => CAR_TYPES[c]);
    const why = 'Does not fit the ' + carName(state.carType) + ' car \u2014 fits: ' +
      (otherCars.length ? otherCars.map(carName).join(', ') : 'cars that are not in the game yet');
    const rows = otherCars.length
      ? '<div class="g-figs"><p class="g-for">On the ' + esc(carName(otherCars[0])) + ' car:</p>' +
          FIGURES.map((fig) => figureRow(fig, carSetup(CAR_TYPES[otherCars[0]], tyreId), null)).join('') + '</div>'
      : '';
    return '<div class="g-card tyre unfit" data-id="' + esc(tyreId) + '" aria-disabled="true">' + head + desc +
      '<p class="g-why">' + esc(why) + '</p>' + rows + '</div>';
  }

  function draw() {
    const state = readState();
    const fittedSetup = TYRES[state.tyre] && tyreFits(state.tyre, state.carType) ? carSetup(CAR_TYPES[state.carType], state.tyre) : null;
    const name = carName(state.carType);

    const tyreIds = Object.keys(TYRES);
    const fitting = tyreIds.filter((id) => tyreFits(id, state.carType));
    const others = tyreIds.filter((id) => !tyreFits(id, state.carType));

    const damage = Math.round(state.damage);
    const damaged = state.damage > 0;
    const damageColour = state.damage < 35 ? '#5fd17a' : state.damage < 70 ? '#ffd23f' : '#ff7a6b';

    let html =
      '<div class="g-top">' +
        '<section class="g-cars"><h2>Your car</h2><div class="g-grid cars">' +
          Object.keys(CAR_TYPES).map((id) => carCard(id, state)).join('') +
        '</div></section>' +
        '<section class="g-condition"><h2>Condition</h2>' +
          '<div class="g-damage"><span>Damage</span><b data-role="damage">' + (damaged && damage === 0 ? 'under 1' : damage) + '%</b></div>' +
          '<div class="g-bar big"><i style="width:' + state.damage.toFixed(1) + '%;background:' + damageColour + '"></i></div>' +
          (damaged
            ? '<button type="button" class="g-btn" data-action="repair">Repair car (free)</button>'
            : '<button type="button" class="g-btn" data-action="repair" disabled>No damage \u2014 nothing to repair</button>') +
        '</section>' +
      '</div>' +
      '<section class="g-tyres"><h2>Tyres</h2>' +
        '<p class="g-note g-legend">Click a tyre to fit it to the ' + esc(name) + ' car. Every tyre is free. The coloured notes compare a tyre with the one fitted now: ' +
          '<span class="good">green = better</span>, <span class="bad">red = worse</span>.</p>';
    if (fitting.length) {
      html += '<div class="g-grid tyres" data-group="fits">' + fitting.map((id) => tyreCard(id, state, fittedSetup)).join('') + '</div>';
    } else {
      html += '<p class="g-note">There are no tyres for the ' + esc(name) + ' car yet.</p>';
    }
    if (others.length) {
      html += '<h3>Tyres that do not fit the ' + esc(name) + ' car</h3>' +
        '<div class="g-grid tyres" data-group="other">' + others.map((id) => tyreCard(id, state, fittedSetup)).join('') + '</div>';
    }
    html += '</section>';

    // Redraw without losing the scroll position or the keyboard focus
    const scroll = body.scrollTop;
    const active = root.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active && active.dataset.action ? [active.dataset.action, active.dataset.id] : null;
    body.innerHTML = html;
    body.scrollTop = scroll;
    if (focusKey) {
      const again = [...body.querySelectorAll('[data-action]')].find((el) => el.dataset.action === focusKey[0] && el.dataset.id === focusKey[1] && !el.disabled);
      (again || panel).focus({ preventScroll: true });
    }
  }

  // Put the keyboard focus back where it was before the garage opened (e.g. the menu button that opened it)
  function restoreFocus(el) {
    if (el && el !== document.body && document.contains(el) && el.focus) el.focus({ preventScroll: true });
  }

  function leave() {
    const back = focusBefore;
    hide();
    if (onClose) onClose();          // the game shows its menu again here...
    if (!open) restoreFocus(back);   // ...so only now can a button in that menu take the focus
  }

  function hide() {
    open = false;
    root.classList.add('garage-hidden');
    focusBefore = null;
  }

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !root.contains(el) || el.disabled || !open) return;
    const action = el.dataset.action, id = el.dataset.id;
    if (action === 'back') { leave(); return; }
    const state = readState();
    if (action === 'car') {
      if (!CAR_TYPES[id] || id === state.carType) return;
      if (onSelectCar) onSelectCar(id);
    } else if (action === 'tyre') {
      if (!TYRES[id] || !tyreFits(id, state.carType) || id === state.tyre) return;
      if (onSelectTyre) onSelectTyre(id);
    } else if (action === 'repair') {
      if (!(state.damage > 0)) return;
      if (onRepair) onRepair();
    }
    if (open) draw();
  });

  // Keys: while the garage is open the game behind it must not see any key press
  // (Esc would toggle its menu, W/A/S/D would drive the car, ...). The game listens on
  // window in the bubbling phase, so catching the event here in the capture phase and
  // stopping it is enough. Default browser behaviour (Tab, arrows scrolling the list,
  // Space/Enter pressing the focused button) is left alone.
  window.addEventListener('keydown', (e) => {
    if (!open) {
      // Esc held down after closing the garage: do not let the repeats toggle the game's menu
      if (e.code === 'Escape' && e.repeat && escHeld) { e.stopPropagation(); e.preventDefault(); }
      return;
    }
    e.stopPropagation();
    if (e.code === 'Escape') {
      e.preventDefault();
      if (e.repeat) return;
      escHeld = true;
      leave();
    }
  }, true);
  window.addEventListener('keyup', (e) => { if (e.code === 'Escape') escHeld = false; }, true);
  window.addEventListener('blur', () => { escHeld = false; });

  const api = {
    open() {
      if (!open) {
        focusBefore = document.activeElement;
        open = true;
        root.classList.remove('garage-hidden');
        body.scrollTop = 0;
      }
      draw();
      if (!root.contains(document.activeElement)) panel.focus({ preventScroll: true });
    },
    close() {
      const back = focusBefore;
      hide();
      restoreFocus(back);
    },
    refresh() { if (open) draw(); },
    get isOpen() { return open; },
  };
  return api;
}
