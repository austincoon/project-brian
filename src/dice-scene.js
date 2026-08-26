import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

import {
  DIE_FACE_VALUES,
  DIE_SIZE,
  TRAY_DEPTH,
  TRAY_WIDTH,
  createDiceSimulation,
  readDiceResults,
  replaySeedFor,
  simulateDice,
  stepDiceSimulation,
} from "./dice-physics.js?v=20260825-1";

export { replaySeedFor };

function faceTexture(value) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 192;
  const context = canvas.getContext("2d");
  context.fillStyle = "#f7f4e9";
  context.fillRect(0, 0, 192, 192);
  context.fillStyle = value === 1 ? "#b51f2e" : "#171717";
  const positions = {
    1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [2, 0], [0, 2], [2, 2]],
    5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
    6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
  };
  for (const [column, row] of positions[value]) {
    context.beginPath();
    context.arc(48 + column * 48, 48 + row * 48, 13, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function throwDice(container, seed, onSettled) {
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width < 100 || height < 100) {
    onSettled(simulateDice(seed));
    return { dispose() {} };
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(width, height, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  container.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x185c39);
  const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
  const cameraDistance = (TRAY_DEPTH / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(0, cameraDistance * 0.9, cameraDistance * 0.42);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xfff7dd, 0x102c1c, 2.1));
  const light = new THREE.DirectionalLight(0xffffff, 3.8);
  light.position.set(-5, 12, 7);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  scene.add(light);

  const felt = new THREE.Mesh(
    new THREE.PlaneGeometry(TRAY_WIDTH, TRAY_DEPTH),
    new THREE.MeshStandardMaterial({ color: 0x1f7047, roughness: 0.96 }),
  );
  felt.rotation.x = -Math.PI / 2;
  felt.receiveShadow = true;
  scene.add(felt);
  const railMaterial = new THREE.MeshStandardMaterial({ color: 0x4f2710, roughness: 0.72 });
  const railGeometries = [];
  const addRail = (x, z, railWidth, railDepth) => {
    const geometry = new THREE.BoxGeometry(railWidth, 0.55, railDepth);
    railGeometries.push(geometry);
    const rail = new THREE.Mesh(geometry, railMaterial);
    rail.position.set(x, 0.22, z);
    rail.castShadow = true;
    rail.receiveShadow = true;
    scene.add(rail);
  };
  addRail(-TRAY_WIDTH / 2, 0, 0.34, TRAY_DEPTH);
  addRail(TRAY_WIDTH / 2, 0, 0.34, TRAY_DEPTH);
  addRail(0, -TRAY_DEPTH / 2, TRAY_WIDTH, 0.34);
  addRail(0, TRAY_DEPTH / 2, TRAY_WIDTH, 0.34);

  const geometry = new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 5, 0.16);
  const materials = DIE_FACE_VALUES.map((value) => new THREE.MeshStandardMaterial({
    map: faceTexture(value), roughness: 0.48, metalness: 0.02,
  }));
  const simulation = createDiceSimulation(seed);
  const meshes = simulation.bodies.map((body) => {
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
    scene.add(mesh);
    return mesh;
  });
  renderer.render(scene, camera);

  let animationFrame;
  let previous = performance.now();
  let accumulator = 0;
  let disposed = false;
  const frame = (now) => {
    accumulator += Math.min((now - previous) / 1000, 0.1);
    previous = now;
    let finished = false;
    while (accumulator >= 1 / 60 && !finished) {
      finished = stepDiceSimulation(simulation);
      accumulator -= 1 / 60;
    }
    for (const [index, body] of simulation.bodies.entries()) {
      meshes[index].position.copy(body.position);
      meshes[index].quaternion.copy(body.quaternion);
    }
    renderer.render(scene, camera);
    if (finished) {
      onSettled(readDiceResults(simulation));
      return;
    }
    if (!disposed) animationFrame = requestAnimationFrame(frame);
  };
  animationFrame = requestAnimationFrame(frame);

  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      geometry.dispose();
      for (const material of materials) {
        material.map.dispose();
        material.dispose();
      }
      felt.geometry.dispose();
      felt.material.dispose();
      for (const railGeometry of railGeometries) railGeometry.dispose();
      railMaterial.dispose();
      renderer.dispose();
    },
  };
}
