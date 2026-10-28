import * as CANNON from "../vendor/cannon-es.js";

export const DIE_FACE_VALUES = [3, 4, 2, 5, 1, 6];
export const TRAY_WIDTH = 8;
export const TRAY_DEPTH = 14;
export const DIE_SIZE = 1.45;
const MIN_STEPS = 40;
const MAX_STEPS = 200;
// Below these squared speeds a lying die no longer looks like it is moving.
const QUIET_SPEED = 0.06;
const QUIET_SPIN = 0.12;
const QUIET_HOLD_STEPS = 5;
const FLAT = 0.99;
const BRISK_STEPS = 130;
const THROW_ATTEMPTS = 8;
// Local face normals in the same order as DIE_FACE_VALUES (+x, -x, +y, -y, +z, -z).
const FACE_NORMALS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
].map(([x, y, z]) => new CANNON.Vec3(x, y, z));
const FRAME_SIZE = 14;

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

function topFaceIndex(quaternion) {
  let best = 0;
  let bestHeight = -Infinity;
  FACE_NORMALS.forEach((normal, index) => {
    const height = quaternion.vmult(normal).y;
    if (height > bestHeight) {
      best = index;
      bestHeight = height;
    }
  });
  return best;
}

function flatness(body) {
  return body.quaternion.vmult(FACE_NORMALS[topFaceIndex(body.quaternion)]).y;
}

export function createDiceSimulation(seed) {
  const random = seededRandom(seed);
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -26, 0) });
  world.allowSleep = true;
  world.defaultContactMaterial.friction = 0.45;
  world.defaultContactMaterial.restitution = 0.28;
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
      linearDamping: 0.35,
      angularDamping: 0.55,
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
  return { world, bodies, steps: 0, quietSteps: 0 };
}

export function stepDiceSimulation(simulation) {
  simulation.world.step(1 / 60);
  simulation.steps += 1;
  const quiet = simulation.bodies.every((body) => (
    body.velocity.lengthSquared() < QUIET_SPEED
    && body.angularVelocity.lengthSquared() < QUIET_SPIN
    && flatness(body) > FLAT
  ));
  simulation.quietSteps = quiet ? simulation.quietSteps + 1 : 0;
  return simulation.steps >= MAX_STEPS
    || (simulation.steps >= MIN_STEPS && simulation.quietSteps >= QUIET_HOLD_STEPS);
}

export function readDiceResults(simulation) {
  return simulation.bodies.map((body) => DIE_FACE_VALUES[topFaceIndex(body.quaternion)]);
}

export function simulateDice(seed) {
  const simulation = createDiceSimulation(seed);
  while (!stepDiceSimulation(simulation));
  return readDiceResults(simulation);
}

// The cube turn that shows `value` on the face the physics left pointing up.
function faceTurn(quaternion, value) {
  const wanted = FACE_NORMALS[DIE_FACE_VALUES.indexOf(value)];
  const up = FACE_NORMALS[topFaceIndex(quaternion)];
  return new CANNON.Quaternion().setFromVectors(wanted, up);
}

export function visibleDieValue(quaternion, turn) {
  return DIE_FACE_VALUES[topFaceIndex(quaternion.mult(turn))];
}

function recordThrow(seed) {
  const simulation = createDiceSimulation(seed);
  const frames = [];
  const record = () => {
    for (const { position, quaternion } of simulation.bodies) {
      frames.push(position.x, position.y, position.z, quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    }
  };
  record();
  let finished = false;
  while (!finished) {
    finished = stepDiceSimulation(simulation);
    record();
  }
  return {
    frames: Float32Array.from(frames),
    steps: simulation.steps,
    flat: simulation.bodies.every((body) => flatness(body) > FLAT),
    finalQuaternions: simulation.bodies.map(({ quaternion }) => quaternion.clone()),
  };
}

// Records a natural throw and the face turns that make it land on the dice the game already rolled.
export function planDiceThrow(dice, seed) {
  if (!Array.isArray(dice) || dice.length !== 2 || dice.some((value) => !DIE_FACE_VALUES.includes(value))) {
    throw new RangeError("A dice throw requires two die values from 1 through 6.");
  }
  const random = seededRandom(seed);
  let best = null;
  for (let attempt = 0; attempt < THROW_ATTEMPTS; attempt += 1) {
    const recorded = recordThrow(attempt ? Math.floor(random() * 0x100000000) : seed);
    const better = !best
      || (recorded.flat && !best.flat)
      || (recorded.flat === best.flat && recorded.steps < best.steps);
    if (better) best = recorded;
    if (best.flat && best.steps <= BRISK_STEPS) break;
  }
  return {
    frames: best.frames,
    frameSize: FRAME_SIZE,
    steps: best.steps,
    finalQuaternions: best.finalQuaternions,
    turns: best.finalQuaternions.map((quaternion, index) => faceTurn(quaternion, dice[index])),
  };
}
