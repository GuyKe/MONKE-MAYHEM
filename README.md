# Nature Monke

A browser VR game: move around a forest with your hands, Gorilla Tag style, and pick up sticks.

Built with Three.js (WebXR), Rapier physics, Vite and TypeScript.

## Status

- [x] **Milestone 1: Scaffold.** Vite + Three.js + Rapier, Enter VR, tracked hands, Pages deploy workflow.
- [x] **Milestone 2: Hand locomotion.** Pushing off surfaces, launching, gravity, body collision, on a test course.
- [ ] Milestone 3: Forest (terrain, trees, rocks, fog).
- [ ] Milestone 4: Grabbable, throwable sticks.
- [ ] Milestone 5: Sounds, particles, comfort options, performance pass.

## Running it

```sh
npm install
npm run dev          # http://localhost:5173 on desktop (uses the emulator)
npm run dev:lan      # https://<your-ip>:5173 for a headset on the same Wi-Fi
npm run build        # static build in dist/
```

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
| T | T-pose arm calibration |
| [ and ] | Shorter / longer emulated arms (to test arm-span scaling) |
| R | Respawn |

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
