// The 3D world, drawn by three.js on the phone's GPU through expo-gl. It uses the same
// stage, fighters, bodies and animation code as the website (src/game is synced from it),
// and the same hit effects, hit-stop and camera as the website's main.js.
import * as THREE from 'three';
import type { ExpoWebGLRenderingContext } from 'expo-gl';
import { Fighter } from './game/fighter.js';
import { Combat } from './game/combat.js';
import { ROSTER } from './game/roster.js';
import { buildStage } from './game/stage.js';
import { FX, glowTexture } from './game/fx.js';
import { Blood } from './game/blood.js';
import { dress, preload } from './game/skin.js';

// James is added by the website's main.js, which the app doesn't share
const kain = ROSTER.find((c) => c.name === 'KAIN')!;
if (!ROSTER.some((c) => c.name === 'JAMES')) {
  ROSTER.push({ ...kain, name: 'JAMES', title: 'THE STREET FIGHTER', skinModel: 'james', quote: 'Same time tomorrow? Bring friends.' });
}
export type FighterCfg = (typeof ROSTER)[number];
export { ROSTER };

const STEP = 1 / 60;

// three.js turns away anything that is an `instanceof WebGLRenderingContext`, to keep
// out WebGL 1. expo-gl's WebGL 2 context passes that test too, because its WebGL 2 type
// is built on its WebGL 1 type. So the real WebGL 2 features are checked here, and the
// WebGL 1 name is hidden from three.js only while the renderer is created.
function createRenderer(gl: ExpoWebGLRenderingContext, canvas: HTMLCanvasElement) {
  const g = gl as unknown as Record<string, unknown>;
  if (typeof g.texStorage2D !== 'function' || typeof g.createVertexArray !== 'function') {
    throw new Error('This phone does not support WebGL 2, which the game needs');
  }
  const global = globalThis as unknown as Record<string, unknown>;
  const webgl1 = global.WebGLRenderingContext;
  global.WebGLRenderingContext = undefined;
  try {
    return new THREE.WebGLRenderer({ canvas, context: gl as unknown as WebGL2RenderingContext });
  } finally {
    global.WebGLRenderingContext = webgl1;
  }
}

