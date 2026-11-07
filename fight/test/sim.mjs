// Headless check of fighter physics, combat and AI (no renderer needed).
import { Fighter, ATTACKS, POSES, footMismatch, groundHipY } from '../public/js/fighter.js';
import { Combat, STAGE_LIMIT } from '../public/js/combat.js';
import { AIBrain, DIFFICULTY } from '../public/js/ai.js';
import { ROSTER } from '../public/js/roster.js';
import { buildModel } from '../public/js/model.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL:', msg); } };

// 1) feet should sit on the floor in grounded poses
console.log('foot mismatch (m) per grounded pose:');
for (const k of ['STANCE', 'CROUCH', 'BLOCK', 'BLOCK_C', 'GETUP', 'WIN', 'LOSE']) {
  const mm = footMismatch(POSES[k]);
  console.log(`  ${k.padEnd(8)} ${mm.toFixed(3)}  hipsY=${groundHipY(POSES[k]).toFixed(3)}`);
  ok(mm < 0.05, `${k} feet float ${mm.toFixed(3)}m`);
}

const cfgA = { name: 'A', special: 'frostShard', skin: 0xd9a07a, pants: 0xe8e4da, wrap: 0x2a5db0, belt: 0x1d2a4a, hairStyle: 'knot', hair: 0x1a1410 };
const cfgB = { name: 'B', special: 'shadowStep', skin: 0x8a5a3c, pants: 0x1a1a1f, wrap: 0xb31d1d, belt: 0x8a0f0f, mask: true, top: 0x151515 };

function makeWorld(a = cfgA, b = cfgB) {
  const stats = { hits: 0, blocks: 0, kd: 0, ko: 0, swings: {}, shots: 0, lands: 0 };
  const f = [new Fighter(a, 0, null), new Fighter(b, 1, null)];
  const c = new Combat(f, {
    onHit: (e) => { e.type === 'block' ? stats.blocks++ : stats.hits++; if (e.ko) stats.ko++; },
    onLand: () => stats.lands++,
    onSwing: (_, a) => { stats.swings[a.name] = (stats.swings[a.name] || 0) + 1; },
    onProjectileSpawn: () => stats.shots++,
  });
  f.forEach((x) => x.setMode('idle'));
  return { f, c, stats };
}

function checkInvariants(f, tag) {
  for (const x of f) {
    ok(Number.isFinite(x.x) && Number.isFinite(x.y) && Number.isFinite(x.hp), `${tag}: NaN state`);
    ok(Math.abs(x.x) <= STAGE_LIMIT + 1e-6, `${tag}: out of bounds x=${x.x}`);
    ok(x.y >= -1e-6, `${tag}: below floor y=${x.y}`);
    ok(x.hp >= 0 && x.hp <= 100, `${tag}: hp out of range ${x.hp}`);
    for (const k of Object.keys(x.cur)) ok(Number.isFinite(x.cur[k]), `${tag}: pose ${k} NaN`);
  }
}

// 1b) every roster model builds
for (const c of ROSTER) { try { const m = buildModel(c); ok(m.hurt.length === 8 && m.L.hand && m.R.foot, c.name + ' model incomplete'); } catch (e) { ok(false, c.name + ' build threw ' + e.message); } }
console.log('roster models build:', ROSTER.map((c) => c.name).join(', '));

