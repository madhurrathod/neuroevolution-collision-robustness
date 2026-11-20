# Car Track

A small three.js game: a wide looping race track seen from above, a car you drive with the keyboard (a standard car, a faster F1-style car or a 220 mph Neon car, with a choice of tyres from the garage), and a blue "AI" car driven by a small neural network. The cars can skid, drift on the handbrake, crash into each other, and get damaged on the speed bumps. There is also a second track to drive on: a banked 2-mile stadium oval with grandstands, a lap counter, and a tower whose big screens show your car from a helicopter.

## Run it

Open http://localhost:8000/ in the browser (the "Open the car game" shortcut does this).
If nothing is listening there, run `sh ~/startup.sh` in a terminal — it serves this folder with Python's built-in web server.

## Controls

The same list is in the game: menu → Controls, or press H.

- W / S (or ↑ / ↓) — accelerate / brake; once stopped, S reverses
- A / D (or ← / →) — steer left / right. Short presses give gentle turns; holding a key at speed builds up to full steering, and then the car skids
- Space — handbrake: slows the car while held, and with A or D makes the tail slide out (see "Skidding and the handbrake")
- C — camera. Circuit: above your car → above the AI car → whole track → behind your car (3D). Stadium: behind your car → above your car → helicopter → free look → grandstand → pit lane → track light close-up
- Mouse, in the behind-your-car view — hold a button and drag to look at the car from any side and from higher or lower; wheel to move closer or further away; double-click to go back behind the car
- G — garage: choose your car, fit tyres, repair damage
- F — switch straight to the next car (each car keeps the tyres you gave it)
- T — switch track: the circuit (with the AI car) or the stadium (2-mile oval)
- N — day or night (also "Time: …" in the menu; the game remembers it)
- H — the Controls screen
- Esc — open or close the menu (the game is paused while it is open)
- There is no reset key (asked for, as in a real race): drive the car back onto the road yourself; repairs are in the garage (closed during a stadium race)
- There is no key to switch track: use "Change track" in the menu
- I — AI car on / off
- V — show the AI car's sensor rays (red = road edge close, green = far)

## The cars

| | Standard | F1-style | Neon |
|---|---|---|---|
| Top speed | 115 km/h (72 mph) | 230 km/h (143 mph) | 354 km/h (220 mph) |
| Acceleration / braking | 14 / 28 m/s² | 24 / 48 m/s² | 26 / 55 m/s² |
| Tyre grip (sideways) | 45 m/s² | 70 m/s² | 80 m/s² |
| Ground clearance | 16 cm | 5 cm | 9 cm |

The Neon car is the last car in the garage: a low, dark wedge-shaped supercar with glowing cyan tubes under its floor and their light on the road beneath it (it shows by day and stands out at night). It reaches 220 mph about 4.3 seconds after a standing start and laps the stadium flat out in about 33 seconds; on the circuit it is far too fast for the bends without braking. It has two tyres of its own, Supercar and Track-day. The neon's colour, how far the glow spreads and how strong it is are in `NEON` in `car.js`. The glow is painted on the road under the car; it does not light other objects.

These are the figures on each car's own tyres; they are in `CAR_TYPES` at the top of `car.js`. The standard car can take every bend on this track flat out if you steer smoothly. The F1 car cannot: the tight bends need braking to roughly 150–165 km/h (the tyres give up at about 175 km/h in the tightest one), otherwise it slides wide onto the grass.

## Garage and tyres

The garage (menu button or G) lists the cars, the tyres and the car's damage. Everything is unlocked; there are no prices yet. Each tyre only fits some cars, and the garage remembers your car and the tyres on each car between visits (in the browser's local storage).

