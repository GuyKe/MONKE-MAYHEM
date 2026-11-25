# LOCKDOWN

A VR horror-survival escape game for the browser (Three.js WebXR + Rapier + Vite/TypeScript, hosted on GitHub Pages). Movement is
**gorilla-tag style hand locomotion**: push off the ground, walls and ceilings with your hands to run, climb and fly. Single-player
for now; the code is laid out so multiplayer can be added.

## The game

1. **The safe zone (lobby).** You wake in a sterile steel-and-tile room. There is a
   - **registry terminal**: type your display name (on the wall keyboard with a poke or laser, or a real keyboard on the desktop), then SAVE;
   - **customization station**: a full-body mirror and a wardrobe/shop where you spend credits on suits, hats and gear;
   - **gear wall**: glowsticks, flashlights and radar pingers;
   - **a big reinforced window** over the machine hall, far below.
2. **The drop.** Hit the window hard (three good punches or throws) and it shatters. Climb out and drop onto the catwalk hanging over the hall.
3. **The hazard zone.** A vast machine hall with columns, cargo, a reactor, a catwalk loop with stairs, and heavy **blast doors** into eight side rooms. Things live here:
   - **Stalker** – tall, thin, a stretched helmet with too many eyes; drifts silently and hears movement.
   - **Skitter** – a six-legged crawler with a helmet hung upside down; fast, wide-eyed, hunts on sight.
   - **Warden** – a hulking armoured brute with one huge eye; slow, hears everything, and smashes jammed doors.
   They hunt by **sight** (stand in the light and they see you further) and by **sound**: running, landing from a height, shouting into your microphone, a radar ping, a door slamming, breaking glass. Move slowly and you stay quiet.
4. **Doors.** Each door has a panel with **OPEN / CLOSE / JAM**, and a handle you can grab and lift. Shut a door on a monster and it is stunned; jam one shut and the monsters have to batter their way through. But a closing door **crushes you instantly**, and a door you let go of half way drops.
5. **Lockdown.** Every minute or two the alarm sounds, the lights flicker red and *every door* opens and closes by itself for about 25 seconds. The alarm draws the monsters.
6. **The way out.** Restore power at the two **relays** (in the west and east rooms), then the exit gate opens. Reach the exit lift and press **EVACUATE**. You earn credits for surviving and for escaping, and keep some even when you die.

## Hand-held gear

- **Glowstick** – lights the dark; throw it to see or to lure.
- **Flashlight** – squeeze to hold, trigger to switch on. Being lit makes you easier to spot.
- **Radar pinger** – trigger to ping: blips of nearby monsters appear on its screen and buzz your hand. The ping can be heard.

## Feel

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
