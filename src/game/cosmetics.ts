import * as THREE from 'three';
import type { Slot } from './save';
import { SKINS } from './avatar';
import { blob, box, cone, cyl, mat, part, sphere } from './shapes';

export interface Cosmetic {
  id: string;
  slot: Slot;
  name: string;
  price: number;
  /** Builds the thing to wear. Hats and goggles go on the head (origin at the eyes); the rest on the torso (origin at the head, turned with the body). */
  build?: () => THREE.Object3D;
  /** Where it is worn. */
  on?: 'head' | 'torso' | 'hands';
}

const group = (fn: (g: THREE.Group) => void): THREE.Group => {
  const g = new THREE.Group();
  fn(g);
  return g;
};

export const HATS: Cosmetic[] = [
  { id: 'hat_none', slot: 'hat', name: 'NO HAT', price: 0 },
  {
    id: 'hat_hard', slot: 'hat', name: 'HARD HAT', price: 80, on: 'head',
    build: () => group((g) => {
      part(g, sphere, 0xf0c020, [0, 0.14, 0.03], [0.18, 0.1, 0.19]);
      part(g, cyl, 0xf0c020, [0, 0.11, -0.04], [0.2, 0.012, 0.2]);
      part(g, box, 0xd8a810, [0, 0.2, 0.03], [0.03, 0.03, 0.16]);
    }),
  },
  {
    id: 'hat_lamp', slot: 'hat', name: 'HEADLAMP', price: 120, on: 'head',
    build: () => group((g) => {
      part(g, cyl, 0x303036, [0, 0.09, 0.03], [0.18, 0.02, 0.18]);
      part(g, cyl, 0x505058, [0, 0.11, -0.16], [0.04, 0.04, 0.04], [Math.PI / 2, 0, 0]);
      part(g, sphere, 0xfff6c0, [0, 0.11, -0.2], [0.03, 0.03, 0.01], [0, 0, 0], 0xfff6c0);
    }),
  },
  {
    id: 'hat_cone', slot: 'hat', name: 'TRAFFIC CONE', price: 50, on: 'head',
    build: () => group((g) => {
      part(g, cone, 0xff6a10, [0, 0.3, 0.03], [0.13, 0.32, 0.13]);
      part(g, cyl, 0xffffff, [0, 0.27, 0.03], [0.095, 0.05, 0.095]);
      part(g, cyl, 0xff6a10, [0, 0.14, 0.03], [0.17, 0.02, 0.17]);
    }),
  },
  {
    id: 'hat_top', slot: 'hat', name: 'TOP HAT', price: 200, on: 'head',
    build: () => group((g) => {
      part(g, cyl, 0x14141a, [0, 0.13, 0.03], [0.22, 0.018, 0.22]);
      part(g, cyl, 0x14141a, [0, 0.27, 0.03], [0.13, 0.28, 0.13]);
      part(g, cyl, 0xb02030, [0, 0.17, 0.03], [0.135, 0.05, 0.135]);
    }),
  },
  {
    id: 'hat_crown', slot: 'hat', name: 'CROWN', price: 500, on: 'head',
    build: () => group((g) => {
      part(g, cyl, 0xffc830, [0, 0.19, 0.03], [0.14, 0.06, 0.14], [0, 0, 0], 0x6a4a00, 0.25, 0.9);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        part(g, cone, 0xffc830, [Math.cos(a) * 0.14, 0.27, 0.03 + Math.sin(a) * 0.14], [0.03, 0.09, 0.03], [0, 0, 0], 0x6a4a00, 0.25, 0.9);
        part(g, sphere, [0xff3050, 0x30a0ff, 0x40ff80][i % 3], [Math.cos(a) * 0.145, 0.2, 0.03 + Math.sin(a) * 0.145], [0.014, 0.014, 0.014], [0, 0, 0], [0xff3050, 0x30a0ff, 0x40ff80][i % 3]);
      }
    }),
  },
  {
    id: 'hat_halo', slot: 'hat', name: 'HALO', price: 400, on: 'head',
    build: () => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.012, 8, 28), new THREE.MeshBasicMaterial({ color: 0xfff0a0 }));
      m.rotation.x = Math.PI / 2;
      m.position.set(0, 0.3, 0.03);
      const g = new THREE.Group();
      g.add(m);
      return g;
    },
  },
  {
    id: 'hat_phones', slot: 'hat', name: 'HEADPHONES', price: 110, on: 'head',
    build: () => group((g) => {
      part(g, cyl, 0x2a2a30, [0, 0.17, 0.03], [0.17, 0.012, 0.02], [0, 0, Math.PI / 2]);
      for (const sx of [-1, 1]) {
        part(g, cyl, 0x303036, [sx * 0.185, 0.0, 0.03], [0.07, 0.04, 0.07], [0, 0, Math.PI / 2]);
        part(g, cyl, 0xff4080, [sx * 0.21, 0.0, 0.03], [0.04, 0.01, 0.04], [0, 0, Math.PI / 2], 0xff2060);
        part(g, cyl, 0x2a2a30, [sx * 0.17, 0.09, 0.03], [0.012, 0.1, 0.012]);
      }
    }),
  },
  {
    id: 'hat_bunny', slot: 'hat', name: 'BUNNY EARS', price: 120, on: 'head',
    build: () => group((g) => {
      for (const sx of [-1, 1]) {
        part(g, sphere, 0xf4f0f0, [sx * 0.07, 0.38, 0.03], [0.05, 0.2, 0.025], [0, 0, sx * 0.15]);
        part(g, sphere, 0xff9ab0, [sx * 0.07, 0.38, 0.015], [0.03, 0.15, 0.01], [0, 0, sx * 0.15]);
      }
    }),
  },
  {
    id: 'hat_mohawk', slot: 'hat', name: 'MOHAWK', price: 90, on: 'head',
    build: () => group((g) => {
      for (let i = 0; i < 9; i++) part(g, cone, [0xff2090, 0x20e0ff][i % 2], [0, 0.18 + Math.sin(i / 8 * Math.PI) * 0.06, 0.18 - i * 0.045], [0.02, 0.12 + Math.sin(i / 8 * Math.PI) * 0.1, 0.02], [0, 0, 0], [0xff2090, 0x20e0ff][i % 2]);
    }),
  },
  {
    id: 'hat_wizard', slot: 'hat', name: 'WIZARD HAT', price: 300, on: 'head',
    build: () => group((g) => {
      part(g, cyl, 0x3a2a80, [0, 0.13, 0.03], [0.24, 0.012, 0.24]);
      part(g, cone, 0x3a2a80, [0, 0.34, 0.03], [0.14, 0.4, 0.14], [0.2, 0, 0.1]);
      for (let i = 0; i < 4; i++) part(g, sphere, 0xffe060, [Math.sin(i * 1.6) * 0.07, 0.25 + i * 0.05, 0.03 + Math.cos(i * 1.6) * 0.07], [0.012, 0.012, 0.012], [0, 0, 0], 0xffd030);
    }),
  },
  {
    id: 'hat_dome', slot: 'hat', name: 'GLASS DOME', price: 220, on: 'head',
    build: () => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 12), new THREE.MeshStandardMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.3, side: THREE.DoubleSide, depthWrite: false }));
      m.position.set(0, 0, 0.03);
      const g = new THREE.Group();
      g.add(m);
      part(g, cyl, 0xaaaaaa, [0, -0.2, 0.03], [0.22, 0.02, 0.22], [0, 0, 0], 0, 0.3, 0.8);
      return g;
    },
  },
  {
    id: 'hat_fish', slot: 'hat', name: 'GOLDFISH BOWL', price: 260, on: 'head',
    build: () => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshStandardMaterial({ color: 0x80c0ff, transparent: true, opacity: 0.25, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }));
      m.position.set(0, 0.35, 0.03);
      g.add(m);
      const fish = part(g, sphere, 0xff8a20, [0, 0.35, 0.03], [0.04, 0.025, 0.02], [0, 0, 0], 0xff6a10);
      fish.userData.swim = true;
      return g;
    },
  },
  {
    id: 'hat_prop', slot: 'hat', name: 'PROPELLER CAP', price: 150, on: 'head',
    build: () => {
      const g = group((gg) => {
        part(gg, sphere, 0x3a70e0, [0, 0.13, 0.03], [0.17, 0.08, 0.18]);
        part(gg, cyl, 0xe03030, [0, 0.21, 0.03], [0.01, 0.04, 0.01]);
      });
      const blades = new THREE.Group();
      blades.position.set(0, 0.25, 0.03);
      part(blades, box, 0xf0f0f0, [0, 0, 0], [0.28, 0.008, 0.04]);
      part(blades, box, 0xf0f0f0, [0, 0, 0], [0.04, 0.008, 0.28]);
      blades.userData.spin = true;
      g.add(blades);
      return g;
    },
  },
];