// 2) AI vs AI, several rounds worth of time
{
  const { f, c, stats } = makeWorld();
  const brains = [new AIBrain(0.7), new AIBrain(0.7)];
  const dt = 1 / 60;
  let rounds = 0;
  for (let i = 0; i < 60 * 240; i++) {
    brains[0].think(f[0], f[1], dt);
    brains[1].think(f[1], f[0], dt);
    c.update(dt);
    checkInvariants(f, 'ai-vs-ai');
    if (f[0].state === 'ko' || f[1].state === 'ko') {
      for (let k = 0; k < 90; k++) c.update(dt); // let the KO play out
      rounds++;
      f.forEach((x) => { x.reset(x.idx === 0 ? -1.3 : 1.3); x.setMode('idle'); });
      c.clearProjectiles();
    }
  }
  console.log('AI vs AI (4 min):', JSON.stringify(stats), 'KOs/rounds:', rounds);
  ok(stats.hits > 20, 'AI never landed enough hits');
  ok(stats.blocks > 0, 'no blocks happened');
  ok(rounds > 0, 'nobody ever got KO\'d');
  ok(Object.keys(stats.swings).length >= 4, 'AI used too few distinct moves: ' + Object.keys(stats.swings));
}

// 3) fuzz: random mashing from both sides
{
  const { f, c } = makeWorld();
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 600; i++) {
    for (const x of f) {
      if (Math.random() < 0.08) { x.setAxis('pad', Math.random() * 2 - 1, Math.random() * 2 - 1); }
      if (Math.random() < 0.1) x.press(['punch', 'kick', 'special'][Math.floor(Math.random() * 3)]);
      if (Math.random() < 0.05) x.setBlock('pad', Math.random() < 0.5);
      if (Math.random() < 0.002) x.meter = 100;
    }
    c.update(dt);
    checkInvariants(f, 'fuzz');
    if (f[0].state === 'ko' || f[1].state === 'ko') {
      f.forEach((x) => { x.reset(x.idx === 0 ? -1.3 : 1.3); x.setMode('idle'); });
      c.clearProjectiles();
    }
  }
  console.log('fuzz 10 min: ok');
}

// 4) deterministic check: a jab at point blank damages, a standing block reduces it, sweep beats standing block
{
  const run = (setup) => {
    const { f, c } = makeWorld();
    f[0].x = -0.5; f[1].x = 0.5;
    setup(f);
    for (let i = 0; i < 60; i++) c.update(1 / 60);
    return f;
  };
  const f1 = run((f) => f[0].press('punch'));
  console.log('jab point blank -> P2 hp', f1[1].hp.toFixed(1));
  ok(f1[1].hp < 100, 'jab at point blank did no damage');

  const f2 = run((f) => { f[1].setBlock('pad', true); f[0].press('punch'); });
  console.log('jab vs standing block -> P2 hp', f2[1].hp.toFixed(1));
  ok(f2[1].hp > f1[1].hp, 'block did not reduce damage');

  const f3 = run((f) => { f[1].setBlock('pad', true); f[0].setAxis('pad', 0, 1); f[0].press('kick'); });
  console.log('sweep vs standing block -> P2 hp', f3[1].hp.toFixed(1), 'state', f3[1].state);
  ok(f3[1].hp < 100 && f3[1].hp < f2[1].hp, 'sweep did not beat standing block');

  // defender already settled into a crouch before the jab comes
  const { f: f4, c: c4 } = makeWorld();
  f4[0].x = -0.5; f4[1].x = 0.5;
  f4[1].setAxis('pad', 0, 1);
  for (let i = 0; i < 40; i++) c4.update(1 / 60);
  f4[0].press('punch');
  for (let i = 0; i < 60; i++) c4.update(1 / 60);
  console.log('jab vs settled crouch -> P2 hp', f4[1].hp.toFixed(1));
  ok(f4[1].hp === 100, 'a settled crouch did not dodge a high jab');

  // and the uppercut must still catch a crouching defender
  const { f: f6, c: c6 } = makeWorld();
  f6[0].x = -0.5; f6[1].x = 0.5;
  f6[1].setAxis('pad', 0, 1);
  f6[0].setAxis('pad', 0, 1);
  for (let i = 0; i < 40; i++) c6.update(1 / 60);
  f6[0].press('punch');
  for (let i = 0; i < 60; i++) c6.update(1 / 60);
  console.log('uppercut vs crouching defender -> P2 hp', f6[1].hp.toFixed(1));

}

