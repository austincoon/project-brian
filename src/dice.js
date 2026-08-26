export function rollDie(randomValues = crypto.getRandomValues.bind(crypto)) {
  const bytes = new Uint8Array(1);
  // 252 is divisible by six; rejecting 252–255 prevents modulo bias.
  do randomValues(bytes); while (bytes[0] >= 252);
  return bytes[0] % 6 + 1;
}

export function rollDice() {
  return [rollDie(), rollDie()];
}

export function getTurnQueue(state) {
  const uids = state.opening?.candidateUids ?? state.players.map(({ uid }) => uid);
  const start = Math.max(0, uids.indexOf(state.turnUid));
  return [...uids.slice(start), ...uids.slice(0, start)].map((uid, index) => ({
    ...state.players.find((player) => player.uid === uid),
    status: state.opening?.rolls?.[uid]
      ? `Rolled ${state.opening.rolls[uid].total}`
      : index === 0 ? "Now" : index === 1 ? "Next" : "Waiting",
  }));
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
