export function rollDie(randomValues = crypto.getRandomValues.bind(crypto)) {
  const bytes = new Uint8Array(1);
  // 252 is divisible by six; rejecting 252–255 prevents modulo bias.
  do randomValues(bytes); while (bytes[0] >= 252);
  return bytes[0] % 6 + 1;
}

export function rollDice() {
  return [rollDie(), rollDie()];
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
