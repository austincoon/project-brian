import * as CANNON from "../vendor/cannon-es.js";

export const DIE_FACE_VALUES = [3, 4, 2, 5, 1, 6];
export const TRAY_WIDTH = 8;
export const TRAY_DEPTH = 14;
export const DIE_SIZE = 1.45;
const MIN_STEPS = 110;
const MAX_STEPS = 180;
const REPLAY_SEEDS = {
  "1-1": 26, "1-2": 10, "1-3": 4, "1-4": 23, "1-5": 8, "1-6": 64,
  "2-1": 35, "2-2": 5, "2-3": 40, "2-4": 2, "2-5": 34, "2-6": 6,
  "3-1": 22, "3-2": 43, "3-3": 19, "3-4": 44, "3-5": 11, "3-6": 66,
  "4-1": 29, "4-2": 108, "4-3": 12, "4-4": 42, "4-5": 28, "4-6": 13,
  "5-1": 30, "5-2": 16, "5-3": 3, "5-4": 39, "5-5": 18, "5-6": 51,
  "6-1": 14, "6-2": 67, "6-3": 58, "6-4": 69, "6-5": 1, "6-6": 9,
};

function seededRandom(seed) {
  let state = seed >>> 0 || 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function randomQuaternion(random) {
  const first = random();
  const second = random() * Math.PI * 2;
  const third = random() * Math.PI * 2;
  return new CANNON.Quaternion(
    Math.sqrt(1 - first) * Math.sin(second),
    Math.sqrt(1 - first) * Math.cos(second),
    Math.sqrt(first) * Math.sin(third),
    Math.sqrt(first) * Math.cos(third),
  );
}

export function createDiceSimulation(seed) {
  const random = seededRandom(seed);
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -18, 0) });
  world.allowSleep = true;
  world.defaultContactMaterial.friction = 0.34;
  world.defaultContactMaterial.restitution = 0.34;
  const floor = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);
  const addWall = (x, z, halfX, halfZ) => {
    const wall = new CANNON.Body({ type: CANNON.Body.STATIC });
    wall.addShape(new CANNON.Box(new CANNON.Vec3(halfX, 1.4, halfZ)));
    wall.position.set(x, 0.8, z);
    world.addBody(wall);
  };
  addWall(-TRAY_WIDTH / 2, 0, 0.18, TRAY_DEPTH / 2);
  addWall(TRAY_WIDTH / 2, 0, 0.18, TRAY_DEPTH / 2);
  addWall(0, -TRAY_DEPTH / 2, TRAY_WIDTH / 2, 0.18);
  addWall(0, TRAY_DEPTH / 2, TRAY_WIDTH / 2, 0.18);

  const bodies = [0, 1].map((index) => {
    const body = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Box(new CANNON.Vec3(DIE_SIZE / 2, DIE_SIZE / 2, DIE_SIZE / 2)),
      linearDamping: 0.18,
      angularDamping: 0.3,
      sleepSpeedLimit: 0.12,
      sleepTimeLimit: 0.3,
    });
    body.position.set((index ? 1.45 : -1.6) + (random() - 0.5) * 0.6, 3 + index * 0.65, TRAY_DEPTH / 2 - 1.45 - index * 0.55);
    body.velocity.set((index ? -2.2 : 2.5) + random() - 0.5, -1.3 + random() * 0.8, -8.5 + (random() - 0.5) * 1.5);
    body.angularVelocity.set((random() - 0.5) * 30, (random() - 0.5) * 30, (random() - 0.5) * 30);
    body.quaternion.copy(randomQuaternion(random));
    world.addBody(body);
    return body;
  });
  return { world, bodies, steps: 0 };
}

export function stepDiceSimulation(simulation) {
  simulation.world.step(1 / 60);
  simulation.steps += 1;
  const quiet = simulation.bodies.every((body) => (
    body.velocity.lengthSquared() < 0.025 && body.angularVelocity.lengthSquared() < 0.025
  ));
  return simulation.steps >= MAX_STEPS || (simulation.steps >= MIN_STEPS && quiet);
}

export function readDiceResults(simulation) {
  const faces = [
    [3, new CANNON.Vec3(1, 0, 0)], [4, new CANNON.Vec3(-1, 0, 0)],
    [2, new CANNON.Vec3(0, 1, 0)], [5, new CANNON.Vec3(0, -1, 0)],
    [1, new CANNON.Vec3(0, 0, 1)], [6, new CANNON.Vec3(0, 0, -1)],
  ];
  return simulation.bodies.map((body) => faces.reduce((highest, face) => (
    body.quaternion.vmult(face[1]).y > body.quaternion.vmult(highest[1]).y ? face : highest
  ))[0]);
}

export function simulateDice(seed) {
  const simulation = createDiceSimulation(seed);
  while (!stepDiceSimulation(simulation));
  return readDiceResults(simulation);
}

export function replaySeedFor(dice) {
  const seed = REPLAY_SEEDS[dice.join("-")];
  if (!seed) throw new RangeError("A physical replay requires two die values from 1 through 6.");
  return seed;
}
