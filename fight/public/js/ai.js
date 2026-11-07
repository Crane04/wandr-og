import { WALK_AXIS } from './fighter.js';

// Simple reactive opponent. level 0..1 scales reaction, blocking and aggression. It has to
// see an attack and react like a person does, so fast moves can beat it and it leaves gaps.
// CPU dial per difficulty, tuned so a sloppy player (mashing, rushing, rarely
// guarding) wins about 85% / 55% / 20% / almost never. Checked in test/sim.mjs.
export const DIFFICULTY = { easy: 0.42, medium: 0.57, hard: 0.71, expert: 0.9 };

export class AIBrain {
  constructor(level = 0.6) {
    this.level = level;
    this.t = 0;
    this.clock = 0;
    this.blockUntil = 0;
    this.yUntil = 0;
    this.seenAtk = 0;
    this.reactAt = -1;
    this.punishAt = -1;
    this.punished = 0;
    this.rushCheck = 0;
    this.wasHit = false;
  }

  // reading the player is what makes the CPU feel unbeatable, so it stays rare until the top levels
  get skill() { return this.level ** 2.5; }

  clear(me) {
    me.inp.aiX = 0; me.inp.aiY = 0; me.inp.aiBlock = false;
  }

  think(me, opp, dt) {
    this.clock += dt;
    this.t -= dt;
    const inp = me.inp;
    if (this.clock > this.blockUntil) inp.aiBlock = false;
    if (this.clock > this.yUntil) inp.aiY = 0;

    const dx = opp.x - me.x;
    const dist = Math.abs(dx);
    const toward = Math.sign(dx) || 1;

    // a swing that is recovering can't be blocked out of, so that's when to hit back.
    // Noticed even mid-block, as a good player plans the counter while guarding.
    if (opp.state === 'attack' && opp.phase === 'recover' && opp.atkId !== this.punished && dist < 1.8) {
      this.punished = opp.atkId;
      if (Math.random() < this.skill * 0.75) this.punishAt = this.clock + 0.16 - this.level * 0.13;
    }

    if (me.state !== 'idle') { inp.aiX = 0; this.wasHit ||= me.state === 'hitstun'; return; }

    // coming out of a hit next to someone still swinging: guard, don't stand there
    if (this.wasHit) {
      this.wasHit = false;
      if (dist < 1.8 && Math.random() < 0.1 + this.skill * 0.7) {
        inp.aiBlock = true; inp.aiX = 0;
        this.blockUntil = this.clock + 0.3;
      }
    }

    if (this.punishAt > 0 && this.clock >= this.punishAt) {
      const late = this.clock - this.punishAt > 0.3;
      this.punishAt = -1;
      // only drop the guard if they really are still open, not already swinging again
      const open = opp.state !== 'attack' || opp.phase === 'recover';
      if (!late && open && dist < 1.8) {
        inp.aiBlock = false; inp.aiX = 0;
        me.press(dist > 1.25 ? 'kick' : 'punch');
        return;
      }
    }

    // someone sprinting in has committed, so meet them with a kick as they arrive
    const rushing = Math.abs(opp.vx) > 3.2 && Math.sign(opp.vx) === -toward;
    if (rushing && dist < 1.9 && this.clock > this.rushCheck) {
      this.rushCheck = this.clock + 0.6;
      if (Math.random() < this.skill * 0.5) { inp.aiX = 0; me.press('kick'); return; }
    }

    // notice an incoming attack once per swing, then react after a human delay
    if (opp.state === 'attack' && opp.atkId !== this.seenAtk && dist < 1.9) {
      this.seenAtk = opp.atkId;
      if (Math.random() < 0.15 + this.level * 0.65) this.reactAt = this.clock + 0.28 - this.level * 0.22;
    }
    if (this.reactAt > 0 && this.clock >= this.reactAt) {
      this.reactAt = -1;
      if (opp.state === 'attack') {
        inp.aiBlock = true;
        this.blockUntil = this.clock + 0.45;
        if (opp.atk && opp.atk.level === 'low') { inp.aiY = 1; this.yUntil = this.clock + 0.45; }
        inp.aiX = 0;
        return;
      }
    }

    if (inp.aiBlock) return;
    if (this.t > 0) return;
    this.t = 0.1 + (1 - this.level) * 0.34 + Math.random() * 0.22;
    const r = Math.random();

    const [spMin, spMax] = me.specialAtk.ai;
    if (me.onGround && me.canSpecial() && (!me.specialAtk.heal || me.hp < 70) && dist >= spMin && dist <= spMax && r < 0.08 + this.level * 0.25) {
      me.press('special');
      inp.aiX = 0;
      return;
    }

    if (dist > 2.7) {
      inp.aiX = dist > 3.6 ? toward : toward * WALK_AXIS; // runs in from far away
      if (r > 0.93 && me.onGround) { inp.aiY = -1; this.yUntil = this.clock + 0.12; }
    } else if (dist > 1.5) {
      inp.aiX = r < 0.7 ? toward * WALK_AXIS : 0;
      if (r > 0.78) me.press('kick');
    } else {
      inp.aiX = 0;
      if (Math.random() > 0.62 + this.level * 0.5) return; // hesitates, which is the player's opening
      if (r < 0.34) me.press('punch');
      else if (r < 0.54) me.press('kick');
      else if (r < 0.64) { inp.aiY = 1; this.yUntil = this.clock + 0.2; me.press('punch'); }
      else if (r < 0.74) { inp.aiY = 1; this.yUntil = this.clock + 0.2; me.press('kick'); }
      else if (r < 0.87) inp.aiX = -toward;
      else { inp.aiBlock = true; this.blockUntil = this.clock + 0.4; }
    }
  }
}