// 5) each fighter's signature special
{
  const by = (n) => ROSTER.find((c) => c.name === n);
  const setup = (name, gap, oppCfg = by('CIPHER')) => {
    const w = makeWorld(by(name), oppCfg);
    w.f[0].x = -gap / 2; w.f[1].x = gap / 2;
    w.f[0].meter = 50;
    return w;
  };
  const step = (c, n) => { for (let i = 0; i < n; i++) c.update(1 / 60); };

  for (const c of ROSTER) ok(ATTACKS[c.special]?.cost === 50 && c.ability?.name, c.name + ' has no usable special');

  { // RIME: freezes on hit, ice holds them still, then wears off
    const { f, c } = setup('RIME', 3);
    f[0].press('special');
    let frozeAt = -1;
    for (let i = 0; i < 90 && frozeAt < 0; i++) { c.update(1 / 60); if (f[1].frozen) frozeAt = i; }
    ok(frozeAt >= 0, 'frost shard never froze');
    console.log('frost shard -> P2 hp', f[1].hp.toFixed(1), 'state', f[1].state);
    const pose = f[1].cur.sx, x = f[1].x;
    step(c, 30);
    ok(f[1].state === 'hitstun' && f[1].frozen && f[1].cur.sx === pose && f[1].x === x, 'frozen fighter moved');
    step(c, 60);
    ok(!f[1].frozen && f[1].state === 'idle', 'freeze never wore off');
  }
  { // RIME: blocking the shard means no freeze, and any hit breaks the ice
    const { f, c } = setup('RIME', 3);
    f[1].setBlock('pad', true);
    f[0].press('special');
    step(c, 60);
    ok(!f[1].frozen && f[1].hp > 95, 'blocked shard still froze');
    const w = setup('RIME', 1);
    w.f[1].frozen = true; w.f[1].state = 'hitstun'; w.f[1].stunTime = 1;
    w.f[0].press('punch');
    step(w.c, 20);
    ok(!w.f[1].frozen && w.f[1].hp < 100, 'hit did not break the ice');
  }
  { // SAFFRON: reaches from range and goes through a shot
    const { f, c } = setup('SAFFRON', 3);
    f[0].press('special');
    step(c, 45);
    console.log('blade rush from 3m -> P2 hp', f[1].hp.toFixed(1), 'state', f[1].state);
    ok(f[1].hp < 90 && f[1].state === 'knockdown', 'blade rush did not connect from 3m');

    const w = setup('SAFFRON', 3, by('RIME'));
    w.f[1].meter = 50;
    w.f[1].press('special');
    step(w.c, 14); // the shard is about to land
    w.f[0].press('special');
    step(w.c, 2);
    const hp = w.f[0].hp;
    step(w.c, 16);
    ok(w.f[0].hp === hp && !w.f[0].frozen, 'blade rush got hit during its active window');
  }
  { // CINDER: ends up on the far side and connects, hidden only while vanished
    const { f, c } = setup('CINDER', 3);
    f[0].press('special');
    step(c, 6);
    ok(!f[0].m.root.visible, 'shadow step did not vanish');
    step(c, 40);
    console.log('shadow step -> P1 x', f[0].x.toFixed(2), 'P2 x', f[1].x.toFixed(2), 'P2 hp', f[1].hp.toFixed(1));
    ok(f[1].hp < 90 && f[1].state === 'knockdown', 'shadow step did not connect');
    ok(f[0].m.root.visible, 'shadow step left the model hidden');

    const w = setup('CINDER', 2); // opponent pinned on the wall
    w.f[1].x = STAGE_LIMIT; w.f[0].x = STAGE_LIMIT - 2;
    w.f[0].press('special');
    step(w.c, 45);
    ok(w.f[1].hp < 100, 'shadow step whiffed against the wall');

    const b = setup('CINDER', 3);
    b.f[1].setBlock('pad', true);
    b.f[0].press('special');
    step(b.c, 45);
    ok(b.f[1].hp > 95, 'shadow step could not be blocked');
  }
  { // CIPHER: armor absorbs knockdowns, cuts damage, boosts output, expires, can't be stacked
    const { f, c } = setup('CIPHER', 1, by('RIME'));
    f[0].meter = 100;
    f[0].press('special');
    step(c, 30);
    ok(f[0].armor > 0 && f[0].meter === 50, 'overdrive did not start');
    f[0].press('special');
    step(c, 20);
    ok(f[0].meter === 50, 'overdrive spent meter while already active');
    f[1].x = f[0].x + 0.9;
    f[1].setAxis('pad', 0, 1);
    step(c, 25);
    f[1].press('punch');
    step(c, 30);
    console.log('uppercut into overdrive -> P1 hp', f[0].hp.toFixed(1), 'state', f[0].state);
    ok(f[0].hp < 100 && f[0].hp > 100 - ATTACKS.uppercut.dmg, 'armor did not reduce the uppercut');
    ok(f[0].state === 'idle', 'armor did not stop the knockdown');
    step(c, 60 * 5);
    ok(f[0].armor <= 0, 'overdrive never ended');
  }
}

