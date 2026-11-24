import { SETTING_ROWS } from '../ui/menu';
import type { Settings, SettingsData } from '../settings';
import type { MapMarker, MapView } from '../world/mapview';
import { RECIPES, type Journal, type Recipe } from './journal';

/** Pixel size of one page face; the page is 0.2 m by 0.27 m. */
export const FACE_W = 512;
export const FACE_H = 692;
/** Two faces per spread, nine spreads: the inside covers and eight leaves. */
export const FACE_COUNT = 18;
/** Which face is which (the left page of a spread is even). */
export const FACE = { cover: 0, recipesA: 1, recipesB: 2, tools: 3, plansA: 4, plansB: 5, plan: 6, ropes: 7, survival: 8, wildlife: 9, map: 10, places: 11, settingsA: 12, settingsB: 13, controlsA: 14, controlsB: 15, notes: 16, back: 17 } as const;

/** A pokeable region of a page, in page pixels. */
export interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
  /** What it does, for example `craft:torch`, `set:grass:false`, `page:next`. */
  id: string;
}

/** What the blueprint pages show. Filled in by the building system. */
export interface BlueprintView {
  list: Array<{ id: string; name: string; blurb: string; needs: string; locked?: boolean }>;
  active: null | {
    id: string;
    name: string;
    /** Placed in the world yet? */
    placed: boolean;
    steps: Array<{ text: string; done: boolean }>;
  };
}

export interface FaceContext {
  journal: Journal;
  settings: Settings;
  craft: { smashes: number; lashing: number; smashesNeeded: number };
  seed: number;
  clock: string;
  phase: string;
  day: number;
  map: MapView | null;
  markers: ReadonlyArray<MapMarker>;
  player: { x: number; z: number; heading: number };
  blueprints: BlueprintView | null;
}

const INK = '#3b2a1a';
const SOFT = '#5a4128';
const FAINT = '#8a7a5c';
const PAPER = '#e9dcbd';
const LEATHER = '#6a3e22';
const GREEN = '#2f7d36';
const GOLD = '#b9902f';

const CONTROLS: Array<[string, string]> = [
  ['Move', 'No walking. Push off the ground, trunks and rocks with your hands. Pull back to go forward, push down to jump, let go to launch.'],
  ['Grip', 'Squeeze to pick up sticks, stones, rope and this book. Let go to drop, or swing and let go to throw.'],
  ['Trigger', 'Hold it while you work: smashing stone on stick, winding rope, tying a joint.'],
  ['This book', 'Squeeze at your hip to take it out, let go to put it away. Poke buttons with your free hand. Swipe the page edge or push a thumbstick to turn pages.'],
  ['Stash', 'Hold a stick to the book and let go.'],
  ['Fire', 'Rub two sticks together over a pile of five or more.'],
  ['Ropes', 'Grab a rope hanging from a tree and pull it down hard.'],
  ['Swim', 'In deep water pull your hands back through it, like a stroke.'],
  ['Eat', 'Raise fruit or meat to your mouth.'],
  ['Measure', 'Both grips held, arms out wide, for a second and a half.'],
];

type Ctx = CanvasRenderingContext2D;

