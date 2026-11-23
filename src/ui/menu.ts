import type { Settings, SettingsData } from '../settings';

export interface MenuHooks {
  /** The Play (or Resume) button. */
  onPlay(): void;
  /** Start again in a brand new forest. */
  onNewWorld(): void;
  /** Forget the saved arm span so it is measured again. */
  onResetArms(): void;
  /** Forget the unlocked recipes and blueprints. */
  onResetBook(): void;
  /** Writes the game now. Returns false if it could not be stored. */
  onSave(): boolean;
  /** Throws the saved game away. */
  onDeleteSave(): void;
}

type Screen = 'home' | 'settings' | 'controls';

interface ChoiceRow {
  kind: 'choice';
  key: keyof SettingsData;
  label: string;
  options: Array<[string | boolean, string]>;
  note?: string;
}
interface SliderRow {
  kind: 'slider';
  key: keyof SettingsData;
  label: string;
}

/** The settings, grouped. Also drawn on the pages of the book, so the list lives here. */
export const SETTING_ROWS: Array<{ title: string; rows: Array<ChoiceRow | SliderRow> }> = [
  {
    title: 'Graphics',
    rows: [
      { kind: 'choice', key: 'viewDistance', label: 'View distance', options: [['low', 'Short'], ['medium', 'Medium'], ['high', 'Far']] },
      { kind: 'choice', key: 'grass', label: 'Grass', options: [[true, 'On'], [false, 'Off']] },
      { kind: 'choice', key: 'atmosphere', label: 'Fog and mist', options: [['light', 'Light'], ['normal', 'Normal'], ['heavy', 'Heavy']] },
    ],
  },
  {
    title: 'World',
    rows: [
      { kind: 'choice', key: 'dayLength', label: 'Length of a day', options: [['short', '5 min'], ['normal', '10 min'], ['long', '20 min'], ['always-day', 'Always day']] },
      { kind: 'choice', key: 'treeDensity', label: 'Trees', options: [['sparse', 'Sparse'], ['normal', 'Normal'], ['dense', 'Dense']], note: 'New world' },
      { kind: 'choice', key: 'animals', label: 'Animals', options: [[true, 'On'], [false, 'Off']], note: 'New world' },
    ],
  },
  {
    title: 'You',
    rows: [
      { kind: 'slider', key: 'haptics', label: 'Controller buzz' },
      { kind: 'choice', key: 'bookSide', label: 'Book on your', options: [['left', 'Left hip'], ['right', 'Right hip']] },
      { kind: 'choice', key: 'showDebug', label: 'Info readout (desktop)', options: [[true, 'On'], [false, 'Off']] },
    ],
  },
];

const CONTROLS_VR: Array<[string, string]> = [
  ['Move', 'There is no walking. Push against the ground, trunks and rocks with your hands: pull back to go forward, push down to jump, let go to launch.'],
  ['Grip', 'Squeeze to pick up sticks, stones, rope and your book. Let go to drop, or swing and let go to throw.'],
  ['Trigger', 'Hold it while you work: smashing a stone on a stick to make an axe, winding rope around something, placing a blueprint.'],
  ['The book', 'Reach to your hip and squeeze to take it out. Open pages face you. Flip them by swiping the free hand across the page edge, or push the thumbstick sideways.'],
  ['Stash a stick', 'Hold a stick to the book and let go.'],
  ['Make fire', 'Rub two sticks together over a pile of five or more.'],
  ['Ropes', 'Some trees have a rope hanging down. Grab it and pull down hard to take it.'],
  ['Swim', 'In deep water pull your hands back through it like a stroke. Watch for leeches, and crocodiles.'],
  ['Eat', 'Raise fruit or meat to your mouth. Meat left out for a day is roasted; two days and it is rotten.'],
  ['Fight', 'Swing a weapon hard at animals. Heavier weapons hit harder.'],
  ['Calibrate', 'Hold both grips with your arms out wide for a second and a half to measure your reach.'],
];

const CONTROLS_DESKTOP: Array<[string, string]> = [
  ['Mouse', 'Click the page, then move the mouse to look around.'],
  ['W A S D', 'Knuckle-walk (scripted arm strokes). Shift for faster strokes.'],
  ['Space', 'Both hands push down to jump.'],
  ['Q / E', 'Squeeze the left / right grip.'],
  ['Z / X', 'Hold the left / right trigger.'],
  ['B', 'Take the book out or put it away.  [ and ] flip pages.'],
  ['T', 'T-pose calibration.   [ ] with Shift change arm length.'],
  ['R', 'Respawn.'],
];

