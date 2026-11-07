import * as THREE from 'three';
import { buildModel, LEG, ANKLE_H } from './model.js';
import { STAGE_LIMIT } from './combat.js';

// ---------------------------------------------------------------------------
// Pose system. A pose is a flat set of joint angles (radians). "lead" limbs are
// the ones nearest the camera, "rear" the far ones, so a fighter looks right
// whichever way they face.
//   hrx hips lean (+ forward)      hry hips twist (+ near side forward)
//   sx  spine bend (+ forward)     sy  chest twist (+ near side forward)
//   hdx head tilt (+ down)         lie 0..1 blend to lying on the floor
//   fa/fz/fe  lead shoulder swing (- forward), outward, elbow (- flex)
//   ba/bz/be  rear arm            fl/flz/fk lead hip swing, outward, knee (+ flex)
//   bl/blz/bk rear leg
// ---------------------------------------------------------------------------
const KEYS = ['hrx', 'hry', 'sx', 'sy', 'hdx', 'lie', 'fa', 'fz', 'fe', 'ba', 'bz', 'be', 'fl', 'flz', 'fk', 'bl', 'blz', 'bk'];
const P = (o = {}) => { const p = {}; for (const k of KEYS) p[k] = 0; return Object.assign(p, o); };
const M = (base, o) => Object.assign({}, base, o);

export const STANCE = P({ hry: -0.25, sx: 0.12, sy: -0.1, hdx: -0.08, fa: -0.7, fz: 0.12, fe: -2.1, ba: -0.95, bz: 0.1, be: -2.2, fl: -0.5, flz: 0.1, fk: 0.75, bl: 0.3, blz: 0.1, bk: 0.15 });
const CROUCH = M(STANCE, { hrx: 0.12, sx: 0.35, fl: -1.4, flz: 0.15, fk: 2.5, bl: -1.1, blz: 0.15, bk: 2.5, fa: -0.8, ba: -1.0 });
const BLOCK = M(STANCE, { sx: 0.22, hdx: 0.12, fa: -1.15, fe: -2.5, fz: 0, ba: -1.3, be: -2.6, bz: 0, fl: -0.6, fk: 0.95, bl: 0.35, bk: 0.2 });
const BLOCK_C = M(CROUCH, { fa: -1.15, fe: -2.5, ba: -1.3, be: -2.6, fz: 0, bz: 0 });
const JUMP = M(STANCE, { fl: -1.0, fk: 1.7, bl: -0.5, bk: 1.5, sx: 0.2 });

const JAB_W = M(STANCE, { fa: -0.9, fe: -2.5, sy: -0.3, hry: -0.35 });
const JAB_A = M(STANCE, { fa: -1.52, fe: -0.05, fz: 0, sy: 0.4, hry: 0.1, sx: 0.2, fl: -0.6, bl: 0.5, bk: 0.1 });
const CROSS_W = M(STANCE, { ba: -0.6, be: -2.4, sy: 0.2, hry: 0.2, bl: 0.45 });
const CROSS_A = M(STANCE, { ba: -1.5, be: -0.05, bz: 0, sy: -0.5, hry: -0.6, sx: 0.22, bl: 0.1, bk: 0.1, fl: -0.7 });
// high kick: the knee chambers up, then the leg snaps past head height as the body leans away from it
const KICK_W = M(STANCE, { fl: -1.75, flz: 0.05, fk: 2.1, bl: 0.12, bk: 0.12, hrx: -0.12, sx: -0.1, fa: -0.5, fe: -1.9, ba: -0.8, be: -1.9 });
const KICK_A = M(STANCE, { fl: -2.2, flz: 0.05, fk: 0.04, bl: 0.1, blz: 0.04, bk: 0.06, hrx: -0.26, hry: 0.2, sx: -0.55, sy: -0.25, hdx: 0.3, fa: 0.35, fz: 0.55, fe: -0.9, ba: -0.75, bz: 0.45, be: -1.3 });
const UPPER_W = M(CROUCH, { fa: -0.5, fe: -2.0, sy: -0.4, hrx: 0.2, sx: 0.45 });
const UPPER_A = M(STANCE, { fa: -2.55, fe: -0.35, sy: 0.5, sx: -0.25, hrx: -0.1, fl: -0.7, fk: 1.1, bl: 0.2, bk: 0.3, hdx: -0.15 });
const SWEEP_W = M(CROUCH, { hrx: 0.25, sx: 0.5 });
const SWEEP_A = M(CROUCH, { bl: -1.15, bk: 0.1, blz: 0.05, fl: -1.35, fk: 2.6, sx: 0.45, hrx: 0.35, fa: -0.3, fe: -1.0, ba: -1.3, be: -1.0 });
const AIRKICK = M(STANCE, { fl: -1.45, fk: 0.1, bl: -0.9, bk: 1.8, sx: -0.35, hrx: -0.25, fa: -0.5, fe: -1.6, ba: -0.4, be: -1.4 });
const SPECIAL_W = M(STANCE, { fa: -0.7, fe: -1.6, ba: -0.7, be: -1.6, sx: 0.2, hrx: 0.1, fl: -0.7, fk: 1.0, bl: 0.5, bk: 0.4, hry: -0.4 });
const SPECIAL_A = M(STANCE, { fa: -1.5, fe: -0.05, ba: -1.5, be: -0.05, sx: 0.3, hrx: 0.1, fl: -0.8, fk: 1.0, bl: 0.5, bk: 0.3, hry: 0, sy: 0.2 });