/** Draws one page face and returns the regions that can be poked. */
export function drawFace(index: number, c: Ctx, f: FaceContext, hover: string | null): Hit[] {
  const hits: Hit[] = [];
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = PAPER;
  c.fillRect(0, 0, FACE_W, FACE_H);
  // A soft shading toward the spine, and a border.
  const left = index % 2 === 0;
  const grad = c.createLinearGradient(left ? FACE_W : 0, 0, left ? FACE_W - 60 : 60, 0);
  grad.addColorStop(0, 'rgba(90,60,30,0.22)');
  grad.addColorStop(1, 'rgba(90,60,30,0)');
  c.fillStyle = grad;
  c.fillRect(0, 0, FACE_W, FACE_H);
  c.strokeStyle = LEATHER;
  c.lineWidth = 6;
  c.strokeRect(3, 3, FACE_W - 6, FACE_H - 6);
  c.textBaseline = 'alphabetic';

  switch (index) {
    case FACE.cover: coverInside(c, f); break;
    case FACE.recipesA: recipes(c, f, hits, hover, 0); break;
    case FACE.recipesB: recipes(c, f, hits, hover, 4); break;
    case FACE.tools: tools(c, f); break;
    case FACE.plansA: structures(c, f, hits, hover, 0); break;
    case FACE.plansB: structures(c, f, hits, hover, 4); break;
    case FACE.plan: plan(c, f, hits, hover); break;
    case FACE.ropes: ropesAndTies(c); break;
    case FACE.survival: survival(c); break;
    case FACE.wildlife: wildlife(c); break;
    case FACE.map: mapPage(c, f); break;
    case FACE.places: mapNotes(c, f); break;
    case FACE.settingsA: settingsPage(c, f, hits, hover, [0, 1]); break;
    case FACE.settingsB: settingsPage(c, f, hits, hover, [2]); startOver(c, hits, hover); break;
    case FACE.controlsA: controls(c, 'Controls', CONTROLS.slice(0, 4)); break;
    case FACE.controlsB: controls(c, 'Controls, continued', CONTROLS.slice(4)); break;
    case FACE.notes: notes(c, f); break;
    default: backCover(c); break;
  }
  footer(c, index, hits, hover);
  return hits;
}

// --- Drawing helpers ------------------------------------------------------------

function heading(c: Ctx, text: string, size = 38): void {
  c.fillStyle = INK;
  c.textAlign = 'left';
  c.font = `bold ${size}px Georgia, serif`;
  c.fillText(text, 30, 62);
  c.strokeStyle = GOLD;
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(30, 76);
  c.lineTo(FACE_W - 30, 76);
  c.stroke();
}