export const ACCS: Cosmetic[] = [
  { id: 'acc_none', slot: 'acc', name: 'NOTHING', price: 0 },
  {
    id: 'acc_pack', slot: 'acc', name: 'BACKPACK', price: 100, on: 'torso',
    build: () => group((g) => {
      part(g, box, 0x4a5a3a, [0, -0.46, 0.2], [0.26, 0.32, 0.13]);
      part(g, box, 0x2a3220, [0, -0.36, 0.28], [0.2, 0.1, 0.03]);
      part(g, sphere, 0xff8020, [0.08, -0.6, 0.26], [0.03, 0.03, 0.03], [0, 0, 0], 0xff8020);
    }),
  },
  {
    id: 'acc_scarf', slot: 'acc', name: 'SCARF', price: 80, on: 'torso',
    build: () => group((g) => {
      part(g, cyl, 0xc02838, [0, -0.2, 0.02], [0.11, 0.05, 0.11]);
      part(g, box, 0xc02838, [0.06, -0.38, -0.1], [0.07, 0.3, 0.02], [0, 0, 0.1]);
    }),
  },
  {
    id: 'acc_goggles', slot: 'acc', name: 'GOGGLES', price: 90, on: 'head',
    build: () => group((g) => {
      part(g, cyl, 0x2a2a30, [0, 0.12, -0.02], [0.17, 0.025, 0.17]);
      for (const sx of [-1, 1]) part(g, cyl, 0x60e0ff, [sx * 0.06, 0.145, -0.11], [0.045, 0.02, 0.045], [Math.PI / 2, 0, 0], 0x2090b0, 0.1, 0.8);
    }),
  },
  {
    id: 'acc_cape', slot: 'acc', name: 'CAPE', price: 200, on: 'torso',
    build: () => group((g) => {
      const c = part(g, box, 0xa01020, [0, -0.65, 0.19], [0.4, 0.8, 0.012]);
      c.geometry = new THREE.BoxGeometry(1, 1, 1);
      part(g, cyl, 0xffc830, [0, -0.27, 0.13], [0.2, 0.025, 0.1], [Math.PI / 2, 0, 0], 0, 0.3, 0.9);
    }),
  },
  {
    id: 'acc_wings', slot: 'acc', name: 'WINGS', price: 600, on: 'torso',
    build: () => group((g) => {
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 6; i++) {
          const f = part(g, box, i % 2 ? 0xdde8ff : 0xffffff, [sx * (0.15 + i * 0.07), -0.3 + i * 0.03, 0.2], [0.05, 0.5 - i * 0.04, 0.012], [0, 0, -sx * (0.5 + i * 0.1)], 0x304060);
          f.userData.wing = sx;
        }
      }
    }),
  },
  {
    id: 'acc_reactor', slot: 'acc', name: 'CHEST REACTOR', price: 180, on: 'torso',
    build: () => group((g) => {
      part(g, cyl, 0x2a2e36, [0, -0.43, -0.13], [0.07, 0.02, 0.07], [Math.PI / 2, 0, 0], 0, 0.3, 0.8);
      const core = part(g, sphere, 0x60ffff, [0, -0.43, -0.15], [0.04, 0.04, 0.02], [0, 0, 0], 0x20e0ff);
      core.userData.pulse = true;
    }),
  },
  {
    id: 'acc_lamp', slot: 'acc', name: 'SHOULDER LAMP', price: 140, on: 'torso',
    build: () => group((g) => {
      part(g, cyl, 0x2a2e36, [0.27, -0.2, -0.02], [0.04, 0.04, 0.04], [Math.PI / 2, 0, 0]);
      part(g, cyl, 0xfff6c0, [0.27, -0.2, -0.065], [0.032, 0.004, 0.032], [Math.PI / 2, 0, 0], 0xfff0a0);
      part(g, cyl, 0x2a2e36, [0.27, -0.26, -0.02], [0.012, 0.06, 0.012]);
    }),
  },
  {
    id: 'acc_tail', slot: 'acc', name: 'CYBER TAIL', price: 160, on: 'torso',
    build: () => group((g) => {
      for (let i = 0; i < 8; i++) part(g, sphere, i % 2 ? 0x30343c : 0x505660, [0, -0.78 - i * 0.04, 0.2 + i * 0.07], [0.04 - i * 0.003, 0.04 - i * 0.003, 0.05], [0, 0, 0], i === 7 ? 0xff2060 : 0);
    }),
  },
  {
    id: 'acc_bandolier', slot: 'acc', name: 'BANDOLIER', price: 100, on: 'torso',
    build: () => group((g) => {
      part(g, box, 0x4a3a28, [0, -0.45, -0.1], [0.5, 0.05, 0.02], [0, 0, 0.7]);
      for (let i = 0; i < 5; i++) part(g, cyl, 0xe0b020, [-0.12 + i * 0.06, -0.52 + i * 0.062 - 0.1, -0.12], [0.012, 0.035, 0.012], [0, 0, 0]);
    }),
  },
  {
    id: 'acc_jets', slot: 'acc', name: 'JET RINGS', price: 450, on: 'torso',
    build: () => group((g) => {
      for (let i = 0; i < 3; i++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(0.26 + i * 0.05, 0.008, 6, 28), new THREE.MeshBasicMaterial({ color: [0x40e0ff, 0xff40d0, 0xffe040][i] }));
        t.rotation.x = Math.PI / 2;
        t.position.set(0, -0.9 - i * 0.05, 0.03);
        t.userData.ring = i + 1;
        g.add(t);
      }
    }),
  },
  {
    id: 'acc_wrist', slot: 'acc', name: 'WRIST DISPLAY', price: 60, on: 'hands',
    build: () => group((g) => {
      part(g, box, 0x2a2a30, [0, 0.045, 0.02], [0.07, 0.02, 0.09]);
      part(g, box, 0x40ff90, [0, 0.057, 0.02], [0.055, 0.004, 0.06], [0, 0, 0], 0x20b060);
    }),
  },
];

export const ALL: Cosmetic[] = [
  ...SKINS.map((s) => ({ id: s.id, slot: 'skin' as Slot, name: s.name, price: s.price })),
  ...HATS,
  ...ACCS,
];

export function itemById(id: string): Cosmetic | undefined {
  return ALL.find((c) => c.id === id);
}

export function inSlot(slot: Slot): Cosmetic[] {
  return ALL.filter((c) => c.slot === slot);
}

/** Unused material helper kept so shared colours stay cached. */
export const _keep = { mat, blob };