type Projectile = { id: number; x: number; y: number; dir: number; owner: Fighter };
export type Feedback = { hit?: number; block?: boolean; ko?: boolean }; // for haptics

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 300);
  fighters: Fighter[];
  combat: Combat;
  stage: { update(t: number, dt: number): void };
  fx: FX;
  blood: Blood;
  colors = [0xffffff, 0xffffff];
  combo = [{ n: 0, t: 0 }, { n: 0, t: 0 }];

  paused = false;
  hitstop = 0;
  shake = 0;
  timeScale = 1;
  lobby = true; // slow, wide camera drift on the menu
  focus: Fighter | null = null; // the camera leans on whoever was knocked out

  onStep?: (dt: number) => void; // the match rules, at a fixed 60 steps a second
  onFeedback?: (f: Feedback, idx: number) => void;
  onReady?: () => void;
  private readyIn = -1;
  private drawn: (() => void)[] = [];

  // Resolves once the given bodies are in, their shaders compiled and a frame drawn, so a
  // fight starts without a hitch.
  async warm(bodies: Promise<unknown>[]) {
    await Promise.all(bodies);
    this.renderer.compile(this.scene, this.camera);
    await new Promise<void>((r) => this.drawn.push(r));
  }
  stats = { fps: 0, ms: 0, calls: 0, tris: 0 };
  private statT = 0;
  private statFrames = 0;
  private statMs = 0;

  private raf = 0;
  private last = 0;
  private acc = 0;
  private clock = 0;
  private camX = 0;
  private camDist = 6.2;
  private fireLights: { l: THREE.PointLight; used: boolean }[];
  private fire = new Map<number, { g: THREE.Group; lt?: { l: THREE.PointLight; used: boolean } }>();
  private iceShells: THREE.Mesh[];
  private armorGlows: THREE.Sprite[];

  constructor(private gl: ExpoWebGLRenderingContext) {
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    // three.js expects a canvas; expo-gl gives a bare context, so it gets a stand-in
    const canvas = {
      width: w, height: h, clientWidth: w, clientHeight: h, style: {},
      addEventListener() {}, removeEventListener() {}, getContext: () => gl,
    } as unknown as HTMLCanvasElement;
    this.renderer = createRenderer(gl, canvas);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    this.stage = buildStage(this.scene, this.renderer);
    // phones: one shadow map at half the website's size
    this.scene.traverse((o) => {
      const l = o as THREE.DirectionalLight;
      if (l.isDirectionalLight && l.castShadow) l.shadow.mapSize.set(1024, 1024);
    });
    this.fx = new FX(this.scene, this.camera);
    this.blood = new Blood(this.scene);
    this.fighters = [new Fighter(ROSTER[0], 0, null), new Fighter(ROSTER[2], 1, null)];
    this.fighters.forEach((f) => this.scene.add(f.m.root));
    const bodies = this.fighters.map((_, i) => this.setFighter(i, ROSTER[i === 0 ? 0 : 2]));

    // the website gives each projectile a point light; on a phone every light costs every
    // pixel, so projectiles here keep only their glow
    this.fireLights = [];
    this.iceShells = this.fighters.map(() => {
      const m = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 1),
        new THREE.MeshStandardMaterial({ color: 0x9fe4ff, emissive: 0x2a6a88, roughness: 0.15, metalness: 0.1, flatShading: true, transparent: true, opacity: 0.42, depthWrite: false }),
      );
      m.scale.set(0.62, 1.15, 0.52);
      m.visible = false;
      this.scene.add(m);
      return m;
    });
    this.armorGlows = this.fighters.map(() => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.55 }));
      s.visible = false;
      this.scene.add(s);
      return s;
    });
    this.combat = this.makeCombat();

    // Ready once both bodies are in and every shader is compiled up front, so the first
    // punch doesn't stutter. The other fighters then load quietly in the background.
    Promise.all(bodies).then(() => {
      this.renderer.compile(this.scene, this.camera);
      this.readyIn = 2; // and a couple of real frames drawn
      preload(ROSTER);
    });
  }

  // puts a fighter on stage with their Mixamo body
  setFighter(i: number, cfg: FighterCfg) {
    const f = this.fighters[i];
    if (f.cfg === cfg && f.skin) { f.setMode('idle'); return Promise.resolve(); } // already on stage
    f.rebuild(cfg);
    const body = dress(f);
    f.setMode('idle');
    this.colors[i] = cfg.fx;
    return body;
  }

  // the website's combat reactions: sparks, blood, hit-stop, shake
  private makeCombat() {
    const { fx, blood } = this;
    return new Combat(this.fighters, {
      onHit: (e: { type: string; attacker: Fighter; defender: Fighter; pt: { x: number; y: number; z?: number }; dmg: number; dir: number; ko: boolean; armored: boolean; atk: { hitstop?: number; shake?: number } }) => {
        const a = e.attacker, d = e.defender, col = this.colors[a.idx];
        if (e.type === 'block') {
          fx.burst(e.pt, 0xffffff, 8, 3.2);
          fx.ring(e.pt, 0xbfd8ff, 0.5);
          this.hitstop = Math.max(this.hitstop, 0.04);
          this.shake = Math.max(this.shake, 0.04);
          this.onFeedback?.({ block: true }, d.idx);
          return;
        }
        const power = Math.min(1, e.dmg / 16);
        if (e.armored) fx.ring(e.pt, this.colors[d.idx], 1.2);
        blood.spray(e.pt, e.dir, d.cfg.blood, 6 + Math.round(power * 22), 2.5 + power * 3);
        fx.burst(e.pt, 0xffd9a0, 10 + Math.round(power * 18), 5 + power * 5);
        fx.burst(e.pt, col, 6, 4);
        fx.ring(e.pt, col, 0.8 + power * 0.8);
        fx.flash(e.pt, 0xffd9a0, 30 + power * 50);
        this.hitstop = Math.max(this.hitstop, e.atk.hitstop ?? 0.05 + power * 0.05);
        this.shake = Math.max(this.shake, e.atk.shake ?? 0.08 + power * 0.14);
        this.onFeedback?.({ hit: power, ko: e.ko }, d.idx);
        this.onFeedback?.({ hit: 0.15 }, a.idx);
        const cs = this.combo[a.idx];
        cs.n = d.comboHits; cs.t = 1.4;
        if (e.ko) { this.hitstop = 0.28; this.shake = 0.5; }
      },
      onLand: (f: Fighter, _speed: number, strong: boolean) => {
        fx.dust(f.x, strong ? 12 : 4, strong ? 0.7 : 0.3);
        if (strong) {
          blood.spray({ x: f.x, y: 0.2 }, f.facingRight ? -1 : 1, f.cfg.blood, 8, 2);
          blood.stain(f.x, 0, 0.55, f.cfg.blood);
          if (f.state === 'ko') blood.stain(f.x, 0, 2.1, f.cfg.blood, 3);
          this.shake = Math.max(this.shake, 0.12);
        }
      },
      onSpecial: (f: Fighter, _a: unknown, stage: string) => {
        const pt = { x: f.x, y: (f.y ?? 0) + 1.1, z: 0 }, col = this.colors[f.idx];
        if (stage === 'buff') {
          fx.explosion(pt, col);
          this.shake = Math.max(this.shake, 0.3);
        } else {
          fx.burst(pt, col, 20, 3.5);
          fx.ring(pt, col, 1.1);
          if (stage === 'appear') fx.dust(f.x, 8, 0.5);
        }
      },
      onProjectileSpawn: (p: Projectile) => {
        const col = this.colors[p.owner.idx];
        const g = new THREE.Group();
        const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(3), toneMapped: false }));
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: col, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
        halo.scale.set(1.5, 1.5, 1);
        g.add(core, halo);
        this.scene.add(g);
        const lt = this.fireLights.find((l) => !l.used);
        if (lt) { lt.used = true; lt.l.color.set(col); lt.l.intensity = 18; }
        this.fire.set(p.id, { g, lt });
      },
      onProjectileDie: (p: Projectile, hit: boolean) => {
        const m = this.fire.get(p.id);
        if (m) {
          this.scene.remove(m.g);
          if (m.lt) { m.lt.used = false; m.lt.l.intensity = 0; }
          this.fire.delete(p.id);
        }
        if (hit) {
          fx.explosion({ x: p.x, y: p.y, z: 0 }, this.colors[p.owner.idx]);
          this.shake = Math.max(this.shake, 0.25);
          this.hitstop = Math.max(this.hitstop, 0.08);
        }
      },
    });
  }

  clearArena() {
    this.combat.clearProjectiles();
    this.blood.clear();
  }

  start() {
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      const real = this.last ? Math.max(0, Math.min(0.05, (now - this.last) / 1000)) : 0;
      this.last = now;
      this.clock += real;
      if (this.paused) {
        // everything holds still, including the round timer and anything in the air
      } else if (this.hitstop > 0) {
        this.hitstop -= real;
      } else {
        this.acc += real * this.timeScale;
        let n = 0;
        while (this.acc >= STEP && n++ < 5) {
          this.onStep?.(STEP);
          this.combat.update(STEP);
          this.acc -= STEP;
        }
      }
      const t0 = performance.now();
      this.fitToBuffer();
      this.updateVisuals(real);
      this.updateCamera(real);
      this.renderer.render(this.scene, this.camera);
      this.gl.endFrameEXP();
      if (this.readyIn > 0 && --this.readyIn === 0) this.onReady?.();
      if (this.drawn.length) this.drawn.splice(0).forEach((r) => r());
      // a running count for the on-screen readout, refreshed twice a second
      this.statFrames++;
      this.statMs += performance.now() - t0;
      this.statT += real;
      if (this.statT >= 0.5) {
        const info = this.renderer.info.render;
        this.stats = { fps: Math.round(this.statFrames / this.statT), ms: +(this.statMs / this.statFrames).toFixed(1), calls: info.calls, tris: info.triangles };
        this.statT = 0; this.statFrames = 0; this.statMs = 0;
      }
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop() { cancelAnimationFrame(this.raf); }

  // the drawing buffer follows the view's size (it changes when the app turns to landscape)
  private fitToBuffer() {
    const w = this.gl.drawingBufferWidth, h = this.gl.drawingBufferHeight;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x === w && size.y === h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private updateVisuals(real: number) {
    const live = !this.paused;
    for (const p of this.combat.projectiles as Projectile[]) {
      const m = this.fire.get(p.id);
      if (!m) continue;
      m.g.position.set(p.x, p.y, 0);
      m.g.scale.setScalar(1 + Math.sin(this.clock * 30) * 0.08);
      if (m.lt) m.lt.l.position.set(p.x, p.y, 0.6);
      if (live && Math.random() < 0.7) this.fx.burst({ x: p.x - p.dir * 0.15, y: p.y, z: 0 }, this.colors[p.owner.idx], 1, 1.2);
    }
    this.fighters.forEach((f, i) => {
      this.iceShells[i].visible = f.frozen;
      if (f.frozen) this.iceShells[i].position.set(f.x, (f.y ?? 0) + 1.05, 0);
      const armored = f.armor > 0;
      this.armorGlows[i].visible = armored;
      if (armored) {
        const size = 2.6 + Math.sin(this.clock * 12) * 0.25;
        this.armorGlows[i].material.color.set(this.colors[i]);
        this.armorGlows[i].position.set(f.x, (f.y ?? 0) + 1.1, 0);
        this.armorGlows[i].scale.set(size, size * 1.2, 1);
        if (live && Math.random() < 0.3) this.fx.burst({ x: f.x, y: (f.y ?? 0) + 0.4 + Math.random() * 1.3, z: 0 }, this.colors[i], 1, 1.5);
      }
      if (live && f.state === 'attack' && f.atk.dash && f.phase === 'active') this.fx.burst({ x: f.x, y: (f.y ?? 0) + 1 + Math.random() * 0.5, z: 0 }, this.colors[i], 3, 1.5);
      if (live && !this.lobby && f.hp > 0 && f.hp < 30 && Math.random() < real * 2.5) this.blood.drip(f.x, (f.y ?? 0) + 1.1, f.cfg.blood);
      const cs = this.combo[i];
      if (cs.t > 0) cs.t -= real;
    });
    if (live) {
      this.fighters.forEach((f) => f.skin?.update(real));
      this.fx.update(real);
      this.blood.update(real);
    }
    this.stage.update(this.clock, real);
  }

  // the website's framing: keep both fighters in view, lean on a knockout, drift on the menu
  private updateCamera(dt: number) {
    const [a, b] = this.fighters;
    let mid = (a.x + b.x) / 2;
    const sep = Math.abs(a.x - b.x);
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect;
    let wantDist = Math.max(5.9, (sep + 3.4) / (2 * tanH));
    let focusY = 1.1;
    if (this.focus) {
      mid = mid * 0.4 + this.focus.x * 0.6;
      wantDist = Math.max(4.2, wantDist * 0.78);
      focusY = 0.9;
    }
    if (this.lobby) { wantDist = 6.6; mid = Math.sin(this.clock * 0.25) * 0.8; }
    this.camX += (mid - this.camX) * (1 - Math.exp(-6 * dt));
    this.camDist += (wantDist - this.camDist) * (1 - Math.exp(-4 * dt));
    const sway = this.lobby ? Math.sin(this.clock * 0.2) * 1.2 : Math.sin(this.clock * 0.35) * 0.25;
    let x = this.camX + sway, y = 1.55 + (this.lobby ? 0.3 : 0);
    if (this.shake > 0) {
      x += (Math.random() - 0.5) * this.shake;
      y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 0.9);
    }
    this.camera.position.set(x, y, this.camDist);
    this.camera.lookAt(this.camX * 0.98, focusY, 0);
  }
}
