# Nature Monke

A browser VR game: move around a forest with your hands, Gorilla Tag style, and pick up sticks.

Built with Three.js (WebXR), Rapier physics, Vite and TypeScript.

## Status

- [x] **Milestone 1: Scaffold.** Vite + Three.js + Rapier, Enter VR, tracked hands, Pages deploy workflow.
- [x] **Milestone 2: Hand locomotion.** Pushing off surfaces, launching, gravity, body collision, on a test course.
- [x] **Milestone 3: Forest.** Large random forest: hills, about 2,600 climbable trees, rocks, logs, grass, frozen ponds and mud puddles.
- [x] **Milestone 4: Sticks.** Grab with the grip, carry, throw. Solid sticks that collide with each other and the world.
- [x] **Beyond the plan:** day-night cycle and heavy atmosphere, and a field journal for crafting with recipes you unlock as you play.
- [x] **Second round:** main menu with settings, animals, taller and thicker trees, a physical book with a map, stone and lashed axes, rope on trees,
  blueprints you place and build, and ruins to find.
- [x] **Third round:** lakes and hills, swimming, leeches and crocodiles, hunting and food, felling trees, more weapons and plans, shelters
  you wake up in, saving, a mirror, and a gorilla body in leaf pants.
- [x] **Milestone 5, sounds:** all synthesised in the browser (no audio files), placed in 3D, with a volume setting.
- [x] **Milestone 5, comfort and performance:** a comfort vignette, reduce-motion, adjustable quality (auto by default) and sharpness, and a physics speed-up.
- [ ] Still untested: the real headset. All of this was tried in the desktop emulator.

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
| `?seed=123` | Load that forest fresh. Without it you continue your saved game, or get a new random forest if there is no save. |
| `?continue` | With `?seed`: load the save too, if it is that forest. `?fresh` ignores the save. |
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
| Q / E | Squeeze the left / right grip (grab, throw, pick berries) |
| Z / X | Squeeze the left / right trigger (smash, lash, tie) |
| B | Take out or put away the book |
| [ and ] | Flip pages (book open) or turn (book closed); Shift+[ / ] changes arm length |
| 1 to 4 | Craft a recipe (book open) |
| T | T-pose arm calibration |
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

## Second round: what is in the world now

**Menu.** The page opens on a main menu: Play (Resume after you leave VR), Settings and Controls. Settings (fog, day length, view distance, grass,
haptics, comfort) are saved in your browser and are also on a page of the book. `?play` skips the menu.

**Animals.** Rabbits bolt when you get within 8 m, deer watch you (alert at 24 m) and run, birds perch in trees and take off or circle. Only animals near you are simulated.

**Trees** are taller and thicker, with a few giants. **Ropes** hang from some trees: grab one low down and pull; it stretches, and if you keep pulling it comes free.

**Stone axe.** Grab a rock in one hand and a stick in the other, hold both triggers and smash them together five times. The axe breaks after enough chopping.
Hold a rope, put it round the axe head and circle your hand with the trigger held to lash it: a stronger axe. Swing an axe at a tree trunk to chop sticks and logs.

**The book** is a real object: take it from your hip, hold it, flip pages by poking or swiping the edges (or the thumbstick). It faces you while held. Pages cover
recipes, blueprints, settings, controls and a **map** that fills in as you explore and marks places you have found.

**Blueprints.** Open a blueprint page and press it to select it, then place the hologram where you want it. Bring the pieces (logs, poles, sticks, rope), fit each
into its slot, then tie the joints with rope. Finished structures are solid and remembered between visits.

**Ruins** (cabin, standing stones, abandoned camp, fallen lookout) are scattered across the map, with loot such as ropes, stones and sometimes an axe. Walking
up to one discovers it and marks it on the map. The lookout's platform can be climbed.

For performance, sticks, stones and ropes further than 100 m are not drawn.

## Third round: survival

**Hills and lakes.** The ground is hillier, and about nine lakes are dug into it: deep bowls with sandy banks and muddy floors. The nearest is a short walk
from the start. Rocks, trees and sticks keep out of the water.

**Swimming.** Where the water is deeper than your feet can find, you swim: pull your hands back through the water like a stroke and you glide forward (recover
your hands above the surface, or you pull yourself back). Under the surface the view goes blue.