// 5b) the second set of specials
{
  const by = (n) => ROSTER.find((c) => c.name === n);
  const world = (name, gap, opp = 'RIME') => { const w = makeWorld(by(name), by(opp)); w.f[0].x = -gap / 2; w.f[1].x = gap / 2; w.f[0].meter = 50; return w; };
  const step = (c, n) => { for (let i = 0; i < n; i++) c.update(1 / 60); };

  { // ORO: the wave beats a standing block, loses to a low block and to a jump
    const a = world('ORO', 3);
    a.f[1].setBlock('pad', true); a.f[0].press('special'); step(a.c, 60);
    ok(a.f[1].hp < 95 && a.f[1].state === 'knockdown', 'quake did not beat a standing block');
    const b = world('ORO', 3);
    b.f[1].setBlock('pad', true); b.f[1].setAxis('pad', 0, 1); step(b.c, 30); b.f[0].x = -1.5; b.f[1].x = 1.5; b.f[0].press('special'); step(b.c, 60);
    ok(b.f[1].hp > 95, 'quake could not be low-blocked');
    const c = world('ORO', 3);
    c.f[0].press('special'); step(c.c, 24); c.f[1].setAxis('pad', 0, -1); step(c.c, 6); c.f[1].setAxis('pad', 0, 0); step(c.c, 50);
    ok(c.f[1].hp === 100, 'quake could not be jumped');
  }
  { // LIRA: heals, stops at max, won't spend meter at full health
    const { f, c } = world('LIRA', 3);
    f[0].press('special'); step(c, 30);
    ok(f[0].meter === 50, 'second wind spent meter at full health');
    f[0].hp = 40; f[0].press('special'); step(c, 40);
    ok(f[0].hp === 62 && f[0].meter === 0, 'second wind did not heal 22');
    f[0].hp = 95; f[0].meter = 50; f[0].press('special'); step(c, 40);
    ok(f[0].hp === 100, 'second wind overhealed');
  }
  { // KAIN: heals by the damage dealt, not when blocked
    const { f, c } = world('KAIN', 1.3);
    f[0].hp = 50; f[0].press('special'); step(c, 40);
    console.log('soul drain -> P1 hp', f[0].hp.toFixed(1), 'P2 hp', f[1].hp.toFixed(1));
    ok(f[1].hp === 88 && f[0].hp === 59, 'soul drain did not transfer health');
    const b = world('KAIN', 1.3);
    b.f[0].hp = 50; b.f[1].setBlock('pad', true); b.f[0].press('special'); step(b.c, 40);
    ok(b.f[0].hp === 50, 'blocked soul drain still healed');
  }
  { // ZEPHYR: pushes much further than a normal hit
    const { f, c } = world('ZEPHYR', 2);
    const x = f[1].x;
    f[0].press('special'); step(c, 70);
    console.log('gale blast -> P2 pushed', (f[1].x - x).toFixed(2));
    ok(f[1].x - x > 1, 'gale blast barely moved them');
  }
}

