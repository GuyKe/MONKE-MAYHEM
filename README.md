# LOCKDOWN

A VR horror-survival escape game for the browser (Three.js WebXR + Rapier + Vite/TypeScript, hosted on GitHub Pages). Movement is
**gorilla-tag style hand locomotion**: push off the ground, walls and ceilings with your hands to run, climb and fly. Single-player
for now; the code is laid out so multiplayer can be added.

## The game

1. **The safe zone (lobby).** You wake in a bright concrete room with exposed beams, square panel lights, pipes along the wall and blue lockers. There is a
   - **registry terminal**: type your display name (on the wall keyboard with a poke or laser, or a real keyboard on the desktop), then SAVE;
   - **customization station**: a full-body mirror and a wardrobe/shop where you spend credits on suits, hats and gear;
   - **gear wall**: glowsticks, flashlights and radar pingers;
   - **a big reinforced window** over the machine hall, far below;
   - **a training annex**: stepping blocks, poles and a climbing wall up to a green plate, with a timer (poke START RUN) and a saved best time;
   - a **briefing board** with survival tips, a **facility poll** monitor, a **vending machine** (an Energy Cell makes your next run faster), a lounge, benches facing the window, and a **security monitor**.
2. **The drop.** Hit the window hard (three good punches or throws) and it shatters. Climb out and drop onto the catwalk hanging over the hall.
3. **The Backrooms (Level 0).** Below the window an atrium opens onto an endless-feeling maze of mono-yellow wallpaper rooms: water stains, peeling corners, stained baseboards, damp carpet, an acoustic drop ceiling with a grid of recessed fluorescent panels (some steady, some flickering, some dead). A constant fluorescent buzz rises in pitch as you near a live panel; carpet squelches, water splashes, vents breathe far away. Landmarks: **The Pitfalls** (a lattice of narrow walkways over deep square drops), a **flooded hallway** with shallow reflective water, and a dim **relay station** with server racks. Something lives here:
   - **The shade** – entirely pitch black, with two glowing white pupils, blood splatters and a wide frown full of sharp teeth. Three of them patrol. They hunt by **sight** and **sound** (running, landing, shouting, the radar ping, a slamming door, breaking glass). They are big: **tight gaps and narrow doorways slow them to a crawl**, but you can slip through.
4. **Doors.** Each door has a panel with **OPEN / CLOSE / JAM**, and a handle you can grab and lift. Shut a door on a monster and it is stunned; jam one shut and the monsters have to batter their way through. But a closing door **crushes you instantly**, and a door you let go of half way drops.
5. **Lockdown.** Every minute or two the alarm sounds, the lights flicker red and *every door* opens and closes by itself for about 25 seconds. The alarm draws the monsters.
6. **The way out.** Restore power at the two **relays** (one in the relay station, one across the Pitfalls), then the exit gate opens. Reach the exit lift and press **EVACUATE**. You earn credits for surviving and for escaping, and keep some even when you die.

## The Backrooms

A research gantry under the window leads down into the atrium; through it is the maze. Climb knocked-over office dividers up onto stacked crates, swing along exposed ceiling pipes, and use the shoulder-high holes in the drywall to cut through or hide above sightlines. Heavy doors have **push-buttons and a pull-down lever**; before one slams shut its lamp flashes and it beeps and throws sparks. **Relay B** is across the Pitfalls; **Relay A** is in the relay station. The exit lift is at the far south end.

## More to find and use

- **Lockers** against the maze walls: step in and keep still; the door swings shut and nothing can see you. A hunter that comes right up to it may check, and find you.
- **Data logs** on a stand in a dead end: hold one and it plays; each pays credits the first time (8 in all, shown at the terminal).
- **Security monitor** on the lobby wall: a plan of the facility with every door's state, the relays, and flickering blips where the cameras think monsters are. It is not reliable.
- **Power failures** (the lights die for several seconds; use your own light or stay still), **ambient scares** in the dark, a **red fear vignette** when something is on you.
- **Gear** is scattered round the maze afresh each run, as well as on the lobby wall.
- **The window grows back**: it reseals when you return to the lobby, or on its own after a couple of minutes, and small cracks mend.

## Hand-held gear

- **Glowstick** – lights the dark; throw it to see or to lure.
- **Flashlight** – squeeze to hold, trigger to switch on. Being lit makes you easier to spot.
- **Radar pinger** – trigger to ping: blips of nearby monsters appear on its screen and buzz your hand. The ping can be heard.

## Feel

- **Your model:** a stylized low-poly hazmat survivor with no legs, a bean-shaped torso, extra-long arms and chunky three-fingered rubber gloves: a bulky hood, dark visor, boxy respirator, chest filter canister and black seam tape, in nine suit colours (default faded mustard-yellow), with fifteen hats and twelve gear items to buy.
- **Haptics:** a heartbeat in both hands when something hunting is near (faster when closer), glass cracks and shatters, door slams and bangs, landings.
- **Spatial voice and echo:** all sound, and voices (the microphone, and other players when multiplayer is added) are positional with a reverb that follows the size of the space: tight in the lobby, a long echo in the great hall. The terminal's **MIC CHECK** plays your own voice back with the room's echo.

## Controls

Quest-style controllers. **Grip** to take things and lift door handles, **trigger** to use them (flashlight, radar, buttons by laser), thumbstick to turn (snap or smooth), **B/Y** for the pause menu (return to lobby, turning, volume, buzz, mic).

Desktop emulator (`?emulate`): click to look; W/A/S/D knuckle-walk; Space jump; Q/E grips; Z/X triggers; P pause; T arm calibration; R respawn. Typing at the terminal works with the real keyboard.

## Running

```
npm install
npm run dev        # http://localhost:5173/?emulate for the desktop emulator
npm run dev:lan    # HTTPS on your network, for a headset
npm run build
```

The old jungle game and its minigames are in the git history (commit `97383a2`).

## Performance

The scene is built from a lot of small pieces, so the static ones are merged into a few big meshes (about 4,300 draw calls became about 950 in the lobby view, half that in the hall), monsters are merged per moving part, materials are cheap lit ones, there are only a few real lights (three that follow you, one flashlight beam), the lobby's panels and the doors' buttons only exist while you are near them, and path-finding uses a binary heap.
