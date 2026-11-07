// Mixamo bodies. The fighter's own skeleton keeps running invisibly and still
// decides every hit, so combat is identical; this only draws a skinned model on
// top and follows the fighter's state. Browser only: the sim never imports it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const HEIGHT = 1.84;      // top of the head for a fighter of build scale 1, same as the built-in bodies
const BLOCK_HOLD = 0.35;  // how far into the block clip the guard is fully up
const GETUP_FROM = 0.35;  // the get-up clip lies still at first; the game gives 0.45s to rise
const WINDUP = 0.4;       // seconds of the clip used before the moment of impact
const FOLLOW = 0.55;      // and after it
const LOOPS = ['idle', 'guard', 'walk', 'walk-back', 'run', 'crouch', 'victory'];
// how fast each clip's feet cover the ground, so they can be matched to the fighter
const CLIP_SPEED = { walk: 1.6, 'walk-back': 0.65, run: 4.2 };
const LEGS = /(Hips|UpLeg|Leg|Foot|Toe\w*)\./;

const loaded = new Map();
const lerp = (a, b, k) => a + (b - a) * Math.min(1, Math.max(0, k));

// When a clip's hand or foot is furthest from the hips, the strike has landed.
function findImpact(scene, clip, limb) {
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip).play();
  const hips = scene.getObjectByProperty('isBone', true);
  const ends = [];
  scene.traverse((o) => { if (o.isBone && limb.test(o.name)) ends.push(o); });
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  let best = 0, at = clip.duration / 2;
  for (let t = 0; t < clip.duration; t += 1 / 30) {
    mixer.setTime(t);
    scene.updateMatrixWorld(true);
    hips.getWorldPosition(a);
    for (const e of ends) {
      const d = e.getWorldPosition(b).distanceTo(a);
      if (d > best) { best = d; at = t; }
    }
  }
  action.stop();
  mixer.uncacheRoot(scene);
  return { from: Math.max(0, at - WINDUP), at, to: Math.min(clip.duration - 0.01, at + FOLLOW) };
}

function load(name) {
  if (!loaded.has(name)) {
    loaded.set(name, new GLTFLoader().loadAsync(`/models/${name}.glb`).then((gltf) => {
      const clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
      // walking keeps its legs but holds the fight stance's arms, not a stroll's
      clips.walk.tracks = clips.walk.tracks.filter((t) => LEGS.test(t.name));
      clips.guard = new THREE.AnimationClip('guard', clips.idle.duration, clips.idle.tracks.filter((t) => !LEGS.test(t.name)));
      // sized by the head bone, not the mesh, so hoods, ears and helmets don't shrink anyone
      gltf.scene.updateMatrixWorld(true);
      const top = gltf.scene.getObjectByName('HeadTop_End');
      const headY = (n) => gltf.scene.getObjectByName(n).getWorldPosition(new THREE.Vector3()).y;
      const topY = top ? top.getWorldPosition(new THREE.Vector3()).y : headY('Head') * 1.1;
      return {
        scene: gltf.scene, clips, topY,
        strikes: {
          punch: findImpact(gltf.scene, clips.punch, /(Left|Right)Hand$/),
          kick: findImpact(gltf.scene, clips.kick, /(Left|Right)Foot$/),
        },
      };
    }));
  }
  return loaded.get(name);
}

class Skin {
  constructor(asset, fighter) {
    this.f = fighter;
    this.asset = asset;
    this.body = clone(asset.scene);
    this.body.scale.setScalar((HEIGHT * (fighter.cfg.build?.scale || 1)) / asset.topY);
    this.body.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
    });
    this.mixer = new THREE.AnimationMixer(this.body);
    this.actions = {};
    for (const [id, clip] of Object.entries(asset.clips)) {
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      action.setEffectiveWeight(id === 'idle' ? 1 : 0);
      action.play();
      action.paused = !LOOPS.includes(id);
      this.actions[id] = action;
    }
    this.seen = null;
    this.downT = 0;
    fighter.m.root.add(this.body);
  }

  remove() {
    this.body.removeFromParent();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.body);
  }

  // which clip this fighter should be showing, and where in it for the held ones
  choose(dt) {
    const f = this.f;
    if (f.state !== this.seen) { this.seen = f.state; this.downT = 0; }
    this.downT += dt;
    const clips = this.asset.clips;
    switch (f.state) {
      case 'attack': {
        const a = f.atk;
        const id = /Foot/.test(a.strike || '') ? 'kick' : 'punch';
        const s = this.asset.strikes[id];
        if (a.air) return { id, t: lerp(s.from, s.at, f.atkT / 0.15) };
        const hit = a.up + a.act / 2, total = a.up + a.act + a.rec;
        const t = f.atkT < hit ? lerp(s.from, s.at, f.atkT / hit) : lerp(s.at, s.to, (f.atkT - hit) / (total - hit));
        return { id, t, rate: 40 };
      }
      case 'hitstun': return { id: 'hit', t: lerp(0, clips.hit.duration - 0.01, f.stateT / Math.max(0.3, f.stunTime)), rate: 30 };
      case 'blockstun': return { id: 'block', t: clips.block.duration * BLOCK_HOLD, rate: 30 };
      case 'knockdown': case 'ko': case 'lose':
        if (f.kdPhase === 'getup') return { id: 'getup', t: lerp(GETUP_FROM * clips.getup.duration, clips.getup.duration - 0.01, f.stateT / 0.45), rate: 30 };
        return { id: 'knockdown', t: Math.min(clips.knockdown.duration - 0.01, this.downT * 1.4), rate: 25 };
      case 'win': return { id: 'victory', rate: 8 };
      case 'idle':
        if (f.crouching) return { id: 'crouch', rate: 20 };
        if (f.blocking) return { id: 'block', t: clips.block.duration * BLOCK_HOLD, rate: 22 };
        if (f.onGround && Math.abs(f.vx) > 0.4) {
          const forward = Math.sign(f.vx) === (f.facingRight ? 1 : -1);
          if (!forward) return { id: 'walk-back' };
          return Math.abs(f.vx) > 3.2 ? { id: 'run' } : { id: 'walk', guard: true };
        }
        return { id: 'idle' };
      default: return { id: 'idle' };
    }
  }

  update(dt) {
    const want = this.choose(dt);
    const k = 1 - Math.exp(-(want.rate || 14) * dt);
    for (const [id, action] of Object.entries(this.actions)) {
      const w = action.getEffectiveWeight();
      const on = id === want.id || (id === 'guard' && want.guard);
      action.setEffectiveWeight(w + ((on ? 1 : 0) - w) * k);
    }
    const action = this.actions[want.id];
    if (want.t !== undefined) action.time = want.t;
    if (CLIP_SPEED[want.id]) action.timeScale = Math.min(3, Math.max(0.6, Math.abs(this.f.vx) / CLIP_SPEED[want.id]));
    this.mixer.update(dt);
  }
}

// Swaps the fighter's drawn body for its Mixamo model. The old built-in body is
// hidden at once and never shown; it only keeps running for the hit boxes.
export async function dress(fighter) {
  const cfg = fighter.cfg;
  fighter.m.root.traverse((o) => { if (o.isMesh) o.visible = false; });
  if (!cfg.skinModel) return;
  const asset = await load(cfg.skinModel);
  if (fighter.cfg === cfg && !fighter.skin) fighter.skin = new Skin(asset, fighter);
}

// Fetches every fighter's model in the background, so picking one is instant.
export function preload(roster) {
  for (const c of roster) if (c.skinModel) load(c.skinModel).catch(() => {});
}