const HIT_H = M(STANCE, { hrx: -0.15, sx: -0.35, hdx: -0.4, hry: 0.1, sy: 0.2, fa: -0.2, fe: -1.1, ba: -0.1, be: -1.0, fl: -0.3, fk: 0.5, bl: 0.4, bk: 0.3 });
const HIT_L = M(STANCE, { hrx: 0.35, sx: 0.7, hdx: 0.3, fa: -0.4, fe: -1.0, ba: -0.3, be: -1.0 });
const FALL_AIR = M(STANCE, { hrx: -0.9, sx: -0.3, hdx: -0.5, fa: -0.3, fe: -0.5, fz: 0.8, ba: -0.3, be: -0.4, bz: 0.8, fl: -0.3, fk: 0.4, bl: 0.2, bk: 0.3 });
const LYING = P({ lie: 1, hrx: -1.5, hdx: -0.2, fa: 0.2, fe: -0.4, fz: 0.5, ba: 0.1, be: -0.3, bz: 0.5, fl: 0.1, flz: 0.25, fk: 0.2, bl: -0.1, blz: 0.25, bk: 0.15 });
const GETUP = M(CROUCH, { hrx: 0.2, sx: 0.5 });
const WIN = M(STANCE, { fa: -2.95, fe: -0.15, fz: 0.35, ba: -2.95, be: -0.15, bz: 0.35, sx: -0.1, hdx: -0.3, fl: -0.15, fk: 0.3, bl: 0.15, bk: 0.2, hry: -0.1 });
const LOSE = M(STANCE, { sx: 0.5, hdx: 0.4, fa: -0.1, fe: -0.3, ba: -0.1, be: -0.3, fl: -0.2, fk: 0.3, bl: 0.1, bk: 0.2 });

export const POSES = { STANCE, CROUCH, BLOCK, BLOCK_C, JUMP, JAB_A, CROSS_A, KICK_A, UPPER_A, SWEEP_A, AIRKICK, SPECIAL_A, HIT_H, HIT_L, WIN, LOSE, LYING, GETUP };

