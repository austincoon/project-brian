import { HOLES_BY_ID, HOME_POSITIONS, START_POSITIONS, TRACK_ORDER } from "./board.js?v=20260923-1";
import { createGame, getLegalMoves } from "./game.js?v=20260826-23";

export const LOCAL_GAME_KEY = "project-brian-local-game";

export function readStored(storage, key, fallback = null) {
  try { return JSON.parse(storage?.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

export function writeStored(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

export function loadLocalGame(storage) {
  try {
    const state = readStored(storage, LOCAL_GAME_KEY);
    if (state?.version !== 1 || !["opening-roll", "roll", "move", "finished"].includes(state.phase)) return null;
    const template = createGame(state.players);
    const uids = template.players.map(({ uid }) => uid);
    if (state.hostUid !== template.hostUid || !uids.includes(state.turnUid)) return null;
    if (state.players.some((player, index) => player.color !== template.players[index].color)) return null;
    if (Object.keys(state.pieces).length !== uids.length * 5) return null;
    const occupied = new Set();
    for (const [id, expected] of Object.entries(template.pieces)) {
      const piece = state.pieces[id];
      const hole = HOLES_BY_ID[piece?.positionId];
      if (!hole || piece.id !== id || piece.ownerUid !== expected.ownerUid || piece.color !== expected.color
        || piece.number !== expected.number || occupied.has(hole.id)) return null;
      if (["base", "home"].includes(hole.kind) && hole.player !== piece.color) return null;
      if (hole.kind === "base" ? piece.progress !== null : !Number.isInteger(piece.progress) || piece.progress < 0 || piece.progress > 51) return null;
      if (hole.kind === "home" && HOME_POSITIONS[piece.color][piece.progress - 47] !== hole.id) return null;
      if (hole.kind === "track" && (piece.progress >= 47
        || TRACK_ORDER[(TRACK_ORDER.indexOf(START_POSITIONS[piece.color]) + piece.progress) % 48] !== hole.id)) return null;
      if (hole.kind === "center" && piece.progress >= 47) return null;
      occupied.add(hole.id);
    }
    const validDice = (dice) => Array.isArray(dice) && dice.length === 2 && dice.every((n) => Number.isInteger(n) && n >= 1 && n <= 6);
    if (state.phase === "move" && (!validDice(state.dice) || !Array.isArray(state.remainingDice)
      || !state.remainingDice.length || state.remainingDice.length > 2 || !getLegalMoves(state, state.turnUid).length)) return null;
    if (state.phase === "move") {
      const dice = [...state.dice];
      for (const die of state.remainingDice) {
        const index = dice.indexOf(die);
        if (index < 0) return null;
        dice.splice(index, 1);
      }
    }
    if (state.phase === "opening-roll" && (!Array.isArray(state.opening?.candidateUids)
      || !state.opening.candidateUids.includes(state.turnUid) || !Number.isInteger(state.opening.round)
      || state.opening.candidateUids.some((uid) => !uids.includes(uid)))) return null;
    for (const [uid, stats] of Object.entries(state.stats ?? {})) {
      if (!uids.includes(uid) || !stats || Object.values(stats).some((n) => !Number.isSafeInteger(n) || n < 0)) return null;
    }
    if (state.phase === "finished" && (!uids.includes(state.winnerUid)
      || Object.values(state.pieces).filter((p) => p.ownerUid === state.winnerUid).some((p) => !p.positionId.startsWith("home:")))) return null;
    if (state.lastAction?.dice && !validDice(state.lastAction.dice)) return null;
    return state;
  } catch { return null; }
}
