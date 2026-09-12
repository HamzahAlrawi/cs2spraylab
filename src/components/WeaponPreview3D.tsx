import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { getWeaponModelUrl, parseWeaponModelAsset, WeaponModelAsset } from '../lib/modelAssets';
import { buildWeaponGroup, disposeThreeObject } from '../lib/threeWeaponFactory';
import { AttemptResult, WeaponPattern } from '../types';

type Props = {
  weapon: WeaponPattern;
  attempt?: AttemptResult;
};

function addTarget(scene: THREE.Scene) {
  const target = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.82, metalness: 0.05, transparent: true, opacity: 0.88 });
  const edgeMaterial = new THREE.MeshStandardMaterial({ color: '#f59e0b', roughness: 0.5, metalness: 0.2 });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 16), material);
  head.position.set(0, 1.55, 0);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.82, 0.08), material);
  chest.position.set(0, 0.96, 0);
  const stomach = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.34, 0.08), material);
  stomach.position.set(0, 0.38, 0);
  const legLeft = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.72, 0.07), material);
  legLeft.position.set(-0.15, -0.18, 0);
  const legRight = legLeft.clone();
  legRight.position.x = 0.15;

  const headRing = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.012, 8, 40), edgeMaterial);
  headRing.position.copy(head.position);

  target.add(head, chest, stomach, legLeft, legRight, headRing);
  target.position.set(2.25, -0.5, -1.45);
  target.rotation.y = -0.18;
  scene.add(target);
  return target;
}

function addAttemptImpacts(scene: THREE.Scene, attempt?: AttemptResult) {
  if (!attempt) return new THREE.Group();
  const group = new THREE.Group();
  group.name = 'recent-attempt-impacts';
  const maxError = Math.max(1, ...attempt.bulletErrors.map((error) => error.distance));
  attempt.bulletErrors.slice(0, 15).forEach((error, index) => {
    const missRatio = Math.min(1, error.distance / maxError);
    const material = new THREE.MeshStandardMaterial({
      color: error.hitZone === 'miss' ? '#ef4444' : '#22c55e',
      emissive: error.hitZone === 'miss' ? '#7f1d1d' : '#14532d',
      emissiveIntensity: 0.45 + missRatio * 0.35,
      roughness: 0.35,
      metalness: 0.1
    });
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.028 + missRatio * 0.018, 12, 8), material);
    dot.position.set(2.25 + error.dx / 220, 1.28 - index * 0.055 - error.dy / 260, -1.36);
    group.add(dot);
  });
  scene.add(group);
  return group;
}

export function WeaponPreview3D({ weapon, attempt }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [asset, setAsset] = useState<WeaponModelAsset | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAsset(null);
    setAssetError(null);
    fetch(getWeaponModelUrl(weapon.id))
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load ${weapon.name} model asset.`);
        return response.json();
      })
      .then((json) => parseWeaponModelAsset(json))
      .then((loaded) => {
        if (!cancelled) setAsset(loaded);
      })
      .catch((error: Error) => {
        if (!cancelled) setAssetError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [weapon.id, weapon.name]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !asset) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#020617', 8, 15);

    const camera = new THREE.PerspectiveCamera(38, mount.clientWidth / Math.max(1, mount.clientHeight), 0.1, 100);
    camera.position.set(0.55, 1.12, 6.2);
    camera.lookAt(0.35, 0.28, -0.55);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    const key = new THREE.DirectionalLight('#ffffff', 2.4);
    key.position.set(4, 6, 5);
    key.castShadow = true;
    scene.add(key);
    scene.add(new THREE.AmbientLight('#cbd5e1', 1.25));

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 4),
      new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.92, metalness: 0.05 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.92;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(7, 14, '#f59e0b', '#334155');
    grid.position.y = -0.91;
    scene.add(grid);

    const weaponGroup = buildWeaponGroup(asset);
    const targetGroup = addTarget(scene);
    const impactGroup = addAttemptImpacts(scene, attempt);
    scene.add(weaponGroup);

    let frame = 0;
    const animate = () => {
      const now = performance.now() * 0.001;
      weaponGroup.rotation.y = -0.42 + Math.sin(now * 0.85) * 0.08;
      weaponGroup.rotation.x = 0.08 + Math.sin(now * 0.55) * 0.02;
      targetGroup.rotation.y = -0.18 + Math.sin(now * 0.7) * 0.035;
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    const resize = () => {
      camera.aspect = mount.clientWidth / Math.max(1, mount.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      disposeThreeObject(weaponGroup);
      disposeThreeObject(targetGroup);
      disposeThreeObject(impactGroup);
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [asset, attempt]);

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/80 p-5 shadow-2xl shadow-black/30">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.28em] text-amber-300">3D range</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Realistic look-alike weapon asset</h2>
        </div>
        <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">Cloudflare-ready static JSON</span>
      </div>
      <div ref={mountRef} className="h-64 rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 to-slate-950" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-400">
        <span>{asset ? `${asset.name} · ${asset.parts.length} mesh parts` : 'Loading 3D asset…'}</span>
        <span>{attempt ? `Showing latest ${attempt.weaponName} impacts` : 'No recent impacts yet'}</span>
      </div>
      {assetError ? <p className="mt-2 text-sm text-red-300">{assetError}</p> : null}
      <p className="mt-2 text-xs text-slate-500">
        These are original redistributable look-alike training assets, not CS2/Valve models. The loader is structured so licensed GLB/PBR assets can replace the JSON parts later.
      </p>
    </section>
  );
}