| Tyre | Fits | Road grip | Rolling friction | Top speed | On grass | Bumps |
|---|---|---|---|---|---|---|
| Street | Standard | normal | normal | 115 km/h | 46 km/h, little grip | safe up to 40 km/h |
| Sport | Standard | +20% | −15% | 115 | worse (35 km/h) | car sits 2 cm lower: 37 km/h |
| Low-friction | Standard | −12% | −55% | 121 | slightly worse | 40 |
| All-terrain | Standard | −8% | +25% | 112 | good (66 km/h) | 4 cm higher: 47 |
| Off-road (big wheels) | Standard | −20% | +60% | 104 | best (90 km/h, nearly full grip) | 10 cm higher: 57 |
| Racing slick | F1 | normal | normal | 230 | 37 km/h, very little grip | 23 |
| Soft slick | F1 | +15% | +30% | 226 | same | 23 |
| Grooved | F1 | −10% | normal | 230 | better (46 km/h) | 23 |
| Supercar | Neon | normal | normal | 354 | 40 km/h, little grip | 29 |
| Track-day | Neon | +15% | +30% | 343 | same speed, less grip | 29 |

Road grip decides how fast a bend can be taken before the car skids; rolling friction decides how quickly the car picks up speed and how far it coasts. All the numbers are in `tyres.js`; `carSetup()` there combines a car and a tyre into what the physics uses. New cars go into `CAR_TYPES` (with their own `clearance`) and new tyres into `TYRES` (with the list of cars they fit); the garage picks both up by itself.

## Ground clearance

Clearance is the gap under the car: the car's own figure plus whatever the tyres add or take away. A higher car is safer over speed bumps (safe speed = 14 km/h + 1.6 km/h per cm of clearance) and faster on grass (its belly does not drag); a lower one is the opposite.

## Speed bumps and damage

There are three yellow-and-black speed bumps round the loop, 12 cm high. Taken slowly the car just rides over. Taken fast, the car is kicked up and leaves the ground for a moment (about 13 cm high at 115 km/h, about 40 cm at 230 km/h), and while it is in the air it cannot steer, brake or accelerate. Hitting a bump faster than the car's safe speed also damages it: 0.7% for every m/s over (about 15% for the standard car at full speed, about 40% for the F1 car at full speed). Damage takes away power, top speed and some grip: a wrecked car (100%) keeps 40% of its speed. "Repair car" in the garage, or Reset, fixes it for free. Collisions between the cars do not cause damage (yet).

## Skidding and the handbrake

Each car has a direction it points and a direction it is actually moving. The tyres pull the two together, but only up to their grip. If a turn needs more than that (too much steering for the speed), the car keeps sliding the old way: "SKID!" shows, tyre marks are drawn, grip drops to 75% while sliding, and speed is scrubbed off. Ease off the steering and it grips again within about half a second; keep holding and it spins round.

Below about 50 km/h (80 for the F1) steering alone cannot make the cars skid. The knob for how easily a car skids is `steerDemand` in `CAR_TYPES`.

The handbrake (Space) locks the rear wheels, and three things follow:

- **The car slows down for as long as you hold it**, whichever way it is moving, at 40% of its full braking power on top of the normal drag. The standard car stops from 115 km/h in about 2 seconds and 31 m (the foot brake needs 1 second and 17 m; coasting needs 13 seconds). The engine does not pull while the handbrake is on, so W makes no difference, and once stopped the car is held still.
- **The locked wheels skid**: "SKID!" shows and they leave black marks, even in a straight line.
- **The tail slides out when you steer**: the rear tyres hold only 30% of their sideways grip and the car turns in more sharply. A short tap (0.3–0.6 s) with A or D going into a bend swings the car round; let go and keep W down and it drives out pointing the new way (60% of the energy of the slide is turned into forward speed when you power out). For example, the standard car at 80 km/h gets round a 90° turn in about 0.95 s with a 0.4 s tap instead of 1.4 s by steering alone, on a much tighter line, and comes out at about 58 km/h. The longer you hold it the more speed you lose; hold it for good and the car ends up sideways and stopped.

The numbers are `HANDBRAKE_BRAKING`, `HANDBRAKE_GRIP`, `HANDBRAKE_STEER` and `DRIFT_CARRY` in `car.js`.

## Collisions

Your car and the AI car are treated as rectangles. When they overlap they are pushed apart and bounce (speed is exchanged along the direction of the hit), and a hit away from the centre spins the car. "CRASH!" shows on a real impact. Limits: both cars weigh the same; the AI cannot see your car, so it will drive into you if you are in its way; a car hit side-on is hard to push because its tyres resist.

