import * as THREE from 'three';

const MAX_DROPS = 220;
const MAX_STAINS = 500;
const GRAVITY = 11;
const FLOOR_Y = 0.012; // just above the arena emblem
const MAX_Z = 1.6;     // keeps stains on the open floor, clear of the steps
const GROW_TIME = 0.22;

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

// An irregular splat: a dense core, lobes around it and flecks thrown further out.
function splatTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  const dot = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  dot(128, 128, 54);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
    const d = 40 + Math.random() * 30;
    dot(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 12 + Math.random() * 20);
  }
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 80 + Math.random() * 42;
    dot(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 1.5 + Math.random() * 5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Flying droplets that leave a stain where they land. Stains stay until clear(),
// and once the pool is full the oldest are reused.
export class Blood {
  constructor(scene) {
    this.drops = [];
    this.dropMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.03, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      MAX_DROPS,
    );
    this.dropMesh.setColorAt(0, _c.set(0xffffff));
    this.dropMesh.count = 0;
    this.dropMesh.frustumCulled = false;
    scene.add(this.dropMesh);

    this.stainMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: splatTexture(), transparent: true, alphaTest: 0.05, depthWrite: false, roughness: 0.2, metalness: 0.1 }),
      MAX_STAINS,
    );
    this.stainMesh.setColorAt(0, _c.set(0xffffff));
    this.stainMesh.count = 0;
    this.stainMesh.frustumCulled = false;
    this.stainMesh.renderOrder = 1;
    scene.add(this.stainMesh);

    this.next = 0;
    this.growing = [];
  }

  // droplets burst from pt, mostly along dir (+1 / -1)
  spray(pt, dir, color, n, speed) {
    for (let i = 0; i < n && this.drops.length < MAX_DROPS; i++) {
      const v = speed * (0.35 + Math.random() * 0.65);
      this.drops.push({
        x: pt.x, y: pt.y, z: (Math.random() - 0.5) * 0.3,
        vx: dir * v * (0.4 + Math.random() * 0.8),
        vy: v * (Math.random() * 0.9 - 0.1),
        vz: (Math.random() - 0.5) * v * 0.9,
        size: 0.6 + Math.random() * 1.2,
        color,
      });
    }
  }

  // a single falling drop, for fighters who are badly hurt
  drip(x, y, color) {
    if (this.drops.length >= MAX_DROPS) return;
    this.drops.push({ x, y, z: (Math.random() - 0.5) * 0.25, vx: 0, vy: 0, vz: 0, size: 0.8, color });
  }

  // a stain on the floor. time is how long it takes to spread, so a pool can creep outward.
  stain(x, z, size, color, time = GROW_TIME, stretch = 1) {
    const i = this.next;
    this.next = (i + 1) % MAX_STAINS;
    this.stainMesh.count = Math.min(MAX_STAINS, this.stainMesh.count + 1);
    this.stainMesh.setColorAt(i, _c.set(color));
    this.stainMesh.instanceColor.needsUpdate = true;
    this.growing = this.growing.filter((g) => g.i !== i);
    const stain = {
      i, x, z: Math.max(-MAX_Z, Math.min(MAX_Z, z)), size, stretch, t: 0, time,
      // later stains sit a hair higher so overlapping ones layer in the order they landed
      y: FLOOR_Y + (i / MAX_STAINS) * 0.002,
      rot: Math.random() * Math.PI * 2,
    };
    this.growing.push(stain);
    this.place(stain, 0.3);
  }

  place(s, k) {
    _p.set(s.x, s.y, s.z);
    _q.setFromAxisAngle(UP, s.rot);
    _s.set(s.size * s.stretch * k, 1, s.size * k);
    this.stainMesh.setMatrixAt(s.i, _m.compose(_p, _q, _s));
    this.stainMesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.drops.length = 0;
    this.growing.length = 0;
    this.dropMesh.count = 0;
    this.stainMesh.count = 0;
    this.next = 0;
  }

  update(dt) {
    let n = 0;
    for (const d of this.drops) {
      d.vy -= GRAVITY * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      if (d.y <= FLOOR_Y) {
        const fast = Math.min(1, Math.hypot(d.vx, d.vy) / 7);
        this.stain(d.x, d.z, (0.07 + Math.random() * 0.14) * d.size * (1 + fast * 0.6), d.color, GROW_TIME, 1 + fast * 0.7);
        d.dead = true;
        continue;
      }
      _p.set(d.x, d.y, d.z);
      _s.setScalar(d.size);
      this.dropMesh.setMatrixAt(n, _m.compose(_p, _q.identity(), _s));
      this.dropMesh.setColorAt(n, _c.set(d.color));
      n++;
    }
    this.drops = this.drops.filter((d) => !d.dead);
    this.dropMesh.count = n;
    this.dropMesh.instanceMatrix.needsUpdate = true;
    if (this.dropMesh.instanceColor) this.dropMesh.instanceColor.needsUpdate = true;

    for (const s of this.growing) {
      s.t = Math.min(s.time, s.t + dt);
      const k = 1 - Math.pow(1 - s.t / s.time, 3);
      this.place(s, 0.3 + 0.7 * k);
    }
    this.growing = this.growing.filter((s) => s.t < s.time);
  }
}