// ---------------------------------------------------------------------------
// Attack data. up = windup, act = active window, rec = recovery (seconds),
// rad = strike sphere radius, level decides what blocks it.
// ---------------------------------------------------------------------------
export const ATTACKS = {
  jab:      { name: 'jab', up: 0.07, act: 0.08, rec: 0.15, rad: 0.17, poses: { windup: JAB_W, active: JAB_A }, strike: 'leadHand', dmg: 5, kb: 1.6, stun: 0.30, level: 'high', lunge: 1.6, hitstop: 0.05, shake: 0.15 },
  cross:    { name: 'cross', up: 0.10, act: 0.08, rec: 0.18, rad: 0.19, poses: { windup: CROSS_W, active: CROSS_A }, strike: 'rearHand', dmg: 7, kb: 2.4, stun: 0.34, level: 'high', lunge: 1.8, hitstop: 0.06, shake: 0.2 },
  kick:     { name: 'kick', up: 0.15, act: 0.12, rec: 0.26, rad: 0.26, poses: { windup: KICK_W, active: KICK_A }, strike: 'leadFoot', dmg: 10, kb: 3.4, stun: 0.42, level: 'mid', lunge: 2.0, hitstop: 0.08, shake: 0.35 },
  uppercut: { name: 'uppercut', up: 0.13, act: 0.10, rec: 0.32, rad: 0.30, poses: { windup: UPPER_W, active: UPPER_A }, strike: 'leadHand', dmg: 13, kb: 3.0, knockdown: true, level: 'high', lunge: 0.8, hitstop: 0.12, shake: 0.6 },
  sweep:    { name: 'sweep', up: 0.16, act: 0.12, rec: 0.30, rad: 0.30, poses: { windup: SWEEP_W, active: SWEEP_A }, strike: 'rearFoot', dmg: 9, kb: 2.5, knockdown: true, level: 'low', lunge: 1.0, hitstop: 0.09, shake: 0.4 },
  airKick:  { name: 'airKick', air: true, up: 0, act: 99, rec: 0, rad: 0.24, poses: { windup: AIRKICK, active: AIRKICK }, strike: 'leadFoot', dmg: 9, kb: 3.0, stun: 0.40, level: 'high', hitstop: 0.07, shake: 0.3 },

  // Signature specials, one per fighter (see roster.js). cost = meter spent, ai = [min, max] distance the CPU uses it at.
  //   spawn: fires a shot   dash: speed during the active window   intangible: can't be hit through windup + active
  //   teleport: reappears behind the opponent when active starts   buff: seconds of armor
  //   heal: health restored   drain: share of damage dealt returned as health
  frostShard: { name: 'frostShard', cost: 50, ai: [2.2, 99], up: 0.20, act: 0.10, rec: 0.30, rad: 0, poses: { windup: SPECIAL_W, active: SPECIAL_A }, spawn: { name: 'frostShot', ranged: true, speed: 9.5, life: 2.4, dmg: 10, kb: 1, stun: 0.3, freeze: 1.3, level: 'mid', hitstop: 0.1, shake: 0.4 }, dmg: 0, level: 'mid', lunge: 0 },
  bladeRush:  { name: 'bladeRush', cost: 50, ai: [1.2, 3.6], up: 0.14, act: 0.30, rec: 0.42, rad: 0.42, poses: { windup: SPECIAL_W, active: SPECIAL_A }, strike: 'leadHand', dash: 10, intangible: true, dmg: 15, kb: 3.4, knockdown: true, level: 'mid', hitstop: 0.12, shake: 0.6 },
  shadowStep: { name: 'shadowStep', cost: 50, ai: [1.6, 99], up: 0.30, act: 0.14, rec: 0.36, rad: 0.32, poses: { windup: SPECIAL_W, active: KICK_A }, strike: 'leadFoot', teleport: true, intangible: true, dmg: 14, kb: 3.2, knockdown: true, level: 'mid', lunge: 1.0, hitstop: 0.12, shake: 0.55 },
  quake:      { name: 'quake', cost: 50, ai: [1.4, 6], up: 0.30, act: 0.10, rec: 0.32, rad: 0, poses: { windup: WIN, active: CROUCH }, spawn: { name: 'quakeWave', ranged: true, speed: 6.5, life: 1.5, y: 0.14, dmg: 12, kb: 3, knockdown: true, level: 'low', hitstop: 0.1, shake: 0.6 }, dmg: 0, level: 'mid', lunge: 0 },
  galeBlast:  { name: 'galeBlast', cost: 50, ai: [1, 5], up: 0.20, act: 0.10, rec: 0.30, rad: 0, poses: { windup: SPECIAL_W, active: SPECIAL_A }, spawn: { name: 'galeShot', ranged: true, speed: 11, life: 1.6, dmg: 6, kb: 11, stun: 0.5, level: 'mid', hitstop: 0.08, shake: 0.35 }, dmg: 0, level: 'mid', lunge: 0 },
  soulDrain:  { name: 'soulDrain', cost: 50, ai: [0, 1.9], up: 0.16, act: 0.14, rec: 0.34, rad: 0.3, poses: { windup: SPECIAL_W, active: SPECIAL_A }, strike: 'leadHand', drain: 0.75, dmg: 12, kb: 2.6, stun: 0.5, level: 'mid', lunge: 3.2, hitstop: 0.12, shake: 0.5 },
  secondWind: { name: 'secondWind', cost: 50, ai: [2, 99], up: 0.30, act: 0.10, rec: 0.30, rad: 0, poses: { windup: SPECIAL_W, active: WIN }, heal: 22, dmg: 0, level: 'mid', lunge: 0 },
  overdrive:  { name: 'overdrive', cost: 50, ai: [0, 2.6], up: 0.22, act: 0.10, rec: 0.22, rad: 0, poses: { windup: SPECIAL_W, active: WIN }, buff: 3.5, dmg: 0, level: 'mid', lunge: 0 },
};
// While armored (overdrive): damage taken and damage dealt multipliers.
const ARMOR_TAKEN = 0.7;
const ARMOR_POWER = 1.1;