## The stadium (second track)

The track is chosen on the first screen and can be changed later with "Change track" in the menu (there is no key for it; changing during a race ends the race). In the stadium you race against 42 AI cars (see "The 43-car field"); the handbrake, skids and damage work as on the circuit. Every visit to the stadium begins with the race setup (see "Races").

- **Shape:** a rounded rectangle, like a real speedway: two straights of about 805 m, two short straights of 160 m and four left turns of 205 m radius. One lap is exactly 2 miles (3,218.7 m) along the middle of the road. The road is 20 m wide (six cars side by side), with a 5 m apron inside it.
- **Banking:** the road tilts towards the inside: 2° on the straights and 10° in the turns, so in a turn the outside edge is about 3.5 m higher than the inside. The tilt changes gradually, along a smooth curve, over about 120 m either side of where a turn starts or ends.
- **Rise and fall:** the lap climbs from the start line to the middle of the back straight, which is 15 m higher, and comes back down (1.5% slope at most along the inside of the road). The number is `rise` in `STADIUM`.
- **Driving on it:** the car sits on the road's surface (it leans with the banking and tips on the slopes), gravity pulls it gently downhill, and grass in the infield is slow as on the circuit. The outer wall is solid all the way round: hit it and the car bounces off a little, loses speed and is turned to scrape along it ("CRASH!" shows), and rubbing along it keeps costing speed, so leaning on the wall through a turn is far slower than driving round it. The pit wall, the pit building and the tower are solid too. The standard car laps in about 1 min 41 s flat out, the F1 car in about 52 s.
- **Laps:** a lap counts when you have passed eight checkpoints in order (the start line, then every eighth of the way round) going forwards on or beside the track (within 60 m of the road, so the pit lane counts), so reversing over the line, driving the wrong way or cutting across the infield counts nothing. The race clock and the first lap's clock start at the green light (the car starts 8 m behind the line); every later lap is timed line to line. The lap ("Lap 3/10"), the running lap time, the last and best lap and the race time are shown on screen, and the lap block on the tower shows "3/10".
- **The tower:** in the middle of the infield, 140 m tall, solid, built like a scoring pylon. At the top are four screens (96 × 54 m, one facing each way) showing the live picture from a helicopter camera that follows your car from above and to one side. Under the screens is a block with the lap number, and below that five blocks down the pillar, one for each of the first five places, each showing the number of the car in that place (on all four sides). For now only your car races, so place 1 shows your number (a random number from 1 to 99, also shown on screen as "Car …") and places 2–5 show a dash. The same picture is available full-screen as the "helicopter" view. From the track the tower is 250–600 m away; the lap and car numbers are about 8 m tall so they can be read from the straights.
- **Track lights:** 80 of them, one every 40 m along the outside of the track. Each is a slim round pole that stands just behind the outer wall, goes straight up for 5.5 m and then sweeps over the track in one smooth curve (no corners), 9.4 m high, reaching 4.6 m in over the road, with a slim rounded lamp head and a glowing lens at the tip. By day they are only models; at night they light the road (see "Night"). Every measurement is in `LIGHT` in `stadium.js`. The last view on the C key is a close-up of one.
- **Grandstands:** empty, all the way round, outside a 1 m wall and a service road. Two levels of steps like a wide staircase (12 rows, a walkway, 14 rows; each row 1.2 m deep and 0.7 m higher than the one in front), about 23 m high.
- **Start:** a checkered line under a gantry in the middle of the front straight, and 43 numbered starting places in two columns behind it. You start last, or (half the time) at a random place in the last 30% of the grid (31-43), decided afresh for every race.
- **Pit lane:** inside the front straight, about 900 m from where it leaves the apron (at the end of the last turn) to where it rejoins (at the start of the first). It is 12 m wide and runs past 43 pit boxes, each 12 m long and 8 m deep, outlined and numbered, with a yellow stop line and four spare tyres at the back, and a row of numbered garages behind them. A low wall separates it from the track.
- **Pit stop:** your box is box 1, the first one after the pit entry, framed in yellow with a "YOUR BOX" sign. Drive in and stop in it (below 4 km/h). From then on the crew has the car and your keys do nothing: the car rolls onto its mark, is jacked up, four crew members undo the wheels, carry the old ones out and lay them down, bring four new ones and fit them, the car is let down, and the lollipop man turns his sign from STOP to GO. That takes about 6 seconds (it counts in your lap time). While the old wheels come off you can press 1–5 (1–3 in the F1 car, 1–2 in the Neon car) to choose which tyres go on; otherwise you get a new set of the same kind. After GO you drive off; the next stop can start once you have left the box. The old wheels stay lying in the box for a few seconds. The timings are `PIT_TIMES` in `pitstop.js`. Tyres do not wear out yet, so a stop is for changing the kind of tyre (or for the show).
- **Views (C):** behind your car (with mouse look), above your car, helicopter, free look (drag to look round, wheel to zoom, Shift+drag to move, double-click to reset), the top of the grandstand, the pit lane, a close-up of a track light.

