import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { glowTexture } from './fx.js';

function canvasTex(w, h, draw, repeat, aniso) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso || 1;
  return t;
}

function drawStone(g, w, h, cols, rows, base) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  const cw = w / cols, ch = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = 38 + Math.random() * 26;
      g.fillStyle = `rgb(${v + 4},${v + 2},${v + 8})`;
      g.fillRect(c * cw + 2, r * ch + 2, cw - 4, ch - 4);
    }
  }
  for (let i = 0; i < 7000; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? 0 : 255},${Math.random() < 0.5 ? 0 : 255},${Math.random() < 0.5 ? 0 : 255},0.05)`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    let x = Math.random() * w, y = Math.random() * h;
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 70; y += (Math.random() - 0.5) * 70; g.lineTo(x, y); }
    g.stroke();
  }
}

export function buildStage(scene, renderer) {
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const fogColor = 0x1b1626;
  scene.fog = new THREE.FogExp2(fogColor, 0.03);

  // image based lighting so PBR materials have something to reflect
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  if ('environmentIntensity' in scene) scene.environmentIntensity = 0.16;

  // ---- sky dome ----------------------------------------------------------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(120, 32, 16),
    new THREE.MeshBasicMaterial({
      side: THREE.BackSide, fog: false,
      map: canvasTex(16, 256, (g, w, h) => {
        const grad = g.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#05060f'); grad.addColorStop(0.45, '#1a1a3a'); grad.addColorStop(0.62, '#5a3a5e'); grad.addColorStop(0.72, '#c4683c'); grad.addColorStop(0.77, '#3b2438'); grad.addColorStop(1, '#14101c');
        g.fillStyle = grad; g.fillRect(0, 0, w, h);
      }),
    })
  );
  scene.add(sky);

  const starGeo = new THREE.BufferGeometry();
  const sp = [];
  for (let i = 0; i < 500; i++) {
    const a = Math.random() * Math.PI * 2, e = 0.15 + Math.random() * 1.2, r = 110;
    sp.push(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, -Math.abs(Math.sin(a) * Math.cos(e) * r));
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.9, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 })));

  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xcfd8ff, fog: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  moon.position.set(-26, 22, -85);
  moon.scale.set(34, 34, 1);
  scene.add(moon);
  const moonCore = new THREE.Mesh(new THREE.CircleGeometry(4.2, 40), new THREE.MeshBasicMaterial({ color: 0xf1f3ff, fog: false, toneMapped: false }));
  moonCore.position.set(-26, 22, -84);
  scene.add(moonCore);

  // distant ridgelines
  const ridge = (z, color, base, amp, seed) => {
    const sh = new THREE.Shape();
    sh.moveTo(-120, 0);
    let h = base;
    for (let x = -120; x <= 120; x += 6) {
      h = base + Math.sin(x * 0.07 + seed) * amp + Math.sin(x * 0.19 + seed * 2) * amp * 0.4 + Math.random() * 1.2;
      sh.lineTo(x, h);
    }
    sh.lineTo(120, 0);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshBasicMaterial({ color, fog: false }));
    m.position.set(0, -1, z);
    scene.add(m);
  };
  ridge(-75, 0x1a1530, 9, 6, 1);
  ridge(-60, 0x120f22, 6, 4, 4);
  ridge(-48, 0x0c0a16, 4, 2.5, 8);

  // ---- lights --------------------------------------------------------------
  scene.add(new THREE.HemisphereLight(0x5a668f, 0x2a1a14, 0.32));

  const key = new THREE.DirectionalLight(0xffd9a8, 2.4);
  key.position.set(4, 8, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -8; key.shadow.camera.right = 8;
  key.shadow.camera.top = 6; key.shadow.camera.bottom = -4;
  key.shadow.camera.near = 1; key.shadow.camera.far = 26;
  key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02;
  scene.add(key);
  scene.add(key.target);

  const rim = new THREE.DirectionalLight(0x5aa0ff, 1.8);
  rim.position.set(-3, 4, -6);
  scene.add(rim);

  // ---- floor ----------------------------------------------------------------
  const floorTex = canvasTex(1024, 1024, (g, w, h) => drawStone(g, w, h, 4, 4, '#101014'), [9, 5], aniso);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(44, 24),
    new THREE.MeshPhysicalMaterial({ map: floorTex, bumpMap: floorTex, bumpScale: 0.8, roughness: 0.55, metalness: 0.05, clearcoat: 0.2, clearcoatRoughness: 0.5, color: 0xc8b8a8 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -4;
  floor.receiveShadow = true;
  scene.add(floor);

  const emblem = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 9),
    new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, opacity: 0.75, toneMapped: false,
      map: canvasTex(512, 512, (g, w, h) => {
        g.clearRect(0, 0, w, h);
        g.translate(w / 2, h / 2);
        const ring = (r, wd, a) => { g.strokeStyle = `rgba(200,150,70,${a})`; g.lineWidth = wd; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); };
        ring(240, 6, 0.5); ring(222, 2, 0.4); ring(150, 3, 0.3);
        for (let i = 0; i < 8; i++) {
          g.save(); g.rotate((i / 8) * Math.PI * 2);
          g.strokeStyle = 'rgba(200,150,70,0.35)'; g.lineWidth = 4;
          g.strokeRect(-10, -222, 20, 72);
          g.restore();
        }
      }),
    })
  );
  emblem.rotation.x = -Math.PI / 2;
  emblem.position.set(0, 0.006, 0);
  scene.add(emblem);

  // ---- temple architecture -----------------------------------------------------
  const stoneTex = canvasTex(256, 512, (g, w, h) => drawStone(g, w, h, 2, 6, '#17151c'), [1, 2], aniso);
  const stone = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.85, metalness: 0.02, color: 0xbdb6c9 });

  const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 16), new THREE.MeshStandardMaterial({
    map: canvasTex(1024, 512, (g, w, h) => drawStone(g, w, h, 12, 6, '#0b0a10'), [3, 1], aniso), roughness: 0.95, color: 0x8f8aa0,
  }));
  wall.position.set(0, 7, -11);
  wall.receiveShadow = true;
  scene.add(wall);

  const beam = new THREE.Mesh(new THREE.BoxGeometry(30, 0.8, 1.4), stone);
  beam.position.set(0, 7.2, -8);
  beam.castShadow = true;
  scene.add(beam);

  for (let x = -12; x <= 12; x += 4) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.58, 7.4, 20), stone);
    col.position.set(x, 3.7, -8);
    col.castShadow = true; col.receiveShadow = true;
    scene.add(col);
    for (const [y, w] of [[0.15, 1.5], [7.35, 1.4]]) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, w), stone);
      cap.position.set(x, y, -8);
      cap.castShadow = true;
      scene.add(cap);
    }
  }

  // steps leading back to the wall
  for (let i = 0; i < 3; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(26, 0.18, 1.4), stone);
    step.position.set(0, 0.09 + i * 0.18, -6.2 - i * 1.0);
    step.receiveShadow = true; step.castShadow = true;
    scene.add(step);
  }

  // ---- torches -----------------------------------------------------------------
  const torches = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const makeTorch = (x, z, lit = true) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.9, 8), new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.8 }));
    pole.position.y = 0.95; pole.castShadow = true;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.1, 0.18, 12), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.6, roughness: 0.4 }));
    bowl.position.y = 1.95;
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.55, 10), flameMat);
    flame.position.y = 2.25;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xff7a2a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8, fog: false }));
    glow.position.y = 2.25; glow.scale.set(1.0, 1.0, 1);
    g.add(pole, bowl, flame, glow);
    scene.add(g);
    let light = null;
    if (lit) {
      light = new THREE.PointLight(0xff8a3c, 22, 14, 2);
      light.position.set(x, 2.3, z + 0.4);
      scene.add(light);
    }
    torches.push({ flame, glow, light, seed: Math.random() * 10, x, z });
  };
  makeTorch(-6.6, -1.6);
  makeTorch(6.6, -1.6);
  makeTorch(-3.5, -7, false);
  makeTorch(3.5, -7, false);

  // ---- embers + dust ----------------------------------------------------------------
  const emberCount = 140;
  const emberGeo = new THREE.BufferGeometry();
  const ePos = new Float32Array(emberCount * 3);
  const eSeed = [];
  for (let i = 0; i < emberCount; i++) {
    const t = torches[i % torches.length];
    ePos[i * 3] = t.x + (Math.random() - 0.5) * 0.4;
    ePos[i * 3 + 1] = 2.2 + Math.random() * 4;
    ePos[i * 3 + 2] = t.z + (Math.random() - 0.5) * 0.4;
    eSeed.push({ t, v: 0.4 + Math.random() * 0.8, w: Math.random() * 6 });
  }
  emberGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
  scene.add(new THREE.Points(emberGeo, new THREE.PointsMaterial({ color: 0xff9440, size: 0.06, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));

  const dustCount = 220;
  const dustGeo = new THREE.BufferGeometry();
  const dPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dPos[i * 3] = (Math.random() - 0.5) * 22;
    dPos[i * 3 + 1] = Math.random() * 6;
    dPos[i * 3 + 2] = -9 + Math.random() * 13;
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  scene.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xaab4d4, size: 0.035, transparent: true, opacity: 0.35, depthWrite: false })));

  return {
    update(t, dt) {
      for (const tr of torches) {
        const f = 0.82 + 0.18 * Math.sin(t * 13 + tr.seed) * Math.sin(t * 7.3 + tr.seed * 2) + (Math.random() - 0.5) * 0.08;
        if (tr.light) tr.light.intensity = 22 * f;
        tr.flame.scale.set(1 + (f - 0.8) * 0.5, 0.85 + f * 0.35, 1 + (f - 0.8) * 0.5);
        tr.glow.material.opacity = 0.4 + f * 0.25;
      }
      const ep = emberGeo.attributes.position;
      for (let i = 0; i < emberCount; i++) {
        const s = eSeed[i];
        let y = ep.getY(i) + s.v * dt;
        if (y > 7) { y = 2.2; ep.setX(i, s.t.x + (Math.random() - 0.5) * 0.4); }
        ep.setY(i, y);
        ep.setX(i, ep.getX(i) + Math.sin(t * 1.4 + s.w) * dt * 0.25);
      }
      ep.needsUpdate = true;
      const dp = dustGeo.attributes.position;
      for (let i = 0; i < dustCount; i++) {
        let y = dp.getY(i) + Math.sin(t * 0.3 + i) * dt * 0.05 - dt * 0.03;
        if (y < 0) y = 6;
        dp.setY(i, y);
        dp.setX(i, dp.getX(i) + dt * 0.08);
        if (dp.getX(i) > 11) dp.setX(i, -11);
      }
      dp.needsUpdate = true;
    },
  };
}