// Model lives in model.js. Foot-grounding math below uses its leg constants.
const ankleRel = (a, c, k) => LEG * (-Math.cos(c) * Math.cos(a)) + LEG * (-Math.cos(k) * Math.cos(c) * Math.cos(a) + Math.sin(k) * Math.sin(a));
export const groundHipY = (p) => ANKLE_H - Math.min(ankleRel(p.fl, p.flz, p.fk), ankleRel(p.bl, p.blz, p.bk));
export const footMismatch = (p) => Math.abs(ankleRel(p.fl, p.flz, p.fk) - ankleRel(p.bl, p.blz, p.bk));

// ---------------------------------------------------------------------------
const WALK = 2.7;
const RUN = 4;     // forward only, so you can rush in but not sprint away
const BACK = 2;    // backing off is slower than advancing
export const WALK_AXIS = 0.84; // a stick pushed past this runs
const JUMP_V = 5.8;
const GRAV = 16;
const _v = new THREE.Vector3();
const _sp = { x: 0, y: 0, z: 0 };
const pickMax = (a, b, c) => (Math.abs(a) >= Math.abs(b) && Math.abs(a) >= Math.abs(c) ? a : Math.abs(b) >= Math.abs(c) ? b : c);

export class Fighter {
  constructor(cfg, idx, G) {
    this.cfg = cfg;
    this.name = cfg.name;
    this.idx = idx;
    this.G = G;
    this.m = buildModel(cfg);
    this.inp = { padX: 0, padY: 0, kbX: 0, kbY: 0, aiX: 0, aiY: 0, padBlock: false, kbBlock: false, aiBlock: false, buf: { punch: -1, kick: -1, special: -1 } };
    this.cur = P(STANCE);
    this.tmp = P();
    this.meter = 0;
    this.maxHp = 100;
    this.walkPhase = 0;
    this.punchToggle = false;
    this.atkId = 0;
    this.hidden = false;
    this.reset(idx === 0 ? -1.3 : 1.3);
  }

  // swap the character model (used by character select)
  rebuild(cfg) {
    this.skin?.remove();
    this.skin = null;
    const parent = this.m.root.parent;
    if (parent) parent.remove(this.m.root);
    this.m.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.cfg = cfg;
    this.name = cfg.name;
    this.m = buildModel(cfg);
    if (parent) parent.add(this.m.root);
    this.reset(this.x, true);
  }