**Leeches.** Wading or swimming for a while can put a leech on a hand. It drains your health until you close your other hand on it and pull it off.
**Crocodiles.** Each lake has a one in ten chance of one (decided by the forest's seed). It lurks with its eyes above the water; if you are in the lake, or near
its edge, it comes for you, fast in water and slower on land, and it will not follow you far from the shore. It bites hard. Kill it for meat.

**Health.** A gauge on your left forearm shows health, poison and leeches. Health mends slowly when nothing is hurting you. The screen flashes red when you are
hit. If you die you wake at the last shelter you rested in (a lean-to, stick hut or sleeping platform: stand inside for three seconds), or at the start.

**Food.** Berry bushes grow all over; close your grip on a berry to pick it (it grows back in a day or two). Raise fruit or meat to your mouth to eat it.
Rabbits and deer drop meat when killed (a crocodile drops more). Meat left lying out for **one day** is roasted and feeds you well; at **two days** it is rotten
and poisons you. A drying rack makes it go twice as fast. (A day is the length set in Settings.)

**Weapons.** Anything you swing hard enough hurts animals: sticks a little, then knife (quick), spear (also thrown), axe, club (hits hardest). Bare hands do a little.
The knife, club and mirror are recipes in the book, unlocked by making an axe, chopping a log, and swimming.

**Axes and trees.** Hold a stick and squeeze its trigger: an outline of a stone appears on the tip. Smash a stone into it three times for an axe. Swinging an axe
into a trunk takes chips off it; thick trunks need more blows, and a lashed axe fewer. Eventually the tree falls away from you, leaving a stump, and logs
and sticks lie along it. Birds leave a felled tree, and any rope hanging on it comes down.

**More plans.** Stick Hut and Sleeping Platform (shelters), Drying Rack and Log Fence, each unlocked by finishing another. Structures are saved.

**Mirror.** Craft one, hold it up, and you see yourself: a gorilla with a leaf crown and feathers. The reflection is drawn only while a mirror is near.

**Your body.** Gorilla arms with elbows, long fingers, leaf bands on the wrists, a chest with a tooth necklace and a skirt of leaves.

**Saving.** The game saves every five minutes while you play, and when you leave VR or close the tab. The main menu then offers **Continue** (with how far you
got), **Save Game**, and **New forest**, which asks twice before deleting the save. What is saved: where you are, health, the time, every piece lying in the world,
structures, felled trees, taken ropes and berries, campfires, the map and the places found, shelters and the crocodiles you killed. Opening the page with
`?seed=123` gives that forest fresh without touching your save (add `&continue` to load the save if it matches); `?fresh` ignores the save.

**Leaves.** Fallen leaves lie under the trees, drift down through the air near you, and the broadleaf trees are fuller, some hung with vines. Ferns and flowers
grow among the grass.

## Sound

`src/audio.ts`. Everything is made on the spot with Web Audio from filtered noise and tones, so there is nothing to download. Sounds start when you press
Play (browsers only allow audio after a click) and are positioned in 3D around your head.

- **Hands:** a different sound for stone, ice, mud, wood, bark and ground, louder the harder you land.
- **Tools:** chopping, stone on stone, a tree creaking, then crashing down; rope tearing; parts fitting into a structure; a tool breaking.
- **Body:** a whoosh when you throw, a splash going into or out of water and strokes while swimming (everything is muffled under water), eating crunches, a
  grunt when hurt, a snap when a crocodile bites, a squelch for leeches.
- **Forest:** wind (louder when you fly), birds by day, crickets and the odd owl by night, lapping water near a lake, a crackling campfire, the rasp of
  rubbing sticks.
- **Book:** page turns, and chimes when something unlocks or you find a place.

Volume is in Settings (menu or book).

## Building and materials (latest)

**Axe.** Take a stone in one hand and a stick in the other, hold either trigger and smash the stone against the stick twice. The outline on the stick tip is only
a hint now: the smash works anywhere along it.

**Building.** Choose a plan in the book and place it. Then, by kind of part:
- **Upright wood** (posts): stand it in its place, then pound it into the ground by hitting the top three times with a stone, an axe, a club or a log.
- **Sideways wood** (beams, rails, sticks): just lay it where it goes, then **tie** it with rope.
- **Leaves** (thatch roofs, such as the stick hut): tear a handful from a bush with your grip and lay it in place.
- **Mud** (walls, ovens): scoop it from the ground along a lake's banks with your grip and press it into place.

New plans: **Mud Wall**, and the **Mud Oven**, which roasts meat near it six times as fast (it does not rot it any faster afterwards).

**Textures.** The ground, bark, rock, foliage and wood now have procedural textures (grain, cracks, patches), and there is a much thicker carpet of fallen leaves,
especially under the broadleaf trees.

## Barns, spears, spits and the logger (latest)

**Stick sizes.** Sticks are small, medium, large or long (a long one is 1.5–2 m). The game tells you which you picked up. The throwing-spear recipe is gone from
the book: a spear now has to be made from a long stick.

**Spear.** Hold a long stick in one hand and a stone in the other, hold a trigger and rub the stone along the thin tip of the stick for a few seconds (the book
shows the progress). The stone is kept. Axes are made from the shorter sticks.

**Abandoned barns.** Weathered board walls, a half-fallen roof, hay bales and crates, with good loot inside: an axe, knife, club, ropes, long sticks, stones,
logs and a torch. Three or so per forest, shown on the map once found.

**The wood-cutting vehicle.** One barn in 138 has a little yellow tractor with a circular saw on the front (the odds are rolled when the forest is made; add
`?logger` to the URL to put one in every barn). Squeeze the handlebar to climb on. It goes where you face; push your gripping hand forward to speed up and pull
it back to slow and reverse. Squeeze a trigger to spin the saw: any tree it reaches comes down, with logs and sticks. Let go to climb off. It stops at tree trunks
and the water's edge.

**Roasting spit** (plan unlocked by the drying rack). Two posts either side of a campfire, with a long stick across and a crank at one end. Kill an animal, let go
of the meat over the rod to put it on, and turn the crank by hand (grip the end and circle it): about a dozen turns roast the meat, if the fire is right under it.
Take it off with your grip. Rest a stone on the lever and it keeps turning by itself, but each time round the stone may slip off.

## Comfort and performance

Settings are under **Comfort and speed** (main menu, or the book's settings pages).

- **Thumbstick turning** (off / snap / smooth): push the **right thumbstick** sideways. Snap turns in steps of 30, 45 or 90 degrees; smooth turns at slow, medium
  or fast (60, 110 or 180 degrees a second). It is switched off while the book is open (the stick turns pages) and while you are placing a plan (it turns the
  hologram). Turning your head always works too. The default is snap, 45 degrees.
- **Comfort vignette** (off / low / medium / high): the edges of the view darken and the clear circle closes in when you are moving fast (launching, falling,
  riding the logger) or turning your head quickly. It comes on fast and fades gently.
- **Reduce motion:** no drifting dust, fireflies or falling leaves.
- **Quality** (auto / high / medium / low): each level changes how far the forest, grass, loose pieces, animals and falling leaves are drawn. **Auto** watches
  how long frames take (against the headset's refresh rate) and steps down when they run long and back up when there is room. The desktop emulator is too slow to
  judge by, so it stays on high unless you add `?autoquality`.
- **Sharpness** (soft / normal / sharp): render resolution 0.8 / 1.0 / 1.2 of the headset's default, applied the next time you enter VR.

What the performance pass changed:
- **Physics:** pieces lying still are put to sleep (and ones that jitter against the ground are calmed and slept), and a piece you hold wakes anything asleep
  next to it. A physics step went from about 3.8 ms to 1.4 ms in the emulator with 530 pieces. Put-away pieces are dropped from the lists.
- **Per-frame work:** a few allocations in the main loop removed; texture filtering lowered to 2x.
- **Profiler:** add `?perf` and the readout lists where each frame's time goes (physics, forest, animals, render submission...), with the current quality level.

## Multiplayer (this branch)

Up to a handful of players in one forest, with voice chat. There is no game server: players connect directly to each other with WebRTC, using
[PeerJS](https://peerjs.com/) only to introduce them (its free public broker by default).

**Hosting and joining.** Main menu → **Multiplayer**. **Host a game** gives you a four-letter code to read out. A friend types it under **Join a game**
(or opens `?join=CODE`); the page reloads into *your* forest, with everything as it is now, and they appear where you are. Your own saved game is not touched
(guests do not autosave; the host's saves carry on as usual). `?host` starts hosting straight away; `?signal=host:port` uses your own PeerJS server (testing).

**How it is kept the same.** Every machine builds the forest from the same seed, and the host sends its whole world to a joiner in one go (the same data as a
save). After that:
- **Players** are gorillas with a name over their head (a colour each), moving as the real player does, head, arms and hands, 20 times a second.
- **Pieces** (sticks, stones, tools, food, meat): every one has a name that is the same everywhere. Making, putting away and moving are sent. Whoever last picked a
  piece up looks after its physics (it is sent as it flies) until it comes to rest, then the host does.
- **Animals and crocodiles** are simulated on the host and followed by everyone; they keep away from, or go for, whichever player is nearest. Hits from guests go to
  the host, which handles the kill, so the meat is made once and shared.
- **The world**: felled trees, ropes and berries taken, campfires, structures (parts that go in on one machine go in on all), the time of day and the wood-cutting
  vehicle's position. Health, hunger-style effects, the book, the map and recipes belong to each player.

**Saving as host.** The multiplayer screen has **Save the game now** (it saves the whole shared world, including what your guests built, made and moved, and tells them),
and **Autosave while hosting** (on by default, every five minutes; turn it off if you would rather save by hand). Stopping the host saves too. Next time, press Continue
and host again to carry on with the same world. Guests never save.

**Voice.** Press Play and the browser (or headset) asks for the microphone. Each pair of players has a direct call; a voice comes from where that player's head is
(near is loud, far is faint) and their name pulses while they talk. Mute from the menu or with **M**.

**Limits.** It needs a browser that can do WebRTC and (for voice) HTTPS or localhost. Players behind strict NATs may not be able to connect (there is no relay
server). Birds, the meat on a roasting spit, particles and the map are not shared. Everything was tested with two browser pages on one machine, not across the
internet or on headsets.

## Pause menu

Press **B or Y** (the upper face button on either controller; **P** on the desktop) and a panel floats in front of you. Point at it with the **laser** that comes out of each
controller (the button under the dot lights up; pull the **trigger** to press it), or just poke it with a hand. It offers: **Resume**, **Save game**, **Settings** (every
setting, by group), **Multiplayer** (your code, who is here, mute the microphone), **Controls**, and **Quit to main menu** (which takes the headset back to the
menu; Resume there picks up where you were). Poke a button with a hand to press it; press the button again to close it.

Playing alone, the whole world stops while it is open: the clock, animals, physics and your hands' grip. In a multiplayer game it cannot stop (the others carry on), so
the world keeps going while you use it.

The same lasers work on the **book**: while it is open, aim a beam at a button on its pages (it lights up) and pull the trigger. Poking with a finger and swiping the page
edge still work too.

## Redeem code and admin tools

The main menu has an **Enter code** box, and the pause menu has an **Enter code** button (a letter-and-number keypad you poke). Redeem **SECRETADMIN123** and an **Admin**
button replaces it in the pause menu (it stays unlocked in this browser). Admin has:
- **Spawn items:** every kind of piece (sticks of each size, pole, log, stone, rope, leaves, mud, torch, spear, both axes, club, knife, mirror, fruit, meat raw/roast/rotten),
  one, five or ten at a time, in front of you.
- **Spawn animals:** rabbit or deer (not on a joined player's machine, where the host runs the animals), and a campfire.
- **Build a structure:** any plan, finished, in front of you (it is shared in multiplayer like anything else built).
- **Car:** the wood-cutting vehicle, brought to you (or made, if the forest has none).
- **Powers:** heal fully, unlock every recipe and plan, make it day or night.

The code is checked in the browser, so it is a convenience, not security.

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

## Lobby and modes

The game now opens in a **lobby**: you spawn on a long black platform. Walk (or swing) up it to the statues:

- **Jungle** – a stone statue of the jungle player holding a stick. Press **PLAY** to enter the jungle game (its main menu appears).
- **Horror** – to its right, a statue of a scared player with a flashlight, with a smiling bloody monster standing behind it. Press **PLAY** to enter the horror facility.

Press the world-space buttons by poking them or with the laser pointer.

**Horror facility**: a dark maze with a green *safe room* (the monster never enters; it lurks at the door, then wanders off). Find the **exit lift** to escape. Your flashlight (right hand) slows the monster when you shine it on it. **BACK TO LOBBY** is on the wall at the start; the jungle main menu has one too.

URLs: `?mode=hub` (default), `?mode=jungle` (older `?play`/`?seed=`/`?join=` links still open the jungle), `?mode=horror`.
