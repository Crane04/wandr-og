import * as THREE from 'three';

function softTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export const glowTexture = softTexture();

// Pooled impact effects: sparks, shock rings, hit flash light, dust puffs.
export class FX {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;

    const sg = new THREE.SphereGeometry(0.035, 6, 6);
    this.sparks = [];
    for (let i = 0; i < 100; i++) {
      const m = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      m.visible = false;
      scene.add(m);
      this.sparks.push({ m, v: new THREE.Vector3(), life: 0, max: 1 });
    }

    const rg = new THREE.RingGeometry(0.12, 0.16, 36);
    this.rings = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      m.visible = false;
      scene.add(m);
      this.rings.push({ m, life: 0, max: 0.3, size: 1 });
    }

    this.puffs = [];
    for (let i = 0; i < 36; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0x9a9488, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false;
      scene.add(s);
      this.puffs.push({ s, v: new THREE.Vector3(), life: 0, max: 1 });
    }

    this.flashLight = new THREE.PointLight(0xffd9a0, 0, 7, 2);
    scene.add(this.flashLight);
    this.flashLife = 0;
  }

  burst(pt, color, n, speed) {
    let spawned = 0;
    for (const s of this.sparks) {
      if (spawned >= n) break;
      if (s.life > 0) continue;
      s.life = s.max = 0.25 + Math.random() * 0.3;
      s.m.position.set(pt.x, pt.y, (pt.z || 0) + 0.1);
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.35) * Math.PI;
      s.v.set(Math.cos(a) * Math.cos(e), Math.sin(e) + 0.4, Math.sin(a) * Math.cos(e)).multiplyScalar(speed * (0.35 + Math.random() * 0.65));
      s.m.material.color.set(color).multiplyScalar(2.6);
      s.m.scale.setScalar(0.6 + Math.random() * 1.1);
      s.m.visible = true;
      spawned++;
    }
  }

  ring(pt, color, size = 1) {
    const r = this.rings.find((x) => x.life <= 0);
    if (!r) return;
    r.life = r.max = 0.28;
    r.size = size;
    r.m.position.set(pt.x, pt.y, (pt.z || 0) + 0.15);
    r.m.material.color.set(color).multiplyScalar(2.2);
    r.m.visible = true;
  }

  flash(pt, color = 0xffd9a0, power = 40) {
    this.flashLight.color.set(color);
    this.flashLight.position.set(pt.x, pt.y, 0.9);
    this.flashPower = power;
    this.flashLife = 0.14;
  }

  dust(x, n = 8, spread = 0.5) {
    let spawned = 0;
    for (const p of this.puffs) {
      if (spawned >= n) break;
      if (p.life > 0) continue;
      p.life = p.max = 0.6 + Math.random() * 0.4;
      p.s.position.set(x + (Math.random() - 0.5) * spread * 2, 0.08, (Math.random() - 0.5) * 0.6);
      p.v.set((Math.random() - 0.5) * 1.2, 0.35 + Math.random() * 0.4, (Math.random() - 0.5) * 0.4);
      p.s.scale.setScalar(0.3);
      p.s.material.opacity = 0.5;
      p.s.visible = true;
      spawned++;
    }
  }

  explosion(pt, color = 0x66b8ff) {
    this.burst(pt, color, 34, 6);
    this.ring(pt, color, 1.8);
    this.flash(pt, color, 60);
  }

  update(dt) {
    for (const s of this.sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.m.visible = false; continue; }
      s.v.y -= 9 * dt;
      s.m.position.addScaledVector(s.v, dt);
      const k = s.life / s.max;
      s.m.material.opacity = k;
      s.m.scale.multiplyScalar(1 - dt * 1.5);
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) { r.m.visible = false; continue; }
      const t = 1 - r.life / r.max;
      r.m.quaternion.copy(this.camera.quaternion);
      r.m.scale.setScalar(r.size * (0.3 + t * 2.4));
      r.m.material.opacity = Math.pow(1 - t, 1.6);
    }
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      const t = 1 - p.life / p.max;
      p.s.position.addScaledVector(p.v, dt);
      p.s.scale.setScalar(0.3 + t * 0.9);
      p.s.material.opacity = 0.5 * (1 - t);
    }
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      this.flashLight.intensity = Math.max(0, this.flashLife / 0.14) * this.flashPower;
    } else this.flashLight.intensity = 0;
  }
}
