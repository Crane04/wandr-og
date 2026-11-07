// Packs Mixamo characters and the shared animations into one small .glb per fighter.
//   1. put <fighter>.fbx (T-pose) and the "Without Skin" clips in assets/mixamo/
//   2. PORT=3105 node server.js          (in another terminal)
//   3. node tools/build-mixamo.mjs              (every fighter)
//      node tools/build-mixamo.mjs kain cinder  (just these)
// Needs playwright and Google Chrome. The raw FBX files never ship: they are
// mostly oversized textures, which get cut to 1024px JPEGs here.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const dir = path.resolve('assets/mixamo');
const base = process.env.BASE || 'http://localhost:3105';
const clips = ['idle', 'walk', 'walk-back', 'run', 'crouch', 'punch', 'kick', 'block', 'hit', 'knockdown', 'getup', 'victory'];
const all = ['james', 'rime', 'saffron', 'cinder', 'cipher', 'oro', 'lira', 'kain', 'zephyr'];
const names = process.argv.slice(2).length ? process.argv.slice(2) : all;

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage();
page.on('console', (m) => { if (!m.text().startsWith('THREE.')) console.log('  ', m.text()); });
page.on('pageerror', (e) => console.log('[error]', e.message));
await page.route('**/__fbx/*', (r) => r.fulfill({ body: fs.readFileSync(path.join(dir, path.basename(r.request().url()))) }));
await page.route('**/__pack', (r) => r.fulfill({ contentType: 'text/html', body: `<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>` }));
await page.goto(`${base}/__pack`);

// Clips are loaded once. Mixamo prefixes bones differently per download
// (mixamorig:, mixamorig9:), so tracks are stored by bare bone name.
await page.evaluate(async (clips) => {
  const THREE = await import('three');
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
  const bare = (n) => n.replace(/^mixamorig\d*:?/, '');
  window.CLIPS = [];
  for (const id of clips) {
    const src = await new FBXLoader().loadAsync(`/__fbx/${id}.fbx`);
    const hips = src.getObjectByProperty('isBone', true);
    const clip = src.animations[0];
    clip.name = id;
    clip.tracks = clip.tracks.filter((t) => t.name.endsWith('.quaternion') || /Hips\.position$/.test(t.name));
    for (const t of clip.tracks) t.name = bare(t.name);
    const pos = clip.tracks.find((t) => t.name === 'Hips.position');
    if (pos) {
      const v = pos.values;
      const travel = Math.hypot(v[v.length - 3] - v[0], v[v.length - 1] - v[2]);
      if (travel > 20 && !/knockdown|getup/.test(id)) console.log(`${id}: travels ${travel.toFixed(0)}cm, removed`);
    }
    window.CLIPS.push({ clip, restY: hips.position.y });
  }
}, clips);

for (const name of names) {
  const b64 = await page.evaluate(async (name) => {
    const THREE = await import('three');
    const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const { mergeVertices } = await import('three/addons/utils/BufferGeometryUtils.js');
    const manager = new THREE.LoadingManager();
    const texturesDone = new Promise((r) => { manager.onLoad = r; });
    const char = await new FBXLoader(manager).loadAsync(`/__fbx/${name}.fbx`);
    await texturesDone;
    char.animations = [];

    // bones lose the download's prefix so every fighter shares one naming
    const bones = [];
    char.traverse((o) => { if (o.isBone) { o.name = o.name.replace(/^mixamorig\d*:?/, ''); bones.push(o.name); } });
    const hips = char.getObjectByName('Hips');

    const jpeg = (t) => { if (t) t.userData.mimeType = 'image/jpeg'; return t; };
    char.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry = mergeVertices(o.geometry); // FBX stores every triangle corner separately
      // FBX can split a body into hundreds of runs per material; one run each draws far faster
      const g = o.geometry;
      if (g.groups.length > 1) {
        const idx = g.index.array, runs = new Map();
        for (const gr of g.groups) {
          if (!runs.has(gr.materialIndex)) runs.set(gr.materialIndex, []);
          runs.get(gr.materialIndex).push(idx.subarray(gr.start, gr.start + gr.count));
        }
        const merged = new idx.constructor(idx.length);
        let at = 0;
        g.clearGroups();
        for (const [mi, parts] of runs) {
          const start = at;
          for (const p of parts) { merged.set(p, at); at += p.length; }
          g.addGroup(start, at - start, mi);
        }
        g.setIndex(new THREE.BufferAttribute(merged.subarray(0, at), 1));
      }
      const swap = (m) => {
        // cut-out parts (fringes, straps) keep their alpha, so they stay PNG
        const cut = m.transparent || !!m.alphaMap || /transparent|opacity|alpha/i.test(`${m.name} ${m.map?.name || ''}`);
        const out = new THREE.MeshStandardMaterial({
          name: m.name, map: cut ? m.map : jpeg(m.map), normalMap: jpeg(m.normalMap),
          roughness: 0.72, metalness: 0, alphaTest: cut ? 0.5 : 0, side: cut ? THREE.DoubleSide : THREE.FrontSide,
        });
        if (m.emissiveMap) { out.emissiveMap = jpeg(m.emissiveMap); out.emissive = new THREE.Color(0xffffff); }
        return out;
      };
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });

    // fit each clip to this body: same turns, hips raised to this body's own height
    const animations = window.CLIPS.map(({ clip, restY }) => {
      const c = clip.clone();
      c.tracks = c.tracks.filter((t) => bones.includes(t.name.split('.')[0]));
      for (const t of c.tracks) {
        if (t.name !== 'Hips.position') continue;
        const v = t.values, k = hips.position.y / restY;
        for (let i = 0; i < v.length; i += 3) { v[i] = hips.position.x; v[i + 1] *= k; v[i + 2] = hips.position.z; }
      }
      return c;
    });

    const glb = await new GLTFExporter().parseAsync(char, { binary: true, animations, maxTextureSize: 1024, onlyVisible: false });
    let s = '';
    const u = new Uint8Array(glb);
    for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768));
    return btoa(s);
  }, name);
  const out = path.resolve(`public/models/${name}.glb`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log(`${path.relative('.', out)}  ${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);
}
await browser.close();