/** Draws `text` wrapped to `width`, returns the y of the line after the last. */
function wrap(c: Ctx, text: string, x: number, y: number, width: number, lineHeight: number): number {
  const words = text.split(' ');
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (c.measureText(test).width > width && line) {
      c.fillText(line, x, y);
      y += lineHeight;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) {
    c.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}

function roundRect(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

interface ButtonStyle {
  on?: boolean;
  disabled?: boolean;
  color?: string;
  size?: number;
}

function button(c: Ctx, hits: Hit[], hover: string | null, id: string, label: string, x: number, y: number, w: number, h: number, style: ButtonStyle = {}): void {
  const isHover = hover === id && !style.disabled;
  c.fillStyle = style.disabled ? '#b9ad8e' : style.on ? GOLD : isHover ? lighten(style.color ?? '#7a5a3a') : (style.color ?? '#7a5a3a');
  roundRect(c, x, y, w, h, 10);
  c.fill();
  if (isHover) {
    c.strokeStyle = '#fff3b0';
    c.lineWidth = 4;
    c.stroke();
  }
  c.fillStyle = style.disabled ? '#7f7358' : style.on ? '#2a1d08' : '#f6f0d8';
  c.font = `bold ${style.size ?? 22}px system-ui, sans-serif`;
  c.textAlign = 'center';
  c.fillText(label, x + w / 2, y + h / 2 + (style.size ?? 22) * 0.35);
  c.textAlign = 'left';
  if (!style.disabled) hits.push({ x, y, w, h, id });
}

function lighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.min(255, v + 36);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function footer(c: Ctx, index: number, hits: Hit[], hover: string | null): void {
  c.fillStyle = FAINT;
  c.font = 'italic 18px Georgia, serif';
  c.textAlign = 'center';
  c.fillText(String(index + 1), FACE_W / 2, FACE_H - 22);
  if (index % 2 === 0 && index > 0) button(c, hits, hover, 'page:prev', '‹ Back', 22, FACE_H - 62, 110, 40, { size: 20, color: LEATHER });
  if (index % 2 === 1 && index < FACE_COUNT - 1) button(c, hits, hover, 'page:next', 'Next ›', FACE_W - 132, FACE_H - 62, 110, 40, { size: 20, color: LEATHER });
  c.textAlign = 'left';
}

function para(c: Ctx, text: string, y: number, size = 21, color = SOFT, x = 30, width = FACE_W - 60): number {
  c.fillStyle = color;
  c.font = `${size}px Georgia, serif`;
  c.textAlign = 'left';
  return wrap(c, text, x, y, width, size * 1.35);
}

// --- Pages ------------------------------------------------------------------------

function coverInside(c: Ctx, f: FaceContext): void {
  c.fillStyle = INK;
  c.textAlign = 'center';
  c.font = 'bold 50px Georgia, serif';
  c.fillText('Field Journal', FACE_W / 2, 150);
  c.font = 'italic 24px Georgia, serif';
  c.fillStyle = SOFT;
  c.fillText('kept by one who climbs', FACE_W / 2, 190);
  c.strokeStyle = GOLD;
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(110, 215);
  c.lineTo(FACE_W - 110, 215);
  c.stroke();
  c.fillStyle = INK;
  c.font = 'bold 84px Georgia, serif';
  c.fillText(String(f.journal.stash), FACE_W / 2, 340);
  c.font = '26px Georgia, serif';
  c.fillText(f.journal.stash === 1 ? 'stick in the book' : 'sticks in the book', FACE_W / 2, 380);
  c.textAlign = 'left';
  let y = 450;
  y = para(c, 'Hold a stick up to the book and let go to put it in.', y, 22) + 8;
  y = para(c, 'Poke a recipe on the next page to make it. Recipes stay locked until you have done what they ask.', y, 22);
}

function recipes(c: Ctx, f: FaceContext, hits: Hit[], hover: string | null, start: number): void {
  heading(c, start === 0 ? 'Recipes' : 'Recipes, continued');
  const shown = RECIPES.slice(start, start + 4);
  if (shown.length === 0) para(c, 'That is everything so far.', 112);
  shown.forEach((recipe, i) => recipeRow(c, f, hits, hover, recipe, 96 + i * 134));
}

function recipeRow(c: Ctx, f: FaceContext, hits: Hit[], hover: string | null, recipe: Recipe, top: number): void {
  const status = f.journal.status(recipe);
  const locked = status === 'locked';
  const id = `craft:${recipe.id}`;
  c.fillStyle = locked ? '#cdbf9f' : hover === id ? '#f6ecd0' : '#f1e6c8';
  roundRect(c, 22, top, FACE_W - 44, 122, 14);
  c.fill();
  c.strokeStyle = hover === id && !locked ? '#b5502f' : '#a99468';
  c.lineWidth = hover === id ? 4 : 2;
  c.stroke();

  c.textAlign = 'left';
  c.fillStyle = locked ? FAINT : INK;
  c.font = 'bold 30px Georgia, serif';
  c.fillText(locked ? '???' : recipe.name, 40, top + 40);
  if (f.journal.fresh.has(recipe.id)) {
    c.fillStyle = '#d9a21b';
    roundRect(c, 40 + c.measureText(recipe.name).width + 12, top + 16, 58, 26, 8);
    c.fill();
    c.fillStyle = INK;
    c.font = 'bold 16px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillText('NEW', 40 + c.measureText(recipe.name).width + 41, top + 35);
    c.textAlign = 'left';
  }
  c.fillStyle = locked ? '#7f6f52' : SOFT;
  c.font = '19px Georgia, serif';
  wrap(c, locked ? `Locked: ${recipe.hint}` : `${recipe.cost} sticks. ${recipe.blurb}`, 40, top + 68, 290, 25);
  if (!locked) {
    const ready = status === 'ready';
    button(c, hits, hover, id, ready ? 'CRAFT' : `NEED ${recipe.cost - f.journal.stash}`, 350, top + 30, 140, 62, {
      color: ready ? GREEN : '#9a7b3a',
      disabled: !ready,
    });
  }
}

function tools(c: Ctx, f: FaceContext): void {
  heading(c, 'Tools');
  let y = 112;
  c.fillStyle = INK;
  c.font = 'bold 25px Georgia, serif';
  c.fillText('Stone axe', 30, y);
  y += 12;
  y = para(c, 'Take a stone in one hand and a stick in the other. Hold a trigger and smash the stone against the stick, twice. An outline shows on the stick as a hint.', y + 12, 20);
  c.fillStyle = f.craft.smashes > 0 ? GREEN : FAINT;
  c.font = 'bold 21px Georgia, serif';
  c.fillText(`Smashes: ${f.craft.smashes} of ${f.craft.smashesNeeded}`, 30, y + 6);
  y += 44;
  c.fillStyle = INK;
  c.font = 'bold 25px Georgia, serif';
  c.fillText('Chopping', 30, y);
  y = para(c, 'Swing the axe hard into a trunk. Chips fly, logs come loose and after enough blows the whole tree comes down. Every swing wears the axe.', y + 14, 20);
  y += 20;
  c.fillStyle = INK;
  c.font = 'bold 25px Georgia, serif';
  c.fillText('Stronger axe', 30, y);
  y = para(c, 'Find a rope on a tree and pull it down. Hold the axe in one hand and the rope in the other, hold both triggers and wind the rope round the head with your hand.', y + 14, 20);
  c.fillStyle = f.craft.lashing > 0 ? GREEN : FAINT;
  c.font = 'bold 21px Georgia, serif';
  c.fillText(`Winding: ${Math.round(f.craft.lashing * 100)}%`, 30, y + 6);
}

function structures(c: Ctx, f: FaceContext, hits: Hit[], hover: string | null, start: number): void {
  heading(c, start === 0 ? 'Structures' : 'Structures, continued');
  const bp = f.blueprints;
  if (!bp || bp.list.length === 0) {
    para(c, 'No plans yet.', 120);
    return;
  }
  if (start === 0) para(c, 'Choose a plan. It is placed in the world where you point, then you gather what it needs and put it together.', 100, 19, SOFT);
  bp.list.slice(start, start + 4).forEach((plan, i) => {
    const top = (start === 0 ? 168 : 100) + i * 112;
    const id = `bp:select:${plan.id}`;
    const chosen = bp.active?.id === plan.id;
    c.fillStyle = plan.locked ? '#cdbf9f' : hover === id ? '#f6ecd0' : '#f1e6c8';
    roundRect(c, 22, top, FACE_W - 44, 104, 14);
    c.fill();
    c.strokeStyle = chosen ? GOLD : '#a99468';
    c.lineWidth = chosen ? 5 : 2;
    c.stroke();
    c.fillStyle = plan.locked ? FAINT : INK;
    c.textAlign = 'left';
    c.font = 'bold 25px Georgia, serif';
    c.fillText(plan.name, 38, top + 30);
    c.fillStyle = SOFT;
    c.font = '15px Georgia, serif';
    const y = wrap(c, plan.blurb, 38, top + 52, 310, 18);
    c.fillStyle = FAINT;
    c.font = 'italic 14px Georgia, serif';
    wrap(c, plan.needs, 38, y + 2, 310, 17);
    if (!plan.locked) button(c, hits, hover, id, chosen ? 'ACTIVE' : 'SET PLAN', 360, top + 24, 128, 56, { color: GREEN, on: chosen, size: 20 });
  });
}

function plan(c: Ctx, f: FaceContext, hits: Hit[], hover: string | null): void {
  heading(c, 'The Plan');
  const active = f.blueprints?.active;
  if (!active) {
    para(c, 'Choose a structure on the facing page. Its steps will be listed here.', 112);
    return;
  }
  c.fillStyle = INK;
  c.font = 'bold 30px Georgia, serif';
  c.fillText(active.name, 30, 118);
  c.font = 'italic 19px Georgia, serif';
  c.fillStyle = SOFT;
  c.fillText(active.placed ? 'Standing in the world. Build it step by step.' : 'Point where you want it and pull the trigger.', 30, 146);
  let y = 190;
  c.font = '21px Georgia, serif';
  for (const step of active.steps) {
    c.fillStyle = step.done ? GREEN : INK;
    c.font = 'bold 24px Georgia, serif';
    c.fillText(step.done ? '✔' : '○', 30, y);
    c.fillStyle = step.done ? FAINT : INK;
    c.font = '21px Georgia, serif';
    y = wrap(c, step.text, 66, y, FACE_W - 100, 27) + 12;
    if (y > FACE_H - 150) break;
  }
  button(c, hits, hover, 'bp:cancel', 'GIVE UP THIS PLAN', 122, FACE_H - 128, 268, 52, { color: '#8a3a22', size: 20 });
}

function ropesAndTies(c: Ctx): void {
  heading(c, 'Rope and ties');
  let y = 112;
  y = para(c, 'Some trees have a rope hanging down their trunk. Grab the lower end and pull down about a third of a metre. Let go too soon and it springs back.', y, 20) + 10;
  y = para(c, 'To tie a joint, hold the rope in one hand near it, hold the trigger and circle the rope around it with your hand.', y, 20) + 10;
  y = para(c, 'Building: stand an upright post in its place, then pound it into the ground with a stone or axe, three blows. Sideways pieces just rest where they go, and you tie them with rope. Roofs take leaves, torn from bushes; walls take mud, scooped from the banks of a lake.', y, 19) + 10;
  para(c, 'Rope is precious: one rope lashes an axe or ties one joint.', y, 19, FAINT);
}

function survival(c: Ctx): void {
  heading(c, 'Staying alive');
  let y = 112;
  y = para(c, 'Your health shows on the gauge on your left forearm. It mends slowly when you are not hurt.', y, 21) + 12;
  y = para(c, 'Food: fruit from the bushes and trees, and meat. Raise it to your mouth to eat. Raw meat is a poor meal: leave it lying out for one day and it is roasted, which feeds you well.', y, 21) + 12;
  y = para(c, 'Leave it for two days and it rots. Rotten meat poisons you.', y, 21, '#8a3a22') + 12;
  y = para(c, 'Build a shelter and rest in it. If you die you wake up at the last shelter you rested in.', y, 21) + 12;
  para(c, 'A mirror lets you see what you look like. Craft one in the book.', y, 21, FAINT);
}

function wildlife(c: Ctx): void {
  heading(c, 'Water and wildlife');
  let y = 112;
  y = para(c, 'Lakes are deep. Pull your hands back through the water to swim.', y, 21) + 12;
  y = para(c, 'Leeches cling on in the water and drain you. Grab one with your free hand and pull it off.', y, 21) + 12;
  y = para(c, 'About one lake in ten is home to a crocodile. It hunts what is in or near the water. Stay out of the lake, or fight it with a spear or axe.', y, 21, '#8a3a22') + 12;
  y = para(c, 'Rabbits and deer run from you. Hit them with a weapon, or throw a spear, and they drop meat.', y, 21) + 12;
  para(c, 'Weapons: stick, club, knife, spear, axe. Heavier swings hurt more.', y, 21, FAINT);
}

function mapPage(c: Ctx, f: FaceContext): void {
  heading(c, 'Map');
  if (f.map) f.map.draw(c, 26, 96, 460, 460, f.player, f.markers);
  c.fillStyle = INK;
  c.font = 'bold 22px Georgia, serif';
  c.textAlign = 'center';
  c.fillText('N', FACE_W / 2, 90);
  c.font = '19px Georgia, serif';
  c.fillStyle = SOFT;
  c.fillText('Only what you have walked near is drawn.', FACE_W / 2, 594);
  c.textAlign = 'left';
}

function mapNotes(c: Ctx, f: FaceContext): void {
  heading(c, 'Places found');
  const found = f.markers.filter((m) => m.discovered);
  let y = 118;
  if (found.length === 0) {
    para(c, 'Nothing yet. Old things are scattered through the forest. Look for them, and they will be drawn here.', y, 21);
  }
  for (const m of found.slice(0, 7)) {
    const dx = m.x - f.player.x;
    const dz = m.z - f.player.z;
    const dist = Math.round(Math.hypot(dx, dz));
    const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((Math.atan2(dx, -dz) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
    c.fillStyle = '#7a2a1a';
    c.font = 'bold 22px Georgia, serif';
    c.fillText('◆', 30, y);
    c.fillStyle = INK;
    c.font = 'bold 23px Georgia, serif';
    c.fillText(m.label, 62, y);
    c.fillStyle = SOFT;
    c.font = '19px Georgia, serif';
    c.fillText(`${dist} m ${compass}`, 62, y + 26);
    y += 62;
  }
  const hidden = f.markers.length - found.length;
  if (hidden > 0) {
    c.fillStyle = FAINT;
    c.font = 'italic 20px Georgia, serif';
    c.fillText(`${hidden} more to find.`, 30, Math.max(y + 10, 118));
  }
}

function settingsPage(c: Ctx, f: FaceContext, hits: Hit[], hover: string | null, groups: number[]): void {
  heading(c, groups.length === 2 ? 'Settings' : 'Settings, you');
  let y = 100;
  for (const g of groups) {
    const group = SETTING_ROWS[g];
    c.fillStyle = '#7a5a2a';
    c.font = 'bold 16px system-ui, sans-serif';
    c.textAlign = 'left';
    c.fillText(group.title.toUpperCase(), 30, y + 14);
    y += 22;
    for (const row of group.rows) {
      c.fillStyle = INK;
      c.font = '21px Georgia, serif';
      c.fillText(row.label, 30, y + 22);
      const options: Array<[string | boolean | number, string]> =
        row.kind === 'choice'
          ? row.options.map(([v, label]) => [v, label.replace('Always day', 'All day').replace('Left hip', 'Left').replace('Right hip', 'Right')])
          : [[0, 'Off'], [0.25, '25%'], [0.5, '50%'], [0.75, '75%'], [1, 'Full']];
      const current = f.settings.data[row.key];
      const w = (FACE_W - 60 - (options.length - 1) * 6) / options.length;
      options.forEach(([value, label], i) => {
        const on = row.kind === 'slider' ? Math.abs(Number(current) - Number(value)) < 0.13 : current === value;
        button(c, hits, hover, `set:${String(row.key)}:${String(value)}`, label, 30 + i * (w + 6), y + 28, w, 46, { on, size: 17, color: '#7a5a3a' });
      });
      y += 80;
    }
  }
}

function startOver(c: Ctx, hits: Hit[], hover: string | null): void {
  const y = 450;
  c.fillStyle = '#7a5a2a';
  c.font = 'bold 16px system-ui, sans-serif';
  c.fillText('START OVER', 30, y + 14);
  button(c, hits, hover, 'reset:arms', 'Measure my arms again', 30, y + 28, FACE_W - 60, 46, { size: 19, color: '#8a5a3a' });
  button(c, hits, hover, 'reset:book', 'Forget unlocked recipes', 30, y + 84, FACE_W - 60, 46, { size: 19, color: '#8a3a22' });
  para(c, 'World settings apply to a new forest.', y + 150, 18, FAINT);
}

function controls(c: Ctx, title: string, items: Array<[string, string]>): void {
  heading(c, title);
  let y = 118;
  for (const [term, text] of items) {
    c.fillStyle = INK;
    c.font = 'bold 24px Georgia, serif';
    c.fillText(term, 30, y);
    y = para(c, text, y + 26, 20) + 18;
  }
}

function notes(c: Ctx, f: FaceContext): void {
  heading(c, 'Notes');
  let y = 118;
  const line = (label: string, value: string) => {
    c.fillStyle = FAINT;
    c.font = '19px Georgia, serif';
    c.fillText(label, 30, y);
    c.fillStyle = INK;
    c.font = 'bold 26px Georgia, serif';
    c.fillText(value, 30, y + 32);
    y += 76;
  };
  line('This forest', `seed ${f.seed}`);
  line('Time', `Day ${f.day}, ${f.clock} (${f.phase})`);
  line('Sticks in the book', String(f.journal.stash));
  line('Recipes found', `${f.journal.unlocked.size} of ${RECIPES.length}`);
}

function backCover(c: Ctx): void {
  c.fillStyle = INK;
  c.textAlign = 'center';
  c.font = 'bold 34px Georgia, serif';
  c.fillText('Good luck out there.', FACE_W / 2, 220);
  c.font = 'italic 22px Georgia, serif';
  c.fillStyle = SOFT;
  c.fillText('Swing high. Climb well. Keep a fire.', FACE_W / 2, 270);
  c.textAlign = 'left';
}

/** Settings values arrive from the page as text. */
export function parseSettingValue(key: keyof SettingsData, text: string): boolean | number | string {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (key === 'haptics' || key === 'volume') return Number(text);
  return text;
}
