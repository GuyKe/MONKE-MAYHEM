# Nature Monke

A browser VR game: move around a forest with your hands, Gorilla Tag style, and pick up sticks.

Built with Three.js (WebXR), Rapier physics, Vite and TypeScript.

## Status

- [x] **Milestone 1: Scaffold.** Vite + Three.js + Rapier, Enter VR, tracked hands, Pages deploy workflow.
- [x] **Milestone 2: Hand locomotion.** Pushing off surfaces, launching, gravity, body collision, on a test course.
- [x] **Milestone 3: Forest.** Large random forest: hills, about 2,600 climbable trees, rocks, logs, grass, frozen ponds and mud puddles.
- [x] **Milestone 4: Sticks.** Grab with the grip, carry, throw. Solid sticks that collide with each other and the world.
- [x] **Beyond the plan:** day-night cycle and heavy atmosphere, and a field journal for crafting with recipes you unlock as you play.
- [ ] Milestone 5: Sounds, particles, comfort options, performance pass.

## Running it

```sh
npm install
npm run dev          # http://localhost:5173 on desktop (uses the emulator)
npm run dev:lan      # https://<your-ip>:5173 for a headset on the same Wi-Fi
npm run build        # static build in dist/
```

Options you can add to the address:

| Option | Effect |
|---|---|
| `?seed=123` | Load the same forest again. Without it, every visit is a new random forest and spawn. |
| `?time=0.7` | Start at a time of day (0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset). |
| `?cycle=120` | Seconds for a whole day (default 600). |
| `?resetbook` | Forget the recipes the journal has unlocked. |
| `?arena` | Load the small flat movement test course instead of the forest. |
| `?emulate` | Use the desktop emulator even if a headset is present. |

With `dev:lan`, accept the self-signed certificate warning in the Quest browser. WebXR only works over HTTPS.

### Desktop emulator