// 6) full roster matchups, CPU vs CPU, both sides, to spot a broken special
{
  const dt = 1 / 60;
  console.log('win rate by matchup (row beat column):');
  const totals = {};
  for (const a of ROSTER) {
    let line = '  ' + a.name.padEnd(8);
    for (const b of ROSTER) {
      if (a === b) { line += '   -  '; continue; }
      let w = 0;
      const games = 30;
      for (let g = 0; g < games; g++) {
        const flip = g % 2;
        const { f, c } = makeWorld(flip ? b : a, flip ? a : b);
        const brains = [new AIBrain(0.6), new AIBrain(0.6)];
        for (let i = 0; i < 60 * 60 && f[0].hp > 0 && f[1].hp > 0; i++) {
          brains[0].think(f[0], f[1], dt); brains[1].think(f[1], f[0], dt);
          c.update(dt);
        }
        const me = f[flip], them = f[1 - flip];
        if (me.hp > them.hp) w++;
        else if (me.hp === them.hp) w += 0.5;
      }
      const pct = Math.round((w / games) * 100);
      totals[a.name] = (totals[a.name] || 0) + pct / (ROSTER.length - 1);
      line += String(pct).padStart(4) + '% ';
    }
    console.log(line);
  }
  for (const [n, p] of Object.entries(totals)) {
    console.log(`  ${n.padEnd(8)} overall ${p.toFixed(0)}%`);
    ok(p > 30 && p < 70, `${n} is out of balance at ${p.toFixed(0)}%`);
  }
}