const CSS = /* css */ `
#menu { position: fixed; inset: 0; z-index: 200000; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at 50% 40%, rgba(20,38,28,0.78), rgba(4,10,8,0.94)); color: #e9efe2;
  font: 16px/1.45 Georgia, 'Times New Roman', serif; }
#menu[hidden] { display: none; }
body.has-menu #VRButton { display: none !important; }
body.menu-open #hud { display: none !important; }
#menu .panel { width: min(680px, 94vw); max-height: 92vh; overflow-y: auto; padding: 28px 32px; border-radius: 16px;
  background: rgba(14,24,18,0.9); border: 1px solid rgba(190,220,170,0.25); box-shadow: 0 20px 60px rgba(0,0,0,0.6); }
#menu h1 { margin: 0; font-size: 44px; letter-spacing: 0.08em; text-align: center; color: #f1e7c4; text-shadow: 0 2px 12px rgba(0,0,0,0.6); }
#menu .tag { text-align: center; margin: 4px 0 22px; color: #a9bd9c; font-style: italic; }
#menu h2 { margin: 0 0 14px; font-size: 26px; color: #f1e7c4; }
#menu h3 { margin: 18px 0 6px; font-size: 14px; letter-spacing: 0.12em; text-transform: uppercase; color: #9fc287; }
#menu button { font: inherit; cursor: pointer; color: #f3f0dc; background: #2d4a35; border: 1px solid #5d8a62;
  border-radius: 10px; padding: 10px 18px; margin: 3px; transition: background 0.12s; }
#menu button:hover:not(:disabled) { background: #3b6444; }
#menu button:disabled { opacity: 0.55; cursor: default; }
#menu button.big { display: block; width: 100%; margin: 10px 0; padding: 16px; font-size: 22px; letter-spacing: 0.08em; }
#menu button.primary { background: #3f7d46; border-color: #8cc58f; }
#menu button.primary:hover:not(:disabled) { background: #4b9553; }
#menu button.on { background: #b9902f; border-color: #f0d27a; color: #1f1608; }
#menu .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 4px 0; }
#menu .row .label { min-width: 190px; }
#menu .row .note { font-size: 12px; color: #c9a85a; margin-left: 6px; }
#menu .row .choices { display: flex; flex-wrap: wrap; }
#menu input[type=range] { width: 200px; accent-color: #b9902f; }
#menu dl { margin: 0; display: grid; grid-template-columns: 140px 1fr; gap: 8px 14px; }
#menu dt { color: #f1e7c4; font-weight: bold; }
#menu dd { margin: 0; color: #d4dccb; }
#menu .status { text-align: center; color: #c9d9be; min-height: 1.5em; margin: 6px 0 0; }
#menu .footer { margin-top: 18px; display: flex; justify-content: space-between; flex-wrap: wrap; }
`;

/**
 * The main menu: Play, Settings and Controls. It shows while the forest is being built, whenever you take the
 * headset off (so you can pick up where you were), and is dismissed when you press Play.
 */
export class Menu {
  private readonly root = document.createElement('div');
  private readonly panel = document.createElement('div');
  private screen: Screen = 'home';
  private loadingText: string | null = 'Growing the forest…';
  private playMessage = '';
  private resuming = false;
  /** A line about the saved game, or null if there is none. */
  private saveInfo: string | null = null;
  private saveStatus = '';
  private confirmNew = false;

  constructor(
    private readonly settings: Settings,
    private readonly hooks: MenuHooks,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root.id = 'menu';
    this.panel.className = 'panel';
    this.root.appendChild(this.panel);
    document.body.appendChild(this.root);
    document.body.classList.add('menu-open');
    this.render();
  }

  show(): void {
    this.screen = 'home';
    this.confirmNew = false;
    this.root.hidden = false;
    document.body.classList.add('menu-open');
    this.render();
  }

  hide(): void {
    this.root.hidden = true;
    document.body.classList.remove('menu-open');
  }

  /** While the forest is being built. Pass null once it is ready. */
  setLoading(text: string | null): void {
    this.loadingText = text;
    this.render();
  }

  /** What to say under the Play button (for example when VR is not available). */
  setPlayMessage(text: string): void {
    this.playMessage = text;
    this.render();
  }

  /** Describes the saved game (or null when there is none) so the menu can offer to continue it. */
  setSaveInfo(text: string | null): void {
    this.saveInfo = text;
    this.render();
  }

  /** After the first session: the Play button reads Resume. */
  setResuming(resuming: boolean): void {
    this.resuming = resuming;
    this.render();
  }

  private go(screen: Screen): void {
    this.screen = screen;
    this.render();
  }

  private render(): void {
    this.panel.replaceChildren();
    if (this.screen === 'home') this.renderHome();
    else if (this.screen === 'settings') this.renderSettings();
    else this.renderControls();
  }

