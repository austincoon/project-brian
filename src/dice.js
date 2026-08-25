export const CUBE_FACES = [
  ["front", 1], ["back", 6], ["right", 3],
  ["left", 4], ["top", 2], ["bottom", 5],
];

export function stepDicePhysics(bodies, bounds, seconds) {
  const maxX = bounds.width - bounds.size - bounds.padding;
  const maxY = bounds.height - bounds.size - bounds.padding;
  const bounce = 0.72;
  const drag = Math.pow(0.22, seconds);

  for (const body of bodies) {
    body.x += body.vx * seconds;
    body.y += body.vy * seconds;
    body.vx *= drag;
    body.vy *= drag;
    if (body.x < bounds.padding) { body.x = bounds.padding; body.vx = Math.abs(body.vx) * bounce; }
    if (body.x > maxX) { body.x = maxX; body.vx = -Math.abs(body.vx) * bounce; }
    if (body.y < bounds.padding) { body.y = bounds.padding; body.vy = Math.abs(body.vy) * bounce; }
    if (body.y > maxY) { body.y = maxY; body.vy = -Math.abs(body.vy) * bounce; }
  }

  const [first, second] = bodies;
  if (!second) return bodies;
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const distance = Math.hypot(dx, dy) || 1;
  const minimum = bounds.size * 0.88;
  if (distance >= minimum) return bodies;
  const nx = dx / distance;
  const ny = dy / distance;
  const overlap = (minimum - distance) / 2;
  first.x -= nx * overlap;
  first.y -= ny * overlap;
  second.x += nx * overlap;
  second.y += ny * overlap;
  const firstSpeed = first.vx * nx + first.vy * ny;
  const secondSpeed = second.vx * nx + second.vy * ny;
  if (firstSpeed > secondSpeed) {
    first.vx += (secondSpeed - firstSpeed) * nx;
    first.vy += (secondSpeed - firstSpeed) * ny;
    second.vx += (firstSpeed - secondSpeed) * nx;
    second.vy += (firstSpeed - secondSpeed) * ny;
  }
  return bodies;
}

export function rollDie(randomValues = crypto.getRandomValues.bind(crypto)) {
  const bytes = new Uint8Array(1);
  // 252 is divisible by six; rejecting 252–255 prevents modulo bias.
  do randomValues(bytes); while (bytes[0] >= 252);
  return bytes[0] % 6 + 1;
}

export function rollDice() {
  return [rollDie(), rollDie()];
}

export function randomIndex(length, randomValues = crypto.getRandomValues.bind(crypto)) {
  if (!Number.isInteger(length) || length < 1 || length > 256) {
    throw new RangeError("Choice length must be an integer from 1 through 256.");
  }
  const bytes = new Uint8Array(1);
  const limit = Math.floor(256 / length) * length;
  do randomValues(bytes); while (bytes[0] >= limit);
  return bytes[0] % length;
}

export function getDicePresentation(state, viewerUid = null) {
  const liveRoll = state?.phase === "move" && Array.isArray(state.dice);
  const dice = liveRoll
    ? state.dice
    : Array.isArray(state?.lastAction?.dice) ? state.lastAction.dice : null;
  const uid = liveRoll ? state.turnUid : dice ? state.lastAction.uid : state?.turnUid;
  const player = state?.players?.find((candidate) => candidate.uid === uid);
  const owner = uid === viewerUid ? "Your" : `${player?.name ?? "Player"}'s`;
  const context = state?.lastAction?.type === "opening-roll"
    ? "opening roll"
    : liveRoll ? "roll" : dice ? "last roll" : "next roll";

  return { dice, uid, color: player?.color ?? null, label: `${owner} ${context}` };
}

export function getPlayerDiceRows(state, rememberedDice = {}) {
  const diceByUid = Object.fromEntries(
    (state?.players ?? []).flatMap(({ uid }) => Array.isArray(rememberedDice[uid])
      ? [[uid, [...rememberedDice[uid]]]]
      : []),
  );

  for (const [uid, roll] of Object.entries(state?.opening?.rolls ?? {})) {
    if (Array.isArray(roll?.dice)) diceByUid[uid] = [...roll.dice];
  }
  if (state?.lastAction?.uid && Array.isArray(state.lastAction.dice)) {
    diceByUid[state.lastAction.uid] = [...state.lastAction.dice];
  }
  if (state?.phase === "move" && state.turnUid && Array.isArray(state.dice)) {
    diceByUid[state.turnUid] = [...state.dice];
  }

  return (state?.players ?? []).map((player) => ({
    ...player,
    dice: diceByUid[player.uid] ?? null,
    isActive: player.uid === state.turnUid,
    isLastRoller: player.uid === state.lastAction?.uid && Array.isArray(state.lastAction?.dice),
  }));
}