With no headset (or with `?emulate` in the URL), the game loads Meta's
[IWER](https://github.com/meta-quest/immersive-web-emulator) and drives the
fake controllers from the keyboard:

| Input | Action |
|---|---|
| Click, then move the mouse | Look around |
| W A S D | Knuckle-walk (scripted arm strokes) |
| Shift | Faster strokes |
| Space | Push both hands down to jump |
| Q / E | Squeeze the left / right grip (grab and throw sticks) |
| B | Open or close the journal |
| 1 to 4 | Craft a recipe (journal open) |
| T | T-pose arm calibration |
| [ and ] | Shorter / longer emulated arms (to test arm-span scaling) |
| R | Respawn |

## The forest

`src/world/forest.ts`, `terrain.ts`, `baker.ts`, `materials.ts`. A new random forest on every visit, and where you start is random too.
`?seed=N` repeats one.

- **Size:** a 420 m square (about nine times the original), with a ring of tall hills and invisible walls at the edge.
- **Terrain:** broad hills and valleys with finer bumps, dead flat in the spawn clearing. The collider is the same triangle mesh you see.
- **Trees:** about 2,600 pines and broadleaf trees. Every trunk is solid bark you can push off, and about 60% have low wooden branches to grab.
- **Rocks and logs:** 420 rocks and 90 logs to climb and launch from.
- **Slip spots:** six frozen ponds, 45 mud puddles, and a frozen puddle (left) and mud patch (right) a few metres from where you start.
  The rest of the ground is moss (10% slip).
- **Sticks near you:** about 280 sticks are spread over the map, and eight are always in a fan right in front of you.
- **Keeping it fast:** the map is cut into 60 m chunks. Everything in a chunk that doesn't move is baked into one mesh, and only chunks near you
  are drawn, with cheaper terrain and trees beyond 45 m and grass only up close. That is about 35-76k triangles and 19-31 draw calls per eye
  wherever you stand.

## Day and night

`src/world/atmosphere.ts`. A day takes 10 minutes. The sun and moon cross a sky of stars; dawn and dusk turn it red and gold.
Fog is thick all day, thicker at night, and thickest in the morning mist. Dust drifts in the daylight and fireflies come out at night.
Torches and campfires give real light, which is how you see after dark.

## Sticks

`src/world/sticks.ts`, `src/player/grab.ts`. Forty loose sticks lie around the forest, six of them just in front of the spawn.

- **Grab:** squeeze a grip with a stick within about 13 cm of your hand. It stays exactly where you took hold of it. You must press
  the grip anew to grab; holding it while walking over a stick does nothing.
- **Throw:** let go and the stick keeps your hand's velocity and spin, including the swing of its far end. Dropping it without moving just drops it.
- **Hand to hand:** grabbing a stick the other hand holds takes it over.
- **Feedback:** sticks within about 20 cm of a hand glow yellow, with a small buzz when one becomes grabbable, a firmer buzz on grab,
  and a buzz on release that scales with the throw.
- **Solid:** a held stick is still a physical body, driven toward your hand, so it can't pass through the ground, a trunk, or another stick,
  including one in your other hand. Rub two sticks together and they scrape. A stick that gets wedged far from your hand is dropped.
- **Physics:** each stick is a six-sided prism (like its mesh), so it comes to rest instead of rolling down slopes. Sticks collide with the
  ground, trees, rocks and each other, but never block your hands or body. A stick that falls out of the world comes back near the spawn.
- Physics runs in steps no longer than 1/60 s whatever the refresh rate.

## Fire from rubbing sticks

`src/world/friction.ts`. Hold two sticks together and rub them, one sliding along the other. The faster and steadier you rub, the hotter they get:
you feel a scraping rumble in your hands that grows stronger, then see an ember glow where they touch, then smoke and sparks. About 2.5 seconds of
steady rubbing lights it.

- **Over a pile:** with 5 or more loose sticks lying together under the rubbing (within about 70 cm, and the rubbing no higher than a metre above the
  ground), the pile catches and becomes a campfire. The pile is used up, and a bigger pile makes a bigger fire (up to 14 sticks).
- **No pile:** you get a small flame that burns for 10 seconds, and a message tells you how many sticks a pile needs.
- **What counts as rubbing:** the sticks must touch and slide along each other, and at least one must be in a hand. Holding them still against each
  other, or sliding them apart, makes no heat. Heat drains away when you stop.

The journal's Campfire recipe still works too. Rubbing is the way to make one without spending sticks from the book.

## The field journal

`src/player/book.ts`, `journal.ts`, `src/world/fire.ts`. A leather book hangs on your left hip and follows the way your body faces.

- **Put sticks in:** hold a stick up to the book and let go. The stash is what you craft with.
- **Open it:** squeeze a grip with an empty hand near the book. The pages float in front of you.
- **Craft:** poke a recipe with your hand. What you make appears in front of the pages, ready to grab, except the campfire, which is built on the
  ground ahead of you.
- **Unlock as you go:** each recipe stays locked until you do something. The pages tell you what.

| Recipe | Cost | How to unlock it |
|---|---|---|
| Lashed Pole (2 m pole) | 2 sticks | Put a stick in the book |
| Torch (a lit flame, real light) | 3 sticks | Be out in the forest as evening falls |
| Throwing Spear | 2 sticks | Throw a stick 8 metres |
| Campfire (stones and a fire that stays lit) | 6 sticks | Craft a torch |

Unlocked recipes are remembered in your browser between visits. A glowing book and a message above it tell you when something new unlocks.
Torches and campfires are real lights, but only the two nearest fires get one, to keep it fast on a headset.

## How the movement works

Movement comes entirely from your hands. The avatar has no legs and there is no thumbstick walking.

**Hand-contact propulsion** (`src/player/locomotion.ts`). Each frame, each hand sphere sweeps from where it was to
where the controller now is. If it hits a surface, the hand stays where it touched, and the gap
between hand and controller moves the whole player in reverse. Pushing down lifts you and pulling
back moves you forward. When you let go, you keep the average velocity of the last few frames.

**Surface friction and slip** (`src/world/materials.ts`). Every collider has a material with a slip
percentage: the share of a hand's sideways motion along the surface that is lost to sliding.
The hand slides along with the controller by that share, and only the rest moves you. Pushing straight
into a surface is never reduced. Slippery ground also keeps your body sliding for longer.

| Material | Slip |
|---|---|
| bark | 0% |
| wood | 5% |
| moss | 10% |
| dirt | 20% |
| stone | 30% |
| mud | 55% |
| ice | 90% |

**Arm-span scaling** (`src/player/armSpan.ts`). Hand offsets from the head are scaled by
`reference arm length / your arm length`, so a fully stretched arm reaches the same virtual distance and one swing
gives the same push whether you are short or tall. The arm span comes from:
1. A saved calibration from an earlier visit.
2. Otherwise an estimate from your standing eye height at the start.
3. A new calibration any time you want: **hold both grips with your arms stretched out to the sides at head height for
   about 1.5 seconds.** The controllers buzz with growing strength, then once strongly when it is saved.

All of the feel settings are in `src/config.ts`.

## Deploying

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`.
Turn it on in **Settings → Pages → Source: GitHub Actions**.
