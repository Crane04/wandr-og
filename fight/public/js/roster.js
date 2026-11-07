// What each special is called and does, for the select screen.
export const ABILITIES = {
  frostShard: { name: 'FROST SHARD', desc: 'A shot that freezes them solid' },
  bladeRush: { name: 'BLADE RUSH', desc: 'An untouchable dash through attacks' },
  shadowStep: { name: 'SHADOW STEP', desc: 'Vanish and strike from behind' },
  overdrive: { name: 'OVERDRIVE', desc: 'Armor up: no flinch, harder hits' },
  quake: { name: 'QUAKE', desc: 'A shockwave along the floor. Jump it or guard low' },
  secondWind: { name: 'SECOND WIND', desc: 'Recover a chunk of health' },
  soulDrain: { name: 'SOUL DRAIN', desc: 'A lunging strike that steals health' },
  galeBlast: { name: 'GALE BLAST', desc: 'A fast gust that hurls them across the arena' },
};

// Original fighters. Each is a config for model.js plus a little flavour for the select screen.
export const ROSTER = [
  {
    name: 'RIME', skinModel: 'rime', title: 'THE COLD HAND', fx: 0x7fdcff, blood: 0x8a0a0a,
    special: 'frostShard', ability: ABILITIES.frostShard,
    skin: 0xa8978c, hair: 0xe8eef2, hairStyle: 'spiky', browColor: 0xc8d4dc,
    pants: 0x9aa8b6, belt: 0x2a3440, buckle: 0x62d8ff, boots: 0x2a3440,
    wrap: 0x9fb8c8, glow: 0x62d8ff, crystals: true,
    build: { w: 1.08, d: 1.05, muscle: 1.15, limb: 1.1, jaw: 1.1, brow: 1.2, scale: 1.03 },
  },
  {
    name: 'SAFFRON', skinModel: 'saffron', title: 'THE BLADE DANCER', fx: 0xffc34a, blood: 0x8a0a0a, female: true,
    special: 'bladeRush', ability: ABILITIES.bladeRush,
    skin: 0x8a5a3c, hair: 0x120c0a, hairStyle: 'ponytail', headband: 0xb02a50,
    top: 0xe0a020, topFrom: 0.5, pants: 0x2a1a30, belt: 0xb02a50, boots: 0x2a1a30,
    wrap: 0xe0a020, fans: 0xd8dce4,
    build: { w: 0.88, d: 0.92, muscle: 0.4, limb: 0.86, head: 0.97, jaw: 0.8, brow: 0.4, scale: 0.95 },
  },
  {
    name: 'CINDER', skinModel: 'cinder', title: 'THE ASH SHADOW', fx: 0xff7a2a, blood: 0x8a0a0a,
    special: 'shadowStep', ability: ABILITIES.shadowStep,
    skin: 0x6b4529, hood: 0x1d1a1a, mask: true, maskColor: 0x1d1a1a, eyeGlow: 0xff7a22,
    top: 0x1d1a1f, sleeves: 0x1d1a1f, pants: 0x1d1a1f, belt: 0x2a2321, boots: 0x141010,
    wrap: 0x2a2321, glow: 0xff6a1a, straps: 0x3a2a22, buckle: 0xff6a1a,
    build: { w: 1.04, d: 1.0, muscle: 1.0, limb: 1.04 },
  },
  {
    name: 'CIPHER', skinModel: 'cipher', title: 'THE IRON UNIT', fx: 0xffb347, blood: 0x241d12, // leaks oil
    special: 'overdrive', ability: ABILITIES.overdrive,
    skin: 0x555a60, metalTop: true, helmet: 0x7a8088, visor: 0xffb347,
    top: 0x8a9098, sleeves: 0x6f757d, pants: 0x44484e, wrap: 0x30343a, belt: 0x30343a,
    boots: 0x23262a, pauldron: 0x9aa0a8, shinGuard: 0x9aa0a8, chestGlow: 0xffb347, glow: 0xffb347, buckle: 0xffb347,
    build: { w: 1.16, d: 1.1, muscle: 0.9, limb: 1.18, head: 0.96, scale: 1.08 },
  },
  {
    name: 'ORO', skinModel: 'oro', title: 'THE MOUNTAIN', fx: 0xd9a441, blood: 0x8a0a0a,
    special: 'quake', ability: ABILITIES.quake,
    skin: 0x4a2f1f, hair: 0x15100c, hairStyle: 'short', browColor: 0x15100c,
    pants: 0x5a4630, belt: 0x2a1c12, buckle: 0xd9a441, boots: 0x241810, wrap: 0xb08a4a,
    build: { w: 1.2, d: 1.16, muscle: 1.25, limb: 1.2, jaw: 1.2, brow: 1.3, scale: 1.07 },
  },
  {
    name: 'LIRA', skinModel: 'lira', title: 'THE MENDER', fx: 0x5fe0a8, blood: 0x8a0a0a, female: true,
    special: 'secondWind', ability: ABILITIES.secondWind,
    skin: 0xe0b08c, hair: 0xa8431e, hairStyle: 'ponytail', iris: 0x2f6a4a,
    top: 0x1f6a58, sleeves: 0x1f6a58, pants: 0xd8d2c0, belt: 0x5fe0a8, boots: 0x2a3a34,
    wrap: 0xd8d2c0, glow: 0x5fe0a8, headband: 0x1f6a58,
    build: { w: 0.9, d: 0.92, muscle: 0.45, limb: 0.88, jaw: 0.82, brow: 0.45, scale: 0.97 },
  },
  {
    name: 'KAIN', skinModel: 'kain', title: 'THE BLOOD DEBT', fx: 0xe0304a, blood: 0x8a0a0a,
    special: 'soulDrain', ability: ABILITIES.soulDrain,
    skin: 0xc8b4ac, hair: 0x0c0a0e, hairStyle: 'knot', eyeGlow: 0xe0304a,
    top: 0x3a0e18, sleeves: 0x3a0e18, pants: 0x18121a, belt: 0x5a1020, buckle: 0xe0304a,
    boots: 0x100c10, wrap: 0x5a1020, straps: 0x5a1020, glow: 0xe0304a,
    build: { w: 1.0, d: 0.98, muscle: 0.8, limb: 1.0, jaw: 1.05, brow: 1.2, scale: 1.02 },
  },
  {
    name: 'ZEPHYR', skinModel: 'zephyr', title: 'THE LAST GALE', fx: 0x7fb4ff, blood: 0x8a0a0a, female: true,
    special: 'galeBlast', ability: ABILITIES.galeBlast,
    skin: 0xb98a62, hair: 0xdfe8f2, hairStyle: 'knot', iris: 0x3a6ab0, headband: 0x3a6ab0,
    top: 0xdfe8f2, topFrom: 0.5, pants: 0x2a3a5a, belt: 0x3a6ab0, boots: 0x1a2438, wrap: 0x7fb4ff,
    build: { w: 0.92, d: 0.94, muscle: 0.55, limb: 0.92, jaw: 0.85, brow: 0.5, scale: 0.98 },
  },
];