Everything about the shape is at the top of `stadium.js` (`STADIUM` for the track, `STAND` for the steps). `buildStadiumData()` answers the questions the driving code asks: where a point is along and across the lap (`locate`), how high the ground is there (`heightAt`), which way it slopes (`slopeAt`, `normalAt`, `bankAt`), whether it is tarmac (`isOnTrack`), what is solid (`constrain`), plus the starting places (`grid`) and the pit lane (`pit`).

## The 43-car field

Every stadium race has 43 cars: you and 42 AI cars. Every car is different: 40% drive the standard car, 35% the F1 car and 25% the Neon car, each with tyres picked from the ones that fit it, and each driver has its own pace (86-100% of the car's top speed), preferred lane, following distance and reaction time at the start. Every car has its own colours, pattern and race number (1-99, all different; yours is painted on your car too). The running order is shown on the tower (first five) and on screen ("P12/43").

- **How the AI drives** (`ovaldriver.js`): rules, not a neural network (the circuit's blue car still uses its network). Thirty times a second every driver looks at the cars around it, 30 m behind and ahead as far as 25 m plus 1.6 s of driving, and works out for every line across the road (a metre apart) how fast it could drive there: each car in front on that line allows its own speed plus what can be braked off in the gap to it. It then takes the best line it can reach. Moving sideways has to be worth it, its own favourite line counts a little, a line with less traffic ahead counts more, and **in a turn the inside line gets a bonus** when the driver is being held up. A car alongside blocks moving that way; a much faster car coming up behind makes pulling out in front of it unattractive; cutting across the nose of a slow car to the other side does not count as a way round. So **a slow or standing car is driven round on the emptier side, not queued behind**. Only when the whole width is blocked do cars wait, and a car that has stood behind a standing car for a second backs up if it needs room, swings out and creeps past; after four seconds it squeezes through whatever gap there is.
- **Crashes:** drivers are not perfect. Each keeps its own gap (a time gap of 0.1-0.4 s, shorter for bold drivers), trusts its brakes to its own degree (`nerve`, 0.7-1.05: the boldest count on more braking than the car has), and has lapses of attention (every 8-40 s on average, 0.4-1.2 s long) during which the car carries on as it was. So when a car in front stops dead, some of those behind do run into it, and bold drivers sometimes misjudge a pass. A knock harder than 6 m/s leaves the driver without control for up to 2 s, so a car that is hit can spin, slide into the wall or end up on the grass. It then gets itself going again: on the grass it heads for the nearest bit of road at a gentle speed; facing the wrong way it reverse-turns round; stuck nose-first it backs out; in the pit lane it follows the pit road to its end. No car is ever respawned. In a 150 s check race of 43 cars there are about 25 touches, 5 of them hard. All the numbers are in `DRIVING` at the top of `ovaldriver.js` and in `planAIs` in `field.js`.
- **How the cars are built** (`field.js`): a RaceCar owns the physics (`CarController`) and the 3D model and gets its behaviour from components attached to it (`car.attach(component)` / `car.detach(name)` / `car.get(name)`): a driver (`PlayerDriver` reads your keys; `OvalDriver` is the AI) and a `LapCounter` (checkpoints, lap times, finish). Components are plain classes with `attach/detach/update(car, dt)`, so a new kind of behaviour (tyre wear, damage, a different AI) is a new class attached to the cars that should have it. Cars send events (`car.on('lap' | 'finish' | 'hit', handler)`). The `Field` holds the cars, runs the collisions between them (only cars within 16 m of each other along the track are tested) and works out the standings (finished cars first, then by distance covered). `planAIs` decides the mix, `raceNumbers` the numbers, `playerGridPlace` where you start.
- **Looks** (`livery.js`): `makeLivery(index, number)` gives every car a body colour round the hue circle (plus a few white/black/silver/navy/cream bodies), a contrasting accent, one of six patterns (plain, stripe, two stripes, roof, flank, chevron) and its number on the top and both sides; no two cars share a colour family and a pattern.
- **Cost:** only AI cars within 160 m of you cast shadows. All 43 cars are simulated every step (about 0.7 ms per step in node for the whole field).
- **Check:** `cd ~/car-game && node check-field.mjs` plays six situations without 3D and prints touches, hard hits, off-track time, the longest any car stood still and the laps done: an ordinary race; your car parked on the grid for four minutes (the field must keep lapping round it); a car parked in a turn; a car stopping dead in the pack; a car shoved sideways; and recovery from the grass, the wall and the pit lane. `node check-field.mjs parked` runs one of them.

## Races (stadium)

Entering the stadium opens the **race setup** (all 43 cars already on the grid): Sprint (5 laps), Championship (10), Endurance (20) or Custom (type any whole number from 1 to 200; anything else keeps the Start button greyed out). From there you can also visit the garage to pick your car and tyres. The game remembers your last choice.

- **Start:** your car waits on pole position, held still (the keys do nothing). Three red lights come on one second apart — big on screen and on the start gantry over the road — then after a short random wait (0.6–1.6 s) all three turn green with "GO!" and the race clock starts.
- **During the race** there is no reset: no R key and no reset button. The garage and car switching (G, F) are closed. Pit stops work as before and their time counts. The menu has "Retire from the race", which ends the race and puts everybody back on the grid for a new setup.
- **Finish:** crossing the line at the end of the last lap finishes the race. A moment later the results appear: your finishing position (the AI cars that completed the distance before you count), race time, best lap, average lap and every lap's time (best in green), with Race again, Choose another race, or Keep driving (no timing).

The lengths and the light timings are `RACES` and `START` in the Races section of `main.js`.

## Night

Menu → "Time: day / night", or the N key. It works on both tracks and the game remembers the choice.

- **Sky:** almost black, with about 130 small stars and a moon (low over the stadium's infield, ahead and to the left as you leave the start line; drag the mouse in the behind-your-car view to look up at it). The only light everywhere is weak blue moonlight.
- **Track lights (stadium):** each of the 80 lights throws a cone of warm light down onto the road, so the road is lit in separate pools, one under each light, about 30 m across, with darker road between them (the lights are 40 m apart). The outer wall is lit where a pool reaches it, and every lamp has a glow.
- **Pit lights (stadium):** 22 white lamps under the edge of the garage roof, one over every second pit box, light the boxes and the near side of the pit road.
- **Driving through it:** the six lights nearest your car are real lights: the car gets bright as it passes under each one and dark between them, and under a lamp it casts a shadow that swings round as you pass. The lights further away are drawn as pools of light painted on the ground in the same shape; a light changes from painted to real gradually as you approach, so nothing pops. Painted pools show on the ground only, so a car far from yours would not be lit by them (no such cars yet).
- **Circuit:** it has no lamps, so at night it is lit by the moon only (a little brighter than in the stadium so the road can be seen).
- **Not there yet:** headlights on the cars, floodlights on the grandstands.

Every number (how many stars, where the moon is, the colour, strength and width of the lights, how many are real) is in `NIGHT` at the top of `night.js`.

## Files

- `index.html` — page, menu, Controls screen and the on-screen readouts
- `main.js` — scene, lights, cameras (including the mouse look), keyboard input, menu wiring, game loop (physics runs in fixed steps of 1/120 s)
- `track.js` — builds the track from a closed smooth centerline (the `shape()` function near the top: a stretched circle whose radius swells gently, every bend at least ~34 m radius). Road, curbs and centre line are all built from the same centerline points, so they stay aligned. It also places the speed bumps (`BUMP_COUNT`, `BUMP_HEIGHT` at the top). `buildTrackData()` is the part without drawing (also used for training)
- `car.js` — the kinds of car (`CAR_TYPES`), the three 3D models (built from simple shapes) and the driving physics (`CarController`: steering, skids, handbrake, the hop over bumps, damage)
- `tyres.js` — the tyres, which cars they fit, and `carSetup()`
- `garage.js` — the garage screen
- `night.js` — the night: the sky (stars, moon) and the stadium's lights (pools of light, glows, the real lights that follow your car)
- `field.js` — the cars of a race as objects built from components; the field, collisions and standings
- `ovaldriver.js` — the rule-based AI that drives the oval
- `livery.js` — every car's colours, pattern and painted number
- `pitstop.js` — the pit stop: crew, jacks, wheels off and on, the lollipop sign
- `stadium.js` — the stadium: its shape and heights (`buildStadiumData`) and how it is drawn (`buildStadium`)
- `collision.js` — car-to-car collisions
- `skidmarks.js` — tyre marks
- `ai.js` — the neural network (`NeuralNet`), the sensor rays (`senseRays`) and `AIDriver`, which feeds the sensors to the network and the network's answer to the car
- `ai-weights.json` — the trained network the game loads
- `train.mjs` — trains a new network: `cd ~/car-game && node train.mjs` (5–10 minutes, overwrites ai-weights.json, then reload the page). Needed again whenever the track, the bumps or the standard car's physics change. `node train.mjs --check` only tests the saved network and changes nothing
- `node_modules/three` — three.js, installed with npm

## How the AI car works

- **Sensors:** 7 rays fan out from the car (90° left to 90° right). Each measures how far the road edge is, up to 40 m. It also knows how far ahead the next speed bump is (up to 60 m).
- **Network:** 10 inputs (the 7 distances, current speed, how fast the car is sliding sideways, and the distance to the next bump) → 10 hidden neurons → 2 outputs: steering (left/right) and throttle (accelerate/brake). 132 numbers (weights) in total.
- **Training (evolution):** 80 cars each drive from 12 standing starts round the loop, in different lanes, and from 3 standing starts just before a bump; in 3 more drives the car is shoved sideways and spun, as if hit, so it learns to recover. A drive ends when the car's centre gets within 1.5 m of the asphalt edge. Distance and speed score points; every 1% of damage from the bumps costs as much as 30 m. The best are kept; the next generation is made of copies and mixes of them with small random changes. Training starts from the saved network (`--fresh` starts from random ones) and stops a while after the best network finishes 1.25 laps in every drive with no more than 3% damage.
- **Check:** the finished network is tested on 72 drives it never trained on (12 other places round the loop × 3 lanes, each with and without shoves). A drive passes if the car does 3 laps with all its wheels on the asphalt and no more than 3% damage. `node train.mjs --check` repeats this test. The saved network passes 71 of 72; in the one it misses it finishes its 3 laps, but after being shoved it takes one bump a little too fast (4% damage).
- **What it learned about bumps:** it brakes to about 37 km/h (just under the standard car's safe speed of 40) before each one and accelerates away. A lap takes it about 22 seconds.
- The AI always drives the standard car on street tyres, it never uses the handbrake, and it cannot see your car. Because of that the game rescues it after a crash: 2 seconds off the road or 3 seconds facing the wrong way and it is put back on the centre line where it is; 4 seconds standing still (blocked) and it is put back 15 m further along. A rescue also repairs it.
