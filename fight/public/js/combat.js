export const STAGE_LIMIT = 5.0;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Rendering-free combat world: two fighters + projectiles. Emits events so the
// view layer (main.js) can add effects, and so it can be simulated headless.
export class Combat {
  constructor(fighters, events = {}) {
    this.fighters = fighters;
    this.ev = events;
    this.projectiles = [];
    this.nextId = 1;
    for (const f of fighters) f.G = this;
  }

  // callbacks fighters call on us
  onHit(e) { this.ev.onHit?.(e); }
  onLand(f, speed, strong) { this.ev.onLand?.(f, speed, strong); }
  onSwing(f, a) { this.ev.onSwing?.(f, a); }
  onSpecial(f, a, stage) { this.ev.onSpecial?.(f, a, stage); }

  spawnProjectile(owner, shot) {
    const dir = owner.facingRight ? 1 : -1;
    const p = { id: this.nextId++, owner, shot, dir, x: owner.x + dir * 0.7, y: owner.y + (shot.y ?? 1.3), speed: shot.speed, life: shot.life, alive: true };
    this.projectiles.push(p);
    this.ev.onProjectileSpawn?.(p);
  }

  killProjectile(p, hit) {
    if (!p.alive) return;
    p.alive = false;
    this.ev.onProjectileDie?.(p, hit);
  }

  clearProjectiles() {
    for (const p of this.projectiles) this.killProjectile(p, false);
    this.projectiles = [];
  }

  update(dt) {
    const [a, b] = this.fighters;
    a.update(dt, b);
    b.update(dt, a);

    for (const f of this.fighters) f.x = clamp(f.x, -STAGE_LIMIT, STAGE_LIMIT);

    // body separation (a jumper can pass over, a fighter on the floor is walked through)
    const down = (f) => f.state === 'knockdown' || f.state === 'ko';
    const dx = b.x - a.x;
    const min = 0.62;
    if (Math.abs(dx) < min && a.y < 0.6 && b.y < 0.6 && !down(a) && !down(b)) {
      const s = Math.sign(dx) || (a.idx === 0 ? 1 : -1);
      const push = (min - Math.abs(dx)) / 2;
      a.x -= s * push; b.x += s * push;
      for (const f of this.fighters) f.x = clamp(f.x, -STAGE_LIMIT, STAGE_LIMIT);
    }

    // projectiles
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.x += p.dir * p.speed * dt;
      p.life -= dt;
      if (p.life <= 0 || Math.abs(p.x) > STAGE_LIMIT + 4) { this.killProjectile(p, false); continue; }
      const tgt = p.owner === a ? b : a;
      if (tgt.hurtTest(p, 0.16)) {
        const res = tgt.receiveHit(p.shot, p.owner, p.dir, { x: p.x, y: p.y, z: 0 });
        if (res !== 'miss') this.killProjectile(p, true);
      }
    }
    for (let i = 0; i < this.projectiles.length; i++) {
      for (let j = i + 1; j < this.projectiles.length; j++) {
        const p = this.projectiles[i], q = this.projectiles[j];
        if (p.alive && q.alive && p.owner !== q.owner && Math.abs(p.x - q.x) < 0.5) {
          this.killProjectile(p, true);
          this.killProjectile(q, true);
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.alive);
  }
}