  private button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    if (className) b.className = className;
    b.addEventListener('click', onClick);
    return b;
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (text) e.textContent = text;
    if (className) e.className = className;
    return e;
  }

  private renderHome(): void {
    this.panel.append(this.el('h1', 'NATURE MONKE'), this.el('p', 'Swing, climb and build your way through the forest.', 'tag'));
    const play = this.button(this.resuming ? 'RESUME' : this.saveInfo ? 'CONTINUE' : 'PLAY', () => this.hooks.onPlay(), 'big primary');
    play.id = 'menuPlay';
    play.disabled = this.loadingText !== null;
    if (this.loadingText) play.textContent = this.loadingText;
    this.panel.append(
      play,
      this.button('SETTINGS', () => this.go('settings'), 'big'),
      this.button('CONTROLS', () => this.go('controls'), 'big'),
    );
    if (this.saveInfo) this.panel.append(this.el('p', this.saveInfo, 'status'));
    const status = this.el('p', this.playMessage, 'status');
    this.panel.append(status);
    const footer = this.el('div', '', 'footer');
    const save = this.button(this.saveStatus || 'SAVE GAME', () => {
      this.saveStatus = this.hooks.onSave() ? 'Saved ✓' : 'Could not save';
      this.render();
    });
    save.id = 'menuSave';
    save.disabled = this.loadingText !== null;
    footer.append(save);
    // Starting over throws the saved game away, so it asks twice.
    const fresh = this.button(this.confirmNew ? 'Really? Delete the save' : this.saveInfo ? 'New forest (deletes save)' : 'New forest', () => {
      if (this.saveInfo && !this.confirmNew) {
        this.confirmNew = true;
        this.render();
        return;
      }
      this.hooks.onDeleteSave();
      this.hooks.onNewWorld();
    }, this.confirmNew ? 'on' : '');
    fresh.id = 'menuNew';
    footer.append(fresh);
    this.panel.append(footer);
  }

  private renderSettings(): void {
    this.panel.append(this.el('h2', 'Settings'));
    for (const group of SETTING_ROWS) {
      this.panel.append(this.el('h3', group.title));
      for (const row of group.rows) {
        const wrap = this.el('div', '', 'row');
        const label = this.el('span', row.label, 'label');
        if (row.kind === 'choice' && row.note) label.append(this.el('span', row.note, 'note'));
        wrap.append(label);
        if (row.kind === 'choice') {
          const choices = this.el('div', '', 'choices');
          for (const [value, text] of row.options) {
            const b = this.button(text, () => {
              this.settings.set(row.key, value as never);
              this.render();
            }, this.settings.data[row.key] === value ? 'on' : '');
            choices.append(b);
          }
          wrap.append(choices);
        } else {
          const input = document.createElement('input');
          input.type = 'range';
          input.min = '0';
          input.max = '100';
          input.value = String(Math.round(Number(this.settings.data[row.key]) * 100));
          input.addEventListener('input', () => this.settings.set(row.key, (Number(input.value) / 100) as never));
          wrap.append(input);
        }
        this.panel.append(wrap);
      }
    }
    this.panel.append(this.el('h3', 'Start over'));
    const reset = this.el('div', '', 'row');
    reset.append(
      this.button('Measure my arms again', () => {
        this.hooks.onResetArms();
        reset.querySelectorAll('button')[0].textContent = 'Done';
      }),
      this.button('Forget unlocked recipes', () => {
        this.hooks.onResetBook();
        reset.querySelectorAll('button')[1].textContent = 'Done';
      }),
    );
    this.panel.append(reset);
    const footer = this.el('div', '', 'footer');
    footer.append(this.button('Back', () => this.go('home')), this.button('New forest (applies world settings)', () => {
      this.hooks.onDeleteSave();
      this.hooks.onNewWorld();
    }));
    this.panel.append(footer);
  }

  private renderControls(): void {
    this.panel.append(this.el('h2', 'Controls'), this.el('h3', 'In VR'));
    this.panel.append(this.definitionList(CONTROLS_VR));
    this.panel.append(this.el('h3', 'On a desktop (emulator)'));
    this.panel.append(this.definitionList(CONTROLS_DESKTOP));
    const footer = this.el('div', '', 'footer');
    footer.append(this.button('Back', () => this.go('home')));
    this.panel.append(footer);
  }

  private definitionList(items: Array<[string, string]>): HTMLElement {
    const dl = document.createElement('dl');
    for (const [term, text] of items) {
      dl.append(this.el('dt', term), this.el('dd', text));
    }
    return dl;
  }
}
