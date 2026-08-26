import * as CANNON from "../vendor/cannon-es.js";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

import { DIE_FACE_VALUES, DIE_RESULT_ROTATIONS } from "./dice.js?v=20260825-28";

const DIE_SIZE = 1.45;
const THROW_TIME = 2.2;
const SETTLE_TIME = 0.45;

function faceTexture(value) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 192;
  const context = canvas.getContext("2d");
  context.fillStyle = "#f7f4e9";
  context.fillRect(0, 0, 192, 192);
  context.fillStyle = value === 1 ? "#b51f2e" : "#171717";
  const positions = {
    1: [[1, 1]],
    2: [[0, 0], [2, 2]],
    3: [[0, 0], [1, 1], [2, 2]],
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

function finalQuaternion(value, yaw) {
  const rotation = DIE_RESULT_ROTATIONS[value];
  const faceUp = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(faceUp);
}

export function throwDice(container, values, onSettled) {
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width < 100 || height < 100) {
    onSettled();
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
  const aspect = width / height;
  const trayWidth = 8;
  const trayDepth = Math.max(10, trayWidth / aspect);
  const camera = new THREE.PerspectiveCamera(38, aspect, 0.1, 100);
  const cameraDistance = (trayDepth / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(0, cameraDistance * 0.9, cameraDistance * 0.42);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xfff7dd, 0x102c1c, 2.1));
  const light = new THREE.DirectionalLight(0xffffff, 3.8);
  light.position.set(-5, 12, 7);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  scene.add(light);

  const felt = new THREE.Mesh(
    new THREE.PlaneGeometry(trayWidth, trayDepth),
    new THREE.MeshStandardMaterial({ color: 0x1f7047, roughness: 0.96 }),
  );
  felt.rotation.x = -Math.PI / 2;
  felt.receiveShadow = true;
  scene.add(felt);

  const railMaterial = new THREE.MeshStandardMaterial({ color: 0x4f2710, roughness: 0.72 });
  const railGeometries = [];
  const addRail = (x, z, railWidth, railDepth) => {
    const railGeometry = new THREE.BoxGeometry(railWidth, 0.55, railDepth);
    railGeometries.push(railGeometry);
    const rail = new THREE.Mesh(railGeometry, railMaterial);
    rail.position.set(x, 0.22, z);
    rail.castShadow = true;
    rail.receiveShadow = true;
    scene.add(rail);
  };
  addRail(-trayWidth / 2, 0, 0.34, trayDepth);
  addRail(trayWidth / 2, 0, 0.34, trayDepth);
  addRail(0, -trayDepth / 2, trayWidth, 0.34);
  addRail(0, trayDepth / 2, trayWidth, 0.34);

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -18, 0) });
  world.allowSleep = true;
  world.defaultContactMaterial.friction = 0.28;
  world.defaultContactMaterial.restitution = 0.42;
  const floor = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);
  const addWall = (x, z, halfX, halfZ) => {
    const wall = new CANNON.Body({ type: CANNON.Body.STATIC });
    wall.addShape(new CANNON.Box(new CANNON.Vec3(halfX, 1.4, halfZ)));
    wall.position.set(x, 0.8, z);
    world.addBody(wall);
  };
  addWall(-trayWidth / 2, 0, 0.18, trayDepth / 2);
  addWall(trayWidth / 2, 0, 0.18, trayDepth / 2);
  addWall(0, -trayDepth / 2, trayWidth / 2, 0.18);
  addWall(0, trayDepth / 2, trayWidth / 2, 0.18);

  const geometry = new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 5, 0.16);
  const materials = DIE_FACE_VALUES.map((value) => new THREE.MeshStandardMaterial({
    map: faceTexture(value),
    roughness: 0.48,
    metalness: 0.02,
  }));
  const dice = values.map((value, index) => {
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const body = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Box(new CANNON.Vec3(DIE_SIZE / 2, DIE_SIZE / 2, DIE_SIZE / 2)),
      linearDamping: 0.12,
      angularDamping: 0.1,
      sleepSpeedLimit: 0.12,
    });
    const jitter = () => Math.random() - 0.5;
    body.position.set((index ? 1.45 : -1.6) + jitter() * 0.5, 4 + index * 1.15, trayDepth / 2 - 2.2 - index * 0.8);
    body.velocity.set((index ? -2.2 : 2.5) + jitter(), -1, -Math.max(7.5, trayDepth * 0.72) + jitter());
    body.angularVelocity.set((index ? -11 : 13) + jitter() * 4, (index ? 15 : -12) + jitter() * 4, (index ? -10 : 9) + jitter() * 4);
    body.quaternion.setFromEuler(index ? 0.7 : -0.4, index ? -0.8 : 1.1, index ? 0.5 : -0.6);
    world.addBody(body);
    return { value, mesh, body, start: null, target: finalQuaternion(value, jitter() * 0.8) };
  });
  for (const die of dice) {
    die.mesh.position.copy(die.body.position);
    die.mesh.quaternion.copy(die.body.quaternion);
  }
  renderer.render(scene, camera);

  let animationFrame;
  let previous = performance.now();
  let elapsed = 0;
  let settlingAt = null;
  let disposed = false;
  const frame = (now) => {
    const delta = Math.min((now - previous) / 1000, 0.05);
    previous = now;
    elapsed += delta;
    if (elapsed < THROW_TIME) {
      world.step(1 / 60, delta, 4);
      for (const die of dice) {
        die.mesh.position.copy(die.body.position);
        die.mesh.quaternion.copy(die.body.quaternion);
      }
    } else {
      if (settlingAt === null) {
        settlingAt = elapsed;
        for (const die of dice) die.start = die.mesh.quaternion.clone();
      }
      const progress = Math.min((elapsed - settlingAt) / SETTLE_TIME, 1);
      const eased = 1 - (1 - progress) ** 3;
      for (const die of dice) die.mesh.quaternion.slerpQuaternions(die.start, die.target, eased);
      if (progress === 1) {
        renderer.render(scene, camera);
        onSettled();
        return;
      }
    }
    renderer.render(scene, camera);
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
