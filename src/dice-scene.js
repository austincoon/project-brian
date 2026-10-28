import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

import {
  DIE_FACE_VALUES,
  DIE_SIZE,
  TRAY_DEPTH,
  TRAY_WIDTH,
  planDiceThrow,
} from "./dice-physics.js";

const STEP_SECONDS = 1 / 60;
// One renderer is shared by every throw so each roll avoids a new WebGL context and shader compile.
let table = null;

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

function createTable() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x185c39);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
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
  const addRail = (x, z, railWidth, railDepth) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(railWidth, 0.55, railDepth), railMaterial);
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
  const dice = [0, 1].map(() => {
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  });

  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    if (table?.renderer === renderer) table = null;
  });
  return { renderer, scene, camera, dice };
}

function frameCamera({ renderer, camera }, width, height) {
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  const landscape = width > height;
  const vertical = landscape ? TRAY_WIDTH : TRAY_DEPTH;
  const horizontal = landscape ? TRAY_DEPTH : TRAY_WIDTH;
  const distance = Math.max(vertical / 2, horizontal / (2 * camera.aspect)) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(landscape ? distance * 0.51 : 0, distance * 1.1, landscape ? 0 : distance * 0.51);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

function randomSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

// Animates a fresh throw that lands on `values`, which the game has already rolled.
export function throwDice(container, values, onSettled, settled = false) {
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width < 100 || height < 100) {
    onSettled([...values]);
    return { dispose() {} };
  }

  table ??= createTable();
  const current = table;
  const { renderer, scene, camera, dice } = current;
  const plan = planDiceThrow(values, randomSeed());
  const turns = plan.turns.map(({ x, y, z, w }) => new THREE.Quaternion(x, y, z, w));
  const from = new THREE.Quaternion();
  const to = new THREE.Quaternion();
  const showFrame = (position) => {
    const step = Math.min(Math.floor(position), plan.steps);
    const next = Math.min(step + 1, plan.steps);
    const blend = Math.min(position - step, 1);
    dice.forEach((mesh, index) => {
      const a = (step * 2 + index) * 7;
      const b = (next * 2 + index) * 7;
      mesh.position.set(
        THREE.MathUtils.lerp(plan.frames[a], plan.frames[b], blend),
        THREE.MathUtils.lerp(plan.frames[a + 1], plan.frames[b + 1], blend),
        THREE.MathUtils.lerp(plan.frames[a + 2], plan.frames[b + 2], blend),
      );
      from.fromArray(plan.frames, a + 3);
      to.fromArray(plan.frames, b + 3);
      mesh.quaternion.slerpQuaternions(from, to, blend).multiply(turns[index]);
      mesh.visible = true;
    });
    renderer.render(scene, camera);
  };

  container.replaceChildren(renderer.domElement);
  let position = settled ? plan.steps : 0;
  const resize = () => {
    if (!container.clientWidth || !container.clientHeight) return;
    frameCamera(current, container.clientWidth, container.clientHeight);
    showFrame(position);
  };
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  let animationFrame;
  let done = false;
  let previous = performance.now();
  const stop = () => {
    done = true;
    cancelAnimationFrame(animationFrame);
    document.removeEventListener("visibilitychange", skipWhenHidden);
  };
  const finish = () => {
    if (done) return;
    stop();
    position = plan.steps;
    showFrame(position);
    onSettled([...values]);
  };
  // Hidden tabs pause animation frames, so a roll finishes at once rather than stalling the game.
  function skipWhenHidden() {
    if (document.hidden) finish();
  }
  const frame = (now) => {
    if (done) return;
    position += Math.min((now - previous) / 1000, 0.1) / STEP_SECONDS;
    previous = now;
    if (position >= plan.steps) {
      finish();
      return;
    }
    showFrame(position);
    animationFrame = requestAnimationFrame(frame);
  };
  if (settled || document.hidden) finish();
  else {
    document.addEventListener("visibilitychange", skipWhenHidden);
    animationFrame = requestAnimationFrame(frame);
  }

  return {
    dispose() {
      stop();
      resizeObserver.disconnect();
    },
  };
}