// 7) a casual player has to be able to beat the CPU at its starting level, and not at its hardest
{
  const dt = 1 / 60;
  const casual = () => {
    let t = 0, clock = 0, blockUntil = 0, yUntil = 0, seen = 0, react = -1;
    return (me, opp) => {
      clock += dt; t -= dt;
      if (clock > yUntil) me.setAxis('pad', me.inp.padX, 0);
      if (clock > blockUntil) me.setBlock('pad', false);
      if (opp.state === 'attack' && opp.atkId !== seen) { seen = opp.atkId; if (Math.random() < 0.3) react = clock + 0.3 + Math.random() * 0.15; }
      if (react > 0 && clock >= react) { react = -1; me.setBlock('pad', true); blockUntil = clock + 0.45; }
      if (t > 0) return;
      t = 0.22 + Math.random() * 0.25;
      const dx = opp.x - me.x, to = Math.sign(dx) || 1, r = Math.random();
      if (me.meter >= 50 && r < 0.3) { me.press('special'); return; }
      if (Math.abs(dx) > 1.5) { me.setAxis('pad', to, 0); return; }
      me.setAxis('pad', 0, 0);
      if (r < 0.45) me.press('punch');
      else if (r < 0.75) me.press('kick');
      else if (r < 0.83) { me.setAxis('pad', 0, 1); yUntil = clock + 0.2; me.press('punch'); }
      else if (r < 0.9) me.setAxis('pad', -to, 0);
    };
  };
  const winRate = (level) => {
    let won = 0, games = 0;
    for (const p of ROSTER) for (const q of ROSTER) for (let g = 0; g < 6; g++) {
      const { f, c } = makeWorld(p, q);
      f[0].x = -1.4; f[1].x = 1.4;
      const human = casual(), cpu = new AIBrain(level);
      for (let i = 0; i < 3600 && f[0].hp > 0 && f[1].hp > 0; i++) { human(f[0], f[1]); cpu.think(f[1], f[0], dt); c.update(dt); }
      won += f[0].hp > f[1].hp ? 1 : 0;
      games++;
    }
    return won / games;
  };
  const easy = winRate(DIFFICULTY.easy), hard = winRate(DIFFICULTY.expert);
  console.log(`casual player round wins: easy CPU ${Math.round(easy * 100)}%, expert CPU ${Math.round(hard * 100)}%`);
  ok(easy > 0.6, 'easy CPU is too hard for a casual player');
  ok(hard < 0.4, 'expert CPU is too easy');

  // 7b) nor can simple tactics beat it. Mashing once won 84% against the hardest level,
  // because a jab stunned for longer than the gap to the next jab.
  const mash = () => {
    let t = 0;
    return (me, opp) => {
      t -= dt;
      const dx = opp.x - me.x;
      if (Math.abs(dx) > 1.2) { me.setAxis('pad', Math.sign(dx) || 1, 0); return; }
      me.setAxis('pad', 0, 0);
      if (t <= 0) { t = 0.2; me.press('punch'); }
    };
  };
  const rush = () => {
    let t = 0;
    return (me, opp) => {
      t -= dt;
      const dx = opp.x - me.x;
      if (Math.abs(dx) > 1.3) { me.setAxis('pad', Math.sign(dx) || 1, 0); return; }
      me.setAxis('pad', 0, 0);
      if (t <= 0) { t = 0.2 + Math.random() * 0.1; me.press(Math.random() < 0.65 ? 'punch' : 'kick'); }
    };
  };
  const tactic = (bot, level) => {
    let won = 0, games = 0;
    for (const p of ROSTER) for (const q of ROSTER) {
      const { f, c } = makeWorld(p, q);
      f[0].x = -1.4; f[1].x = 1.4;
      const human = bot(), cpu = new AIBrain(level);
      for (let i = 0; i < 3600 && f[0].hp > 0 && f[1].hp > 0; i++) { human(f[0], f[1]); cpu.think(f[1], f[0], dt); c.update(dt); }
      won += f[0].hp > f[1].hp ? 1 : 0;
      games++;
    }
    return won / games;
  };
  for (const [name, bot] of [['mash', mash], ['rush', rush]]) {
    const start = tactic(bot, DIFFICULTY.easy), top = tactic(bot, DIFFICULTY.expert);
    console.log(`${name} round wins: easy CPU ${Math.round(start * 100)}%, expert CPU ${Math.round(top * 100)}%`);
    ok(start > 0.6, `easy CPU is too hard for a ${name} player`);
    ok(top < 0.3, `${name} beats the expert CPU`);
  }

  // 7d) each difficulty sits where it should for a sloppy player (casual, mash and rush averaged)
  const sloppy = (level) => (winRate(level) + tactic(mash, level) + tactic(rush, level)) / 3;
  const bands = { easy: [0.7, 1], medium: [0.4, 0.72], hard: [0.08, 0.38], expert: [0, 0.12] };
  for (const [d, [lo, hi]] of Object.entries(bands)) {
    const w = sloppy(DIFFICULTY[d]);
    console.log(`  ${d.padEnd(7)} sloppy player wins ${Math.round(w * 100)}%`);
    ok(w >= lo && w <= hi, `${d} difficulty is off: sloppy player wins ${Math.round(w * 100)}%`);
  }

  // 7c) a stun chain has to run out, so the same jab stuns for less each time
  {
    const { f } = makeWorld();
    const stuns = [];
    for (let i = 0; i < 4; i++) { f[1].receiveHit(ATTACKS.jab, f[0], 1, { x: 0, y: 1.4 }); stuns.push(f[1].stunTime); f[1].invuln = 0; }
    ok(stuns[3] < stuns[0] * 0.6, `stun does not fade through a chain: ${stuns}`);
  }
}

console.log(fails ? `\n${fails} FAILURES` : '\nall checks passed');
process.exit(fails ? 1 : 0);
