import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Anatomical procedural fighter. Joint positions and hurt-spheres are fixed (poses,
// foot grounding and hit detection depend on them); everything here is the skin
// over that rig. Proportions follow a real ~7.5-head figure. The face is sculpted
// into the head mesh, limbs are lofted so they aren't round, and hair, hoods, masks
// and headbands are shells cut from the same head surface so they always fit it.
export const LEG = 0.46;
export const ANKLE_H = 0.0725;

// --- helpers ---------------------------------------------------------------
const sstep = (t) => t * t * (3 - 2 * t);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const gauss = (d, s) => Math.exp(-(d * d) / (2 * s * s));
function prof(pts, u) {
  if (u <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (u <= pts[i][0]) {
      const [u0, v0] = pts[i - 1], [u1, v1] = pts[i];
      return v0 + (v1 - v0) * sstep((u - u0) / (u1 - u0));
    }
  }
  return pts[pts.length - 1][1];
}

// geometry depends only on the build, so it's shared between fighters and rebuilds
const cache = new Map();
const memo = (key, make) => {
  if (cache.size > 150) cache.clear(); // meshes keep what they use
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

// join the duplicate seam vertices so normals run smoothly across it
function weld(g) {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const w = mergeVertices(g, 1e-5);
  w.computeVertexNormals();
  return w;
}

function gridGeo(pos, rows, seg, col) {
  const idx = [];
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + 1, c = a + seg + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return weld(g);
}

const catmull = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);

// Smooth tube through stations [y, halfWidth, halfDepth, zOffset], listed top to bottom.
function loft(st, k = 1, seg = 20) {
  const rows = [];
  const n = st.length;
  const at = (i) => st[clamp(i, 0, n - 1)];
  const sub = 5;
  for (let i = 0; i < n - 1; i++) for (let s = 0; s < sub; s++) {
    const t = s / sub;
    rows.push([0, 1, 2, 3].map((c) => catmull(at(i - 1)[c] ?? 0, at(i)[c] ?? 0, at(i + 1)[c] ?? 0, at(i + 2)[c] ?? 0, t)));
  }
  rows.push([...st[n - 1].slice(0, 3), st[n - 1][3] ?? 0]);
  const capped = [[rows[0][0], 0.0005, 0.0005, rows[0][3]], ...rows, [rows.at(-1)[0], 0.0005, 0.0005, rows.at(-1)[3]]];
  const pos = [];
  for (const [y, rx, rz, oz] of capped) for (let j = 0; j <= seg; j++) {
    const th = (j / seg) * Math.PI * 2;
    pos.push(Math.cos(th) * rx * k, y, oz * k + Math.sin(th) * rz * k);
  }
  return gridGeo(pos, capped.length, seg);
}

// --- torso --------------------------------------------------------------------
const W_PTS = [[0, 0.138], [0.16, 0.124], [0.36, 0.134], [0.56, 0.160], [0.72, 0.180], [0.83, 0.188], [0.91, 0.170], [0.965, 0.118], [1, 0.066]];
const D_PTS = [[0, 0.098], [0.16, 0.090], [0.36, 0.096], [0.56, 0.110], [0.72, 0.120], [0.84, 0.108], [0.94, 0.08], [1, 0.06]];
const TY0 = -0.03, TY1 = 0.57;

function torsoGeo(B, u0, u1, infl) {
  const Wn = 56, Hn = Math.max(6, Math.round(52 * (u1 - u0)));
  const pos = [], col = [];
  const m = B.muscle;
  for (let i = 0; i <= Hn; i++) {
    const u = u0 + (u1 - u0) * (i / Hn);
    const a = prof(W_PTS, u) * B.w + infl;
    const b0 = prof(D_PTS, u) * B.d + infl;
    for (let j = 0; j <= Wn; j++) {
      const th = -Math.PI + (j / Wn) * Math.PI * 2;
      const s = Math.sin(th), c = Math.cos(th);
      // slightly squared cross-section: a ribcage, not a cylinder
      const sx = Math.sign(s) * Math.pow(Math.abs(s), 0.82);
      const front = Math.max(0, c), back = Math.max(0, -c);
      const x = sx * a;
      let disp = 0, ao = 0;
      for (const sg of [-1, 1]) {
        const g = gauss(x - sg * 0.072 * B.w, 0.046) * gauss(u - 0.71, 0.07);
        disp += 0.016 * g * m * front;
        ao += g * front * m;
        disp -= 0.007 * m * front * gauss(x - sg * 0.072 * B.w, 0.055) * gauss(u - 0.61, 0.018);
        if (B.female) disp += 0.03 * front * gauss(x - sg * 0.066, 0.042) * gauss(u - 0.69, 0.065);
      }
      for (const sg of [-1, 1]) for (const ur of [0.5, 0.385, 0.27]) {
        const g = gauss(x - sg * 0.034, 0.022) * gauss(u - ur, 0.04);
        disp += 0.0065 * g * m * front * (u < 0.6 ? 1 : 0);
        ao += g * 0.6 * front * m;
      }
      disp -= 0.0045 * m * front * gauss(x, 0.006) * (u > 0.14 && u < 0.62 ? 1 : 0);
      for (const sg of [-1, 1]) {
        const lg = gauss(x - sg * 0.1, 0.05) * gauss(u - 0.64, 0.12);
        disp += 0.016 * lg * m * back; ao += lg * back * 0.6 * m;
        const tg = gauss(x - sg * 0.05, 0.05) * gauss(u - 0.9, 0.06);
        disp += 0.016 * tg * m * back; ao += tg * back * 0.4 * m;
      }
      disp -= 0.005 * m * back * gauss(x, 0.009) * (u > 0.15 && u < 0.9 ? 1 : 0);
      pos.push(x, TY0 + u * (TY1 - TY0), c * (b0 + disp));
      const shade = clamp(0.92 + 0.22 * ao + (disp < 0 ? disp * 7 : 0), 0.7, 1.08);
      col.push(shade, shade, shade);
    }
  }
  return gridGeo(pos, Hn + 1, Wn, col);
}

// --- head ---------------------------------------------------------------------
// Everything uses a unit sphere direction (x right, y up, z out of the face). sculpt()
// turns a direction into a point on the skull, carving the face when `face` is set.
function sculpt(x, y, z, B, face, off = 0) {
  const low = clamp((-y - 0.1) / 0.9, 0, 1);
  const jawTaper = 0.17 - 0.2 * (B.jaw - 1);
  let px = x * (0.081 + off) * (1 - jawTaper * sstep(low));
  let py = y * (0.116 + off);
  let pz = z * (0.1 + off);
  if (z < 0) pz *= 1 - 0.5 * sstep(clamp((-y - 0.08) / 0.8, 0, 1)); // skull tucks in to the neck
  if (face && z > 0) {
    const f = sstep(clamp(z / 0.55, 0, 1));
    const ax = Math.abs(x);
    let d = -0.006;
    d += 0.0065 * B.brow * gauss(y - 0.27, 0.06) * gauss(x, 0.62);          // brow ridge
    d -= 0.0125 * gauss(ax - 0.4, 0.15) * gauss(y - 0.1, 0.085);             // eye sockets
    d += 0.007 * gauss(ax - 0.6, 0.2) * gauss(y + 0.08, 0.13);               // cheekbones
    d -= 0.005 * gauss(ax - 0.5, 0.14) * gauss(y + 0.36, 0.13);              // hollow of the cheek
    const ny = clamp((0.17 - y) / 0.36, 0, 1);                               // nose bridge to tip
    const under = sstep(clamp((-0.17 - y) / 0.12, 0, 1));
    d += 0.024 * Math.pow(ny, 1.35) * (1 - under) * gauss(x, 0.06 + 0.055 * ny);
    d += 0.0045 * gauss(x, 0.07) * gauss(y + 0.165, 0.05);                   // tip
    d += 0.0075 * gauss(ax - 0.12, 0.055) * gauss(y + 0.2, 0.055);           // nostril wings
    d += 0.0035 * gauss(x, 0.28) * gauss(y + 0.405, 0.04) * B.lip;           // upper lip
    d += 0.0048 * gauss(x, 0.24) * gauss(y + 0.52, 0.045) * B.lip;           // lower lip
    d -= 0.003 * gauss(x, 0.3) * gauss(y + 0.63, 0.035);                     // crease above chin
    d += 0.008 * gauss(x, 0.34) * gauss(y + 0.8, 0.13);                      // chin
    pz += d * f;
  }
  return [px * B.head, py * B.head, pz * B.head];
}

const HEAD_Y = 0.104; // sits low enough that the neck reads at a natural length

// mask, when given, makes this a shell: it returns > 0 inside the shell's outline. The
// surface sinks under the skin as the mask reaches 0, so the visible edge is a smooth
// curve rather than the stair-step of cut triangles.
function headMesh(B, face, off, mask) {
  const g = new THREE.SphereGeometry(1, 144, 108);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const drop = new Uint8Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let o = off;
    if (mask) {
      const v = mask(x, y, z);
      o = -0.003 + (off + 0.003) * clamp(v / 0.05, 0, 1);
      if (v < -0.12) drop[i] = 1;
    }
    const [a, b, c] = sculpt(x, y, z, B, face, o);
    p.setXYZ(i, a, b, c);
    // lips, and a little shadow in the sockets and under the brow
    const front = z > 0 ? 1 : 0;
    const lip = front * Math.min(1, 1.2 * gauss(x, 0.27) * gauss(y + 0.465, 0.075));
    const socket = front * gauss(Math.abs(x) - 0.4, 0.17) * gauss(y - 0.12, 0.09);
    col[i * 3] = mask ? drop[i] : 1 - 0.1 * lip - 0.2 * socket;
    col[i * 3 + 1] = mask ? 0 : 1 - 0.36 * lip - 0.24 * socket;
    col[i * 3 + 2] = mask ? 0 : 1 - 0.3 * lip - 0.24 * socket;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const w = weld(g);
  if (mask) {
    const c = w.attributes.color, idx = w.index.array, out = [];
    for (let i = 0; i < idx.length; i += 3) if (!(c.getX(idx[i]) && c.getX(idx[i + 1]) && c.getX(idx[i + 2]))) out.push(idx[i], idx[i + 1], idx[i + 2]);
    w.setIndex(out);
    w.deleteAttribute('color');
  }
  return w;
}

// hair stops at a natural hairline: high on the forehead, above the ears, low at the nape
const scalp = (x, y, z) => y - (0.54 - 0.46 * sstep(clamp((0.92 - z) / 0.9, 0, 1)) - 0.62 * sstep(clamp(-z / 0.8, 0, 1)));

// --- feet and hands -------------------------------------------------------------
function footGeo() {
  // stations along the foot: [z, half width, top height]
  const st = [[-0.083, 0.004, 0.02], [-0.08, 0.026, 0.05], [-0.055, 0.04, 0.085], [-0.01, 0.043, 0.1], [0.04, 0.044, 0.088], [0.09, 0.048, 0.06], [0.14, 0.05, 0.043], [0.18, 0.042, 0.032], [0.2, 0.024, 0.022], [0.203, 0.003, 0.008]];
  const seg = 18, pos = [];
  const sub = 4, rows = [];
  const at = (i) => st[clamp(i, 0, st.length - 1)];
  for (let i = 0; i < st.length - 1; i++) for (let s = 0; s < sub; s++) {
    rows.push([0, 1, 2].map((c) => catmull(at(i - 1)[c], at(i)[c], at(i + 1)[c], at(i + 2)[c], s / sub)));
  }
  rows.push(st.at(-1));
  for (const [z, w, h] of rows) for (let j = 0; j <= seg; j++) {
    const th = (j / seg) * Math.PI * 2;
    const c = Math.cos(th), s = Math.sin(th);
    pos.push(c * Math.max(0.001, w), -ANKLE_H + (s > 0 ? s * h : s * 0.002 + 0.002), z);
  }
  return gridGeo(pos, rows.length, seg);
}

// --- main builder ---------------------------------------------------------------------
export function buildModel(cfg) {
  const B = Object.assign({ w: 1, d: 1, muscle: 1, limb: 1, head: 1, jaw: 1, brow: 1, lip: 1, hips: 1, neck: 1, scale: 1 }, cfg.build || {});
  B.female = !!cfg.female;
  if (B.female) { B.hips = cfg.build?.hips ?? 1.16; B.lip = cfg.build?.lip ?? 1.35; B.neck = cfg.build?.neck ?? 0.86; }
  const key = JSON.stringify(B);
  const geo = (name, make) => memo(name + key, make);

  const skinMat = new THREE.MeshPhysicalMaterial({ color: cfg.skin, roughness: 0.5, sheen: 0.2, sheenColor: new THREE.Color(cfg.skin).lerp(new THREE.Color(0xffffff), 0.3), sheenRoughness: 0.6 });
  const skinShaded = skinMat.clone(); skinShaded.vertexColors = true;
  const metal = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.34, metalness: 0.72 });
  const cloth = (c, r = 0.72) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0.02 });
  const pantsMat = cfg.metalTop ? metal(cfg.pants ?? 0x44484e) : cloth(cfg.pants ?? 0x222222, 0.78);
  const wrapMat = cloth(cfg.wrap ?? 0x333333, 0.62);
  const beltMat = cloth(cfg.belt ?? 0x222222, 0.6);
  const bootMat = cloth(cfg.boots ?? 0x1a1a1c, 0.5);
  const hairMat = cloth(cfg.hair ?? 0x111111, 0.5);
  const glow = (c, i = 3) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: c, emissiveIntensity: i, roughness: 0.4 });
  const accentMat = cfg.glow != null ? glow(cfg.glow, 2.6) : cloth(cfg.accent ?? 0x888888, 0.5);
  const topMat = cfg.top != null ? (cfg.metalTop ? metal(cfg.top) : cloth(cfg.top, 0.55)) : null;
  if (topMat && !cfg.metalTop) topMat.vertexColors = true;
  const armMat = cfg.sleeves != null ? (cfg.metalTop ? metal(cfg.sleeves) : cloth(cfg.sleeves, 0.55)) : skinMat;
  const legMat = cfg.bareLegs ? skinMat : pantsMat;
  const gloveMat = cfg.metalTop ? metal(cfg.wrap) : skinMat;

  const add = (parent, mesh, x = 0, y = 0, z = 0) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const sph = (r, m, w = 18, h = 14) => new THREE.Mesh(new THREE.SphereGeometry(r, w, h), m);
  const mesh = (g, m) => new THREE.Mesh(g, m);

  const root = new THREE.Group();
  root.scale.setScalar(B.scale);
  const hips = new THREE.Group();
  hips.position.y = 1;
  root.add(hips);

  // pelvis and glutes, waistband
  const pw = B.w * B.hips;
  add(hips, mesh(geo('pelvis', () => loft([[0.095, 0.11 * B.w, 0.078 * B.d, 0], [0.05, 0.136 * pw, 0.094 * B.d, -0.004], [-0.02, 0.166 * pw, 0.116 * B.d, -0.012], [-0.09, 0.158 * pw, 0.114 * B.d, -0.014], [-0.14, 0.116 * pw, 0.092 * B.d, -0.008], [-0.175, 0.05, 0.05, 0]], 1, 28)), pantsMat));
  add(hips, new THREE.Mesh(new THREE.CylinderGeometry(0.15 * pw, 0.152 * pw, 0.05, 32), beltMat), 0, 0.075, 0).scale.z = (0.112 * B.d) / (0.144 * pw);
  if (cfg.buckle != null) add(hips, new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.042, 0.016), glow(cfg.buckle, 2.2)), 0, 0.075, 0.112 * B.d);

  // torso
  const spine = new THREE.Group();
  spine.position.y = 0.1;
  hips.add(spine);
  const bareTorso = add(spine, mesh(geo('torso', () => torsoGeo(B, 0, 1, 0)), cfg.metalTop ? metal(cfg.top) : skinShaded));
  if (cfg.top != null && !cfg.metalTop) {
    const u0 = cfg.topFrom ?? 0;
    add(spine, mesh(memo(`top${u0}${key}`, () => torsoGeo(B, u0, B.female ? 0.9 : 1, 0.004)), topMat));
  }
  if (cfg.chestGlow != null) add(spine, sph(0.024, glow(cfg.chestGlow, 3.2), 14, 10), 0, 0.3, 0.112 * B.d).scale.z = 0.5;
  if (cfg.straps != null) {
    const sm = cloth(cfg.straps, 0.6);
    const st = add(spine, new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.56, 0.02), sm), 0.015, 0.27, 0.112 * B.d);
    st.rotation.z = 0.45;
    if (cfg.glow != null) add(spine, new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.54, 0.022), accentMat), 0.015, 0.27, 0.114 * B.d).rotation.z = 0.45;
  }
  // neck
  const nk = B.neck * (0.75 + 0.25 * B.w);
  add(spine, mesh(geo('neck', () => loft([[0.66, 0.056 * nk, 0.058 * nk, -0.014], [0.6, 0.057 * nk, 0.06 * nk, -0.012], [0.55, 0.062 * nk, 0.063 * nk, -0.006], [0.5, 0.08 * nk, 0.07 * nk, 0]], 1, 18)), cfg.metalTop ? metal(cfg.sleeves ?? cfg.top) : skinMat));

  // head
  const head = new THREE.Group();
  head.position.y = 0.58;
  spine.add(head);
  const hs = B.head;
  const on = (m) => add(head, m, 0, HEAD_Y * hs, 0);
  // a point on the face from a unit direction
  const fp = (x, y, off = 0) => {
    const [a, b, c] = sculpt(x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y)), B, true);
    return new THREE.Vector3(a, b + HEAD_Y * hs, c + off);
  };
  const curve = (pts, r, m, flat = 1) => {
    const t = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, r, 6), m);
    t.castShadow = false;
    t.scale.z = flat;
    head.add(t);
    return t;
  };

  if (cfg.helmet) {
    on(mesh(geo('helmet', () => headMesh(B, false, 0.003)), metal(cfg.helmet)));
    on(mesh(geo('visor', () => headMesh(B, false, 0.0065, (x, y, z) => Math.min(z - 0.2, 0.085 - Math.abs(y - 0.1)))), glow(cfg.visor ?? 0xffb347, 3.6)));
    on(mesh(geo('jaw', () => headMesh(B, false, 0.0055, (x, y, z) => Math.min(z - 0.35, 0.13 - Math.abs(y + 0.55)))), metal(0x2b2f36)));
    for (const s of [-1, 1]) add(head, new THREE.Mesh(new THREE.CylinderGeometry(0.016 * hs, 0.016 * hs, 0.012, 14), metal(0x2b2f36)), s * 0.078 * hs, 0.125 * hs, 0).rotation.z = Math.PI / 2;
  } else {
    on(mesh(geo('head', () => headMesh(B, true, 0)), skinShaded));
    for (const s of [-1, 1]) {
      const c = fp(s * 0.4, 0.1, -0.0062 * hs);
      const r = 0.0122 * hs;
      const white = cfg.eyeGlow != null ? glow(cfg.eyeGlow, 4) : new THREE.MeshStandardMaterial({ color: 0xece6dc, roughness: 0.25 });
      add(head, new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), white), c.x, c.y, c.z);
      if (cfg.eyeGlow == null) {
        add(head, new THREE.Mesh(new THREE.SphereGeometry(r * 0.6, 12, 10), new THREE.MeshStandardMaterial({ color: cfg.iris ?? 0x3a2414, roughness: 0.2 })), c.x, c.y, c.z + r * 0.56).scale.z = 0.8;
        add(head, new THREE.Mesh(new THREE.SphereGeometry(r * 0.28, 10, 8), new THREE.MeshStandardMaterial({ color: 0x050403, roughness: 0.15 })), c.x, c.y, c.z + r * 0.86).scale.z = 0.7;
      }
      // upper lid hooding the eye
      add(head, new THREE.Mesh(new THREE.SphereGeometry(r * 1.1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.34), skinMat), c.x, c.y, c.z).rotation.x = 0.3;
      const browMat = cloth(cfg.browColor ?? cfg.hair ?? 0x1a1410, 0.7);
      const lift = B.female ? 0.02 : 0;
      curve([fp(s * 0.14, 0.235 + lift, 0.0035), fp(s * 0.3, 0.285 + lift, 0.0035), fp(s * 0.5, 0.29 + lift, 0.0035), fp(s * 0.68, 0.225 + lift, 0.002)], B.female ? 0.0021 * hs : 0.0034 * hs, browMat);
      // ear, with a darker inner fold
      const ear = add(head, sph(0.03 * hs, skinMat, 12, 10), s * 0.078 * hs, 0.128 * hs, -0.008 * hs);
      ear.scale.set(0.3, 1, 0.62); ear.rotation.y = s * 0.3;
      const inner = add(head, sph(0.017 * hs, cloth(new THREE.Color(cfg.skin).multiplyScalar(0.6), 0.7), 8, 8), s * 0.0855 * hs, 0.128 * hs, -0.006 * hs);
      inner.scale.set(0.22, 1, 0.6); inner.rotation.y = s * 0.3;
    }
    curve([fp(-0.26, -0.47, 0.0008), fp(-0.1, -0.455, 0.0014), fp(0.1, -0.455, 0.0014), fp(0.26, -0.47, 0.0008)], 0.0013 * hs, cloth(0x2a0f0d, 0.5));
  }

  const hairStyle = cfg.hairStyle;
  if (hairStyle) {
    const bulk = hairStyle === 'ponytail' ? 0.0075 : hairStyle === 'short' ? 0.004 : 0.0065;
    on(mesh(geo('hair' + hairStyle, () => headMesh(B, true, bulk, scalp)), hairMat));
  }
  // a tuft rising off the skull along direction (x, y, z)
  const tuft = (x, y, z, len, r) => {
    const v = new THREE.Vector3(x, y, z).normalize();
    const [a, b, c] = sculpt(v.x, v.y, v.z, B, false, 0.002);
    const t = add(head, new THREE.Mesh(new THREE.ConeGeometry(r * hs, len * hs, 7), hairMat), a, b + HEAD_Y * hs, c);
    const dir = new THREE.Vector3(v.x * 1.1, v.y + 0.5, v.z - 0.35).normalize();
    t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    t.position.addScaledVector(dir, len * hs * 0.42);
  };
  if (hairStyle === 'spiky') {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      // golden-angle spread over the top of the skull
      const yy = 0.98 - (i / 70) * 0.62;
      const rr = Math.sqrt(1 - yy * yy), a = i * 2.39996;
      const zz = Math.cos(a) * rr;
      if (scalp(Math.sin(a) * rr, yy - 0.08, zz) > 0) tuft(Math.sin(a) * rr, yy, zz, 0.034 + rnd() * 0.026, 0.012 + rnd() * 0.005);
    }
  } else if (hairStyle === 'knot') {
    add(head, sph(0.036 * hs, hairMat, 12, 10), 0, 0.245 * hs, -0.06 * hs).scale.set(1, 0.9, 1);
  } else if (hairStyle === 'ponytail') {
    add(head, sph(0.024 * hs, cloth(cfg.headband ?? 0x331111, 0.5), 10, 8), 0, 0.175 * hs, -0.118 * hs);
    const tail = [[0, 0.175, -0.118], [0, 0.16, -0.16], [0, 0.09, -0.185], [0, -0.01, -0.175], [0, -0.1, -0.155]].map(([x, y, z]) => new THREE.Vector3(x, y * hs, z * hs));
    const t = add(head, new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tail), 18, 0.021 * hs, 8), hairMat));
    t.scale.x = 1.15;
    add(head, sph(0.021 * hs, hairMat, 10, 8), 0, -0.1 * hs, -0.155 * hs).scale.y = 1.8;
  }
  if (cfg.headband != null) on(mesh(geo('band', () => headMesh(B, true, 0.0105, (x, y, z) => 0.06 - Math.abs(y - (0.55 - 0.42 * sstep(clamp((0.9 - z) / 1.9, 0, 1)))))), cloth(cfg.headband, 0.5)));
  if (cfg.hood) {
    on(mesh(geo('hood', () => headMesh(B, true, 0.015, (x, y, z) => Math.hypot(x / 0.72, (y + 0.28) / 0.66, Math.min(0, z - 0.25) * 3) - 1)), cloth(cfg.hood, 0.82)));
    add(spine, mesh(geo('cowl', () => loft([[0.6, 0.062, 0.07, -0.016], [0.545, 0.076, 0.078, -0.01], [0.5, 0.105, 0.09, -0.004], [0.47, 0.13 * B.w, 0.098, 0]], 1, 22)), cloth(cfg.hood, 0.82)));
  }
  if (cfg.mask) on(mesh(geo('mask', () => headMesh(B, true, 0.0045, (x, y, z) => Math.min(-0.02 - y, z + 0.4))), cloth(cfg.maskColor ?? cfg.hood ?? 0x1a1a1a, 0.78)));

  // limbs
  const sides = {};
  const SHX = 0.2 * B.w;
  const L = B.limb;
  const armK = 1.12 + (B.muscle - 1) * 0.14;
  for (const [key2, sgn] of [['L', 1], ['R', -1]]) {
    const sh = new THREE.Group();
    sh.position.set(sgn * SHX, 0.46, 0);
    spine.add(sh);
    // deltoid + upper arm, biceps forward and triceps back
    add(sh, sph(0.058 * L * armK, armMat, 20, 14), sgn * 0.006, -0.018, 0).scale.set(0.95, 1.25, 1.08);
    add(sh, mesh(memo(`uarm${L * armK}`, () => loft([[0.055, 0.004, 0.004, 0], [0.04, 0.03, 0.032, 0], [0.02, 0.046, 0.05, 0], [-0.05, 0.051, 0.056, 0], [-0.13, 0.047, 0.055, 0.004], [-0.21, 0.042, 0.048, 0.004], [-0.28, 0.037, 0.04, 0], [-0.33, 0.035, 0.036, 0], [-0.352, 0.024, 0.025, 0], [-0.366, 0.004, 0.004, 0]], L * armK)), armMat));
    if (cfg.pauldron != null) {
      const pm = cfg.metalTop ? metal(cfg.pauldron) : cloth(cfg.pauldron, 0.5);
      add(sh, new THREE.Mesh(new THREE.SphereGeometry(0.074 * L, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), pm), sgn * 0.012, -0.004, 0).rotation.z = -sgn * 0.5;
    }
    const el = new THREE.Group();
    el.position.y = -0.33;
    sh.add(el);
    add(el, sph(0.0355 * L * armK, armMat, 16, 12));
    add(el, mesh(memo(`farm${L * armK}`, () => loft([[0.034, 0.004, 0.004, 0], [0.02, 0.024, 0.025, 0], [0, 0.034, 0.035, 0], [-0.045, 0.043, 0.041, 0], [-0.1, 0.043, 0.04, 0], [-0.18, 0.034, 0.031, 0], [-0.27, 0.025, 0.022, 0], [-0.325, 0.024, 0.02, 0]], L * armK)), armMat));
    // wrist wrap / gauntlet
    const gm = cfg.metalTop ? metal(cfg.wrap) : wrapMat;
    add(el, new THREE.Mesh(new THREE.CylinderGeometry(0.031 * L * armK, 0.026 * L * armK, 0.11, 16), gm), 0, -0.265, 0).scale.x = 1.12;
    if (cfg.glow != null) {
      add(el, new THREE.Mesh(new THREE.TorusGeometry(0.032 * L, 0.003, 6, 20), accentMat), 0, -0.215, 0).rotation.x = Math.PI / 2;
      add(el, new THREE.Mesh(new THREE.TorusGeometry(0.028 * L, 0.003, 6, 20), accentMat), 0, -0.31, 0).rotation.x = Math.PI / 2;
    }
    if (cfg.crystals) {
      for (let i = 0; i < 3; i++) {
        const cr = add(el, new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.06 + i * 0.01, 5), accentMat), sgn * 0.034, -0.23 - i * 0.032, 0);
        cr.rotation.z = -sgn * (0.9 + i * 0.15);
      }
    }
    if (cfg.fans) {
      for (let i = 0; i < 4; i++) {
        const bl = add(el, new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.17 - i * 0.02, 0.042), cloth(cfg.fans, 0.25)), sgn * 0.03, -0.2, 0.045 * (i - 1.5) * 0.9);
        bl.rotation.x = (i - 1.5) * 0.32;
        bl.material.metalness = 0.8;
      }
    }
    // fist: palm, four curled fingers, thumb across them
    const hk = L * 0.94;
    add(el, sph(0.04 * hk, gloveMat, 14, 10), 0, -0.362, 0).scale.set(0.74, 0.95, 1.08);
    for (let i = 0; i < 4; i++) {
      const fg = add(el, new THREE.Mesh(new THREE.CapsuleGeometry(0.0118 * hk, 0.034 * hk, 3, 8), gloveMat), 0, -0.392 * (0.99 + hk * 0.01) + Math.abs(i - 1.5) * 0.0025, (i - 1.5) * 0.0215 * hk);
      fg.rotation.z = Math.PI / 2;
    }
    const th = add(el, new THREE.Mesh(new THREE.CapsuleGeometry(0.0115 * hk, 0.032 * hk, 3, 8), gloveMat), -sgn * 0.027 * hk, -0.377, 0.02 * hk);
    th.rotation.x = 1.15;
    const handA = new THREE.Object3D();
    handA.position.set(0, -0.35, 0);
    el.add(handA);

    // leg: quads forward at the thigh, calf bulging back
    const hp = new THREE.Group();
    hp.position.set(sgn * 0.09 * B.w, 0, 0);
    hips.add(hp);
    const legK = 1.1 + (B.muscle - 1) * 0.1;
    const thighSt = [[0.066, 0.004, 0.004, 0], [0.055, 0.03, 0.032, 0], [0.03, 0.052, 0.054, 0], [0, 0.066, 0.066, 0], [-0.06, 0.078, 0.09, 0.003], [-0.14, 0.077, 0.09, 0.008], [-0.26, 0.066, 0.076, 0.007], [-0.38, 0.05, 0.056, 0.003], [-0.46, 0.046, 0.047, 0], [-0.485, 0.032, 0.033, 0], [-0.503, 0.004, 0.004, 0]];
    add(hp, mesh(memo(`thigh${L * legK}`, () => loft(thighSt, L * legK, 24)), legMat));
    // A ball centred on each pivot looks the same at any angle, so limbs stay joined however they bend.
    add(hp, sph(0.066 * L * legK, legMat, 20, 16));
    const kn = new THREE.Group();
    kn.position.y = -LEG;
    hp.add(kn);
    add(kn, sph(0.0465 * L * legK, legMat, 16, 12));
    const shinSt = [[0.043, 0.004, 0.004, 0], [0.026, 0.032, 0.034, 0], [0, 0.0445, 0.046, 0], [-0.05, 0.046, 0.05, -0.005], [-0.13, 0.05, 0.057, -0.014], [-0.22, 0.044, 0.05, -0.012], [-0.34, 0.033, 0.036, -0.004], [-0.46, 0.029, 0.032, 0]];
    add(kn, mesh(memo(`shin${L * legK}`, () => loft(shinSt, L * legK, 24)), legMat));
    // boot shaft
    add(kn, mesh(memo(`shaft${L * legK}`, () => loft([[-0.31, 0.04, 0.044, -0.004], [-0.37, 0.036, 0.04, -0.002], [-0.46, 0.035, 0.038, 0]], L * legK, 20)), bootMat));
    if (cfg.shinGuard != null) {
      const gmat = cfg.metalTop ? metal(cfg.shinGuard) : cloth(cfg.shinGuard, 0.5);
      add(kn, new THREE.Mesh(new THREE.CylinderGeometry(0.046 * L, 0.038 * L, 0.2, 14, 1, true, -1.3, 2.6), gmat), 0, -0.2, 0.012).material.side = THREE.DoubleSide;
    }
    const an = new THREE.Group();
    an.position.y = -LEG;
    kn.add(an);
    add(an, mesh(memo('foot', footGeo), bootMat));
    const footA = new THREE.Object3D();
    footA.position.set(0, -0.03, 0.14);
    an.add(footA);
    const thighA = new THREE.Object3D();
    thighA.position.set(0, -0.23, 0);
    hp.add(thighA);
    sides[key2] = { sh, el, hip: hp, kn, an, hand: handA, foot: footA, thigh: thighA };
  }

  const anchor = (parent, y) => { const o = new THREE.Object3D(); o.position.y = y; parent.add(o); return o; };
  const hurt = [
    { obj: anchor(head, 0.12), r: 0.17 },
    { obj: anchor(spine, 0.36), r: 0.27 },
    { obj: anchor(spine, 0.15), r: 0.23 },
    { obj: anchor(hips, 0), r: 0.23 },
    { obj: sides.L.thigh, r: 0.16 },
    { obj: sides.R.thigh, r: 0.16 },
    { obj: sides.L.an, r: 0.14 },
    { obj: sides.R.an, r: 0.14 },
  ];
  return { root, hips, spine, head, L: sides.L, R: sides.R, hurt, bareTorso };
}