  reset(x, keepMeter = true) {
    this.x = x; this.y = 0; this.vx = 0; this.vy = 0; this.push = 0;
    this.hp = this.maxHp;
    if (!keepMeter) this.meter = 0;
    this.state = 'intro'; this.stateT = 0; this.stunTime = 0;
    this.onGround = true; this.crouching = false; this.blocking = false;
    this.atk = null; this.atkT = 0; this.phase = 'windup'; this.hasHit = false; this.spawned = false;
    this.kdPhase = 'down'; this.comboHits = 0; this.invuln = 0; this.hitLow = false;
    this.frozen = false; this.armor = 0;
    this.clock = 0;
    for (const k of Object.keys(this.inp.buf)) this.inp.buf[k] = -1;
    this.inp.aiX = this.inp.aiY = 0; this.inp.aiBlock = false;
    this.facingRight = this.idx === 0;
    Object.assign(this.cur, STANCE);
    this.m.root.rotation.y = this.yawTarget();
    this.applyPose(this.cur);
    this.m.root.position.set(this.x, this.y, 0);
    this.m.root.updateMatrixWorld(true);
  }

  // ---- input ---------------------------------------------------------------
  press(name) { this.inp.buf[name] = this.clock + 0.16; }
  consume(name) { if (this.inp.buf[name] > this.clock) { this.inp.buf[name] = -1; return true; } return false; }
  setAxis(src, x, y) { this.inp[src + 'X'] = x; this.inp[src + 'Y'] = y; }
  setBlock(src, v) { this.inp[src + 'Block'] = v; }
  blockHeld() { return this.inp.padBlock || this.inp.kbBlock || this.inp.aiBlock; }
  axis() { const i = this.inp; return { x: pickMax(i.padX, i.kbX, i.aiX), y: pickMax(i.padY, i.kbY, i.aiY) }; }
  yawTarget() { return this.facingRight ? Math.PI / 2 - 0.3 : -Math.PI / 2 + 0.3; }
  get busy() { return this.state !== 'idle'; }
  get specialAtk() { return ATTACKS[this.cfg.special]; }
  canSpecial() { const s = this.specialAtk; return this.meter >= s.cost && !(s.buff && this.armor > 0) && !(s.heal && this.hp >= this.maxHp); }

  setMode(mode) { this.state = mode; this.stateT = 0; this.vx = 0; this.push = 0; this.atk = null; this.frozen = false; }

  // ---- main update ----------------------------------------------------------
  update(dt, opp) {
    this.clock += dt;
    this.stateT += dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.armor > 0) this.armor -= dt;
    if (this.onGround && this.state !== 'knockdown' && this.state !== 'ko') this.facingRight = opp.x >= this.x;

    switch (this.state) {
      case 'idle': this.updateIdle(dt, opp); break;
      case 'attack': this.updateAttack(dt, opp); break;
      case 'hitstun': case 'blockstun':
        if (this.stateT >= this.stunTime) { this.state = 'idle'; this.stateT = 0; this.comboHits = 0; this.frozen = false; }
        break;
      case 'knockdown': case 'ko': this.updateKnockdown(); break;
      default: this.vx = 0; // intro, win, lose
    }

