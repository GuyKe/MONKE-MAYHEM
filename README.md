# Nature Monke

A browser VR game: move around a forest with your hands, Gorilla Tag style, and pick up sticks.

Built with Three.js (WebXR), Rapier physics, Vite and TypeScript.

## Status

- [x] **Milestone 1: Scaffold.** Vite + Three.js + Rapier, Enter VR, tracked hands, Pages deploy workflow.
- [x] **Milestone 2: Hand locomotion.** Pushing off surfaces, launching, gravity, body collision, on a test course.
- [x] **Milestone 3: Forest.** Rolling terrain, about 325 climbable trees, rocks, logs, grass, a frozen pond and mud puddles, sky and fog.
- [x] **Milestone 4: Sticks.** Grab with the grip, carry, throw. 40 physical sticks around the forest.
- [ ] Milestone 5: Sounds, particles, comfort options, performance pass.

## Running it

```sh
npm install
npm run dev          # http://localhost:5173 on desktop (uses the emulator)
npm run dev:lan      # https://<your-ip>:5173 for a headset on the same Wi-Fi
npm run build        # static build in dist/
```

Add `?arena` to the address (for example `http://localhost:5173/?arena`) to load the old flat movement test course
(crates, ramp, wall, ice and mud pads) in place of the forest.

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
| T | T-pose arm calibration |
| [ and ] | Shorter / longer emulated arms (to test arm-span scaling) |
| R | Respawn |

## The forest

`src/world/forest.ts`, `terrain.ts`, `materials.ts`. It is built from a fixed seed, so it is the same every visit.

- **Terrain:** rolling hills from noise, dead flat in the spawn clearing, with a ring of tall hills hiding the edge of the 140 m map
  (plus invisible walls behind them). The collider is the same triangle mesh you see.
- **Trees:** pines and broadleaf trees. Every trunk is solid bark you can push off, and about 60% have low wooden branches to grab.
- **Rocks and logs:** stone and bark colliders to climb and launch from.
- **Slip spots:** a frozen pond far out, plus a frozen puddle (left) and a mud patch (right) a few metres from the spawn, and more mud puddles
  further out. The rest of the ground is moss (10% slip).
- **Cost:** everything repeated is instanced, so the whole forest is about 28 draw calls.

## Sticks

`src/world/sticks.ts`, `src/player/grab.ts`. Forty loose sticks lie around the forest, six of them just in front of the spawn.

- **Grab:** squeeze a grip with a stick within about 13 cm of your hand. It stays exactly where you took hold of it. You must press
  the grip anew to grab; holding it while walking over a stick does nothing.
- **Throw:** let go and the stick keeps your hand's velocity and spin, including the swing of its far end. Dropping it without moving just drops it.
- **Hand to hand:** grabbing a stick the other hand holds takes it over.
- **Feedback:** sticks within about 20 cm of a hand glow yellow, with a small buzz when one becomes grabbable, a firmer buzz on grab,
  and a buzz on release that scales with the throw.
- **Physics:** every stick is a real rigid body. Each is a six-sided prism (like its mesh), so it comes to rest instead of rolling
  down slopes. Sticks collide with the ground, trees, rocks and each other, but never block your hands or body. A stick that falls out
  of the world comes back near the spawn.
- Physics runs in steps no longer than 1/60 s whatever the refresh rate.

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
