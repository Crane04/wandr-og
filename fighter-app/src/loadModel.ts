// Loads a fighter's body from the files bundled with the app. The shared skin code
// calls this in place of the website's GLTFLoader.loadAsync('/models/<name>.glb').
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { MODELS } from './game/models';

// expo-gl can upload an image file straight to the GPU when given { localUri }, so the
// texture never needs decoding in JavaScript.
async function fileTexture(module: number, color: boolean) {
  const asset = Asset.fromModule(module);
  await asset.downloadAsync();
  const t = new THREE.Texture();
  t.image = { data: { localUri: asset.localUri }, width: asset.width, height: asset.height };
  (t as unknown as { isDataTexture: boolean }).isDataTexture = true;
  t.flipY = false; // glTF textures are stored top-down
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export async function loadModel(name: string) {
  const entry = MODELS[name];
  if (!entry) throw new Error(`no bundled model for ${name}`);
  const asset = Asset.fromModule(entry.model);
  await asset.downloadAsync();
  const bytes = await new File(asset.localUri!).arrayBuffer();
  const gltf = await new GLTFLoader().parseAsync(bytes, '');

  const cache = new Map<string, Promise<THREE.Texture>>();
  const get = (file: string, color: boolean) => {
    if (!cache.has(file)) cache.set(file, fileTexture(entry.textures[file], color));
    return cache.get(file)!;
  };
  const jobs: Promise<void>[] = [];
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]) {
      const slots = (m.userData.textures || {}) as Record<string, string>;
      for (const [slot, file] of Object.entries(slots)) {
        jobs.push(get(file, slot !== 'normalMap').then((t) => {
          (m as unknown as Record<string, THREE.Texture>)[slot] = t;
          if (slot === 'emissiveMap') m.emissive = new THREE.Color(0xffffff);
          m.needsUpdate = true;
        }));
      }
    }
  });
  await Promise.all(jobs);
  return gltf;
}