    this.integrate(dt);
    if (Math.abs(this.vx) > 0.2 && this.state === 'idle') this.walkPhase += Math.abs(this.vx) * dt * 3.4;
    this.computePose(dt);
    const yaw = this.yawTarget();
    this.m.root.rotation.y += (yaw - this.m.root.rotation.y) * (1 - Math.exp(-18 * dt));
    this.m.root.position.set(this.x, this.y, 0);
    this.m.root.visible = !this.hidden && !(this.state === 'attack' && this.atk.teleport && this.phase === 'windup');
    this.m.root.updateMatrixWorld(true);
  }

  moveSpeed(ix) {
    const push = Math.abs(ix), side = Math.sign(ix);
    const walked = Math.min(1, push / WALK_AXIS);
    if (side !== (this.facingRight ? 1 : -1)) return side * walked * BACK;
    return side * (push > WALK_AXIS ? RUN : walked * WALK);
  }

  updateIdle(dt, opp) {
    const a = this.axis();
    const ix = Math.abs(a.x) < 0.3 ? 0 : a.x;
    const iy = a.y;
    this.blocking = this.onGround && this.blockHeld();
    this.crouching = this.onGround && iy > 0.55;

    if (this.onGround) {
      if (this.consume('special') && this.canSpecial()) { this.startAttack(this.cfg.special); return; }
      if (this.consume('punch')) {
        this.startAttack(this.crouching ? 'uppercut' : (this.punchToggle ? 'cross' : 'jab'));
        this.punchToggle = !this.punchToggle;
        return;
      }
      if (this.consume('kick')) { this.startAttack(this.crouching ? 'sweep' : 'kick'); return; }
      if (this.blocking || this.crouching) this.vx = 0;
      else this.vx = this.moveSpeed(ix);
      if (iy < -0.6 && !this.crouching && !this.blocking) {
        this.vy = JUMP_V; this.onGround = false; this.vx = ix * WALK * 1.15;
      }
    } else if (this.consume('kick')) {
      this.startAttack('airKick');
    }
  }

  startAttack(name) {
    const a = ATTACKS[name];
    this.state = 'attack'; this.stateT = 0; this.atk = a; this.atkT = 0; this.atkId++;
    this.hasHit = false; this.spawned = false; this.phase = 'windup';
    if (a.cost) { this.meter -= a.cost; this.G.onSpecial?.(this, a, 'start'); }
    if (a.intangible) this.invuln = Math.max(this.invuln, a.up + a.act);
    this.crouching = false; this.blocking = false;
  }

  endAttack() { this.state = 'idle'; this.stateT = 0; this.atk = null; this.vx = this.onGround ? 0 : this.vx; }

  updateAttack(dt, opp) {
    const a = this.atk;
    this.atkT += dt;
    let phase;
    if (a.air) phase = 'active';
    else if (this.atkT < a.up) phase = 'windup';
    else if (this.atkT < a.up + a.act) phase = 'active';
    else if (this.atkT < a.up + a.act + a.rec) phase = 'recover';
    else { this.endAttack(); return; }
    if (phase !== this.phase) {
      this.phase = phase;
      if (phase === 'active') {
        if (a.teleport) this.teleportBehind(opp);
        this.G.onSwing?.(this, a);
      }
    }
    const dir = this.facingRight ? 1 : -1;
    if (this.onGround) {
      if (a.dash && phase === 'active') this.vx = this.hasHit ? 0 : dir * a.dash;
      else this.vx = (phase === 'windup' || phase === 'active') ? dir * (a.lunge || 0) : 0;
    }

    if (phase === 'active' && !this.hasHit && a.strike) {
      const sp = this.strikePos(a.strike);
      if (opp.hurtTest(sp, a.rad)) {
        const res = opp.receiveHit(a, this, dir, sp);
        if (res !== 'miss') this.hasHit = true;
      }
    }
    if (a.spawn && phase === 'active' && !this.spawned) {
      this.spawned = true;
      this.G.spawnProjectile(this, a.spawn);
    }
    if ((a.buff || a.heal) && phase === 'active' && !this.spawned) {
      this.spawned = true;
      if (a.buff) this.armor = a.buff;
      if (a.heal) this.hp = Math.min(this.maxHp, this.hp + a.heal);
      this.G.onSpecial?.(this, a, 'buff');
    }
  }

  // lands on the far side of the opponent, or the near side if a wall is in the way
  teleportBehind(opp) {
    const side = Math.sign(opp.x - this.x) || 1;
    const x = opp.x + side * 0.8;
    this.x = Math.abs(x) <= STAGE_LIMIT ? x : opp.x - side * 0.8;
    this.facingRight = opp.x >= this.x;
    this.m.root.rotation.y = this.yawTarget();
    this.m.root.position.set(this.x, this.y, 0);
    this.m.root.updateMatrixWorld(true);
    this.G.onSpecial?.(this, this.atk, 'appear');
  }

  strikePos(which) {
    const lead = this.facingRight ? this.m.R : this.m.L;
    const rear = this.facingRight ? this.m.L : this.m.R;
    const side = which.startsWith('lead') ? lead : rear;
    (which.endsWith('Hand') ? side.hand : side.foot).getWorldPosition(_v);
    _sp.x = _v.x; _sp.y = _v.y; _sp.z = 0;
    return _sp;
  }

  hurtTest(p, rad) {
    for (const h of this.m.hurt) {
      h.obj.getWorldPosition(_v);
      const dx = _v.x - p.x, dy = _v.y - p.y, rr = h.r + rad;
      if (dx * dx + dy * dy < rr * rr) return true;
    }
    return false;
  }

  receiveHit(atk, attacker, dir, pt) {
    if (this.state === 'knockdown' || this.state === 'ko' || this.state === 'win' || this.state === 'lose' || this.state === 'intro' || this.invuln > 0) return 'miss';
    const hitPt = { x: pt.x, y: pt.y, z: 0 };
    const G = this.G;
    const canBlock = (this.state === 'idle' || this.state === 'blockstun') && this.onGround && this.blockHeld() && !(atk.level === 'low' && !this.crouching);

    if (canBlock) {
      const chip = Math.max(1, atk.dmg * 0.12);
      this.hp = Math.max(1, this.hp - chip);
      this.state = 'blockstun'; this.stateT = 0; this.stunTime = 0.2; this.atk = null;
      this.push = dir * 1.8;
      if (!atk.ranged) attacker.push = -dir * 1.2;
      this.meter = Math.min(100, this.meter + 3);
      G.onHit?.({ type: 'block', attacker, defender: this, pt: hitPt, atk, dmg: chip, dir, ko: false });
      return 'block';
    }

    this.comboHits = this.state === 'hitstun' ? this.comboHits + 1 : 1;
    const scale = Math.max(0.4, 1 - 0.1 * (this.comboHits - 1));
    const armored = this.armor > 0;
    const dmg = atk.dmg * scale * (attacker.armor > 0 ? ARMOR_POWER : 1) * (armored ? ARMOR_TAKEN : 1);
    const wasFrozen = this.frozen;
    this.frozen = false;
    this.hp = Math.max(0, this.hp - dmg);
    if (atk.drain) attacker.hp = Math.min(attacker.maxHp, attacker.hp + dmg * atk.drain);
    attacker.meter = Math.min(100, attacker.meter + dmg * 1.8);
    this.meter = Math.min(100, this.meter + dmg * 1.2);
    const ko = this.hp <= 0;
    if (armored && !ko) {
      this.push = dir * atk.kb * 0.25; // armor keeps them on their feet and mid-move
    } else if (ko || atk.knockdown || !this.onGround) {
      this.knockDown(dir, ko, atk);
    } else {
      // a shard landing on someone already frozen shatters the ice instead of extending it
      this.frozen = !!atk.freeze && !wasFrozen;
      // each extra hit in a chain stuns for less, so no string can run forever
      const stun = atk.stun * Math.max(0.4, 1 - 0.2 * (this.comboHits - 1));
      this.state = 'hitstun'; this.stateT = 0; this.stunTime = this.frozen ? atk.freeze : stun; this.atk = null;
      this.push = this.frozen ? 0 : dir * atk.kb;
      this.hitLow = hitPt.y < 1.15;
    }
    G.onHit?.({ type: 'hit', attacker, defender: this, pt: hitPt, atk, dmg, dir, ko, armored });
    return 'hit';
  }

  knockDown(dir, ko, atk) {
    this.state = ko ? 'ko' : 'knockdown'; this.stateT = 0; this.kdPhase = 'air'; this.atk = null;
    this.vy = 4.0 + (atk.kb || 3) * 0.2; this.onGround = false;
    this.vx = dir * (2.4 + (atk.kb || 3) * 0.3);
    this.push = 0; this.crouching = false; this.blocking = false;
  }

  updateKnockdown() {
    if (this.kdPhase === 'down') {
      if (this.state === 'ko') return;
      if (this.stateT > 0.85) { this.kdPhase = 'getup'; this.stateT = 0; }
    } else if (this.kdPhase === 'getup') {
      if (this.stateT > 0.45) { this.state = 'idle'; this.stateT = 0; this.invuln = 0.35; this.comboHits = 0; }
    }
  }

  integrate(dt) {
    this.x += (this.vx + this.push) * dt;
    this.push *= Math.exp(-9 * dt);
    if (!this.onGround || this.vy > 0) {
      this.vy -= GRAV * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        const speed = -this.vy;
        this.y = 0; this.vy = 0; this.onGround = true;
        this.onLanded(speed);
      } else this.onGround = false;
    }
  }

  onLanded(speed) {
    this.vx = 0;
    if (this.state === 'knockdown' || this.state === 'ko') {
      this.kdPhase = 'down'; this.stateT = 0;
      this.G.onLand?.(this, speed, true);
    } else {
      if (this.state === 'attack' && this.atk && this.atk.air) this.endAttack();
      this.G.onLand?.(this, speed, false);
    }
  }

  // ---- pose -------------------------------------------------------------------
  targetPose() {
    const t = this.tmp;
    let base = STANCE, rate = 12;
    switch (this.state) {
      case 'idle':
        if (!this.onGround) base = JUMP;
        else if (this.crouching) base = this.blocking ? BLOCK_C : CROUCH;
        else base = this.blocking ? BLOCK : STANCE;
        break;
      case 'attack':
        base = this.atk.poses[this.phase === 'active' ? 'active' : 'windup'];
        rate = this.phase === 'recover' ? 14 : 30;
        if (this.phase === 'recover') base = STANCE;
        break;
      case 'hitstun': base = this.hitLow ? HIT_L : HIT_H; rate = this.frozen ? 0 : 32; break;
      case 'blockstun': base = this.crouching ? BLOCK_C : BLOCK; rate = 30; break;
      case 'knockdown': case 'ko':
        base = this.kdPhase === 'air' ? FALL_AIR : this.kdPhase === 'getup' ? GETUP : LYING;
        rate = this.kdPhase === 'down' ? 14 : 18;
        break;
      case 'win': base = WIN; rate = 6; break;
      case 'lose': base = LOSE; rate = 5; break;
      default: base = STANCE;
    }
    Object.assign(t, base);
    if (this.state === 'idle' || this.state === 'intro') {
      const b = Math.sin(this.clock * 2.4);
      t.sx += b * 0.018; t.hdx += b * 0.01; t.fe += b * 0.05; t.be -= b * 0.04;
    }
    if (this.state === 'idle' && this.onGround && !this.crouching && !this.blocking && Math.abs(this.vx) > 0.4) {
      const s = Math.sin(this.walkPhase);
      t.fl += s * 0.5; t.bl -= s * 0.5;
      t.fk += Math.max(0, -s) * 0.5; t.bk += Math.max(0, s) * 0.5;
    }
    this.rate = rate;
    return t;
  }

  computePose(dt) {
    const t = this.targetPose();
    const k = 1 - Math.exp(-this.rate * dt);
    for (const key of KEYS) this.cur[key] += (t[key] - this.cur[key]) * k;
    this.applyPose(this.cur);
  }

  applyPose(p) {
    const m = this.m;
    const s = this.facingRight ? 1 : -1;
    const lead = this.facingRight ? m.R : m.L;
    const rear = this.facingRight ? m.L : m.R;
    const zl = (side) => (side === m.L ? 1 : -1);
    lead.sh.rotation.set(p.fa, 0, p.fz * zl(lead));
    lead.el.rotation.x = p.fe;
    rear.sh.rotation.set(p.ba, 0, p.bz * zl(rear));
    rear.el.rotation.x = p.be;
    lead.hip.rotation.set(p.fl, 0, p.flz * zl(lead));
    lead.kn.rotation.x = p.fk;
    rear.hip.rotation.set(p.bl, 0, p.blz * zl(rear));
    rear.kn.rotation.x = p.bk;
    m.hips.rotation.set(p.hrx, p.hry * s, 0);
    m.spine.rotation.set(p.sx, p.sy * s, 0);
    m.head.rotation.x = p.hdx;
    const gy = groundHipY(p);
    m.hips.position.y = gy + (0.2 - gy) * p.lie;
  }
}
