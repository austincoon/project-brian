import {
  CENTER_SHORTCUT,
  PLAYER_ORDER,
  START_POSITIONS,
  TRACK_ORDER,
} from "./board.js";
import { randomIndex } from "./dice.js";
import { applyMove, getLegalMoves } from "./game.js";

const TRACK_LENGTH = TRACK_ORDER.length;
const HOME_START = TRACK_LENGTH - 1;
const startIndexes = Object.fromEntries(
  PLAYER_ORDER.map((color) => [color, TRACK_ORDER.indexOf(START_POSITIONS[color])]),
);

// Chance that one roll of two dice can cover exactly `distance` spaces with either die or their total.
const HIT_CHANCE = [0, 11, 12, 13, 14, 15, 16, 6, 5, 4, 3, 2, 1].map((count) => count / 36);
// A 1 or 6 releases a marble from Base or the Gambit; the other die may carry it farther.
const RELEASE_CHANCE = 20 / 36;
const RELEASE_THEN_CHANCE = [0, 3, 4, 4, 4, 4, 3].map((count) => count / 36);

const START_VALUE = 12;
// A Gambit marble can exit to the corner four spaces from its Home entrance with a 1 or 6.
const GAMBIT_VALUE = START_VALUE + 34;
const HOME_VALUE = 70;
const OPPONENT_WEIGHT = 0.55;
const RISK_WEIGHT = 0.85;
const BLOCKED_START_PENALTY = 5;

function trackAt(color, progress) {
  return TRACK_ORDER[(startIndexes[color] + progress) % TRACK_LENGTH];
}

function relativeProgress(color, trackId) {
  return (TRACK_ORDER.indexOf(trackId) - startIndexes[color] + TRACK_LENGTH) % TRACK_LENGTH;
}

function pieceValue(piece) {
  const position = piece.positionId;
  if (position.startsWith("base:")) return 0;
  // Deeper Home holes leave room for the marbles still travelling.
  if (position.startsWith("home:")) return HOME_VALUE + (piece.progress - HOME_START) * 2;
  if (position === CENTER_SHORTCUT.id) return GAMBIT_VALUE;
  return START_VALUE + piece.progress;
}

function addThreat(threats, positionId, chance) {
  threats.set(positionId, 1 - (1 - (threats.get(positionId) ?? 0)) * (1 - chance));
}

function addReleaseThreats(threats, color, entry, blocked) {
  if (blocked.has(entry)) return;
  addThreat(threats, entry, RELEASE_CHANCE);
  const entryProgress = relativeProgress(color, entry);
  for (let steps = 1; steps <= 6; steps += 1) {
    const progress = entryProgress + steps;
    if (progress >= HOME_START) break;
    const positionId = trackAt(color, progress);
    if (blocked.has(positionId)) break;
    addThreat(threats, positionId, RELEASE_THEN_CHANCE[steps]);
  }
}

// Approximate chance that each shared position is hit by an opponent of `uid` before uid moves again.
function opponentThreats(state, uid) {
  const threats = new Map();
  const ownPositions = new Map();
  for (const piece of Object.values(state.pieces)) {
    if (!ownPositions.has(piece.ownerUid)) ownPositions.set(piece.ownerUid, new Set());
    ownPositions.get(piece.ownerUid).add(piece.positionId);
  }

  for (const piece of Object.values(state.pieces)) {
    if (piece.ownerUid === uid || piece.positionId.startsWith("home:")) continue;
    const blocked = ownPositions.get(piece.ownerUid);

    if (piece.positionId.startsWith("base:")) {
      addReleaseThreats(threats, piece.color, START_POSITIONS[piece.color], blocked);
      continue;
    }

    if (piece.positionId === CENTER_SHORTCUT.id) {
      for (const { exit } of CENTER_SHORTCUT.access) addReleaseThreats(threats, piece.color, exit, blocked);
      continue;
    }

    for (let steps = 1; steps <= 12; steps += 1) {
      const progress = piece.progress + steps;
      if (progress >= HOME_START) break;
      const positionId = trackAt(piece.color, progress);
      if (blocked.has(positionId)) break;
      addThreat(threats, positionId, HIT_CHANCE[steps]);
    }

    if (blocked.has(CENTER_SHORTCUT.id)) continue;
    for (const { track } of CENTER_SHORTCUT.access) {
      const accessProgress = relativeProgress(piece.color, track);
      const steps = accessProgress - piece.progress + 1;
      if (accessProgress < piece.progress || accessProgress >= HOME_START || steps > 12) continue;
      let open = true;
      for (let progress = piece.progress + 1; progress <= accessProgress && open; progress += 1) {
        open = !blocked.has(trackAt(piece.color, progress));
      }
      if (open) addThreat(threats, CENTER_SHORTCUT.id, HIT_CHANCE[steps]);
    }
  }

  return threats;
}

export function evaluatePosition(state, uid) {
  const threats = opponentThreats(state, uid);
  const color = state.players.find((player) => player.uid === uid)?.color;
  let score = 0;
  let waitingInBase = false;
  let startBlocked = false;

  for (const piece of Object.values(state.pieces)) {
    const value = pieceValue(piece);
    if (piece.ownerUid !== uid) {
      score -= value * OPPONENT_WEIGHT;
      continue;
    }
    score += value - value * (threats.get(piece.positionId) ?? 0) * RISK_WEIGHT;
    if (piece.positionId.startsWith("base:")) waitingInBase = true;
    if (piece.positionId === START_POSITIONS[color]) startBlocked = true;
  }

  if (waitingInBase && startBlocked) score -= BLOCKED_START_PENALTY;
  return score;
}

// Marbles waiting in Base are interchangeable, so only one release per die needs to be considered.
function distinctMoves(moves) {
  const seen = new Set();
  return moves.filter((move) => {
    const key = move.kind === "leave-base" ? `base:${move.die}` : `${move.pieceId}>${move.destination}:${move.die}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function outcomeValue(state, uid, move) {
  const next = applyMove(state, uid, move.pieceId, move.destination, move.die);
  if (next.phase === "finished") return Infinity;
  if (next.phase !== "move" || next.turnUid !== uid) return evaluatePosition(next, uid);

  let best = -Infinity;
  for (const followUp of distinctMoves(getLegalMoves(next, uid))) {
    const final = applyMove(next, uid, followUp.pieceId, followUp.destination, followUp.die);
    best = Math.max(best, final.phase === "finished" ? Infinity : evaluatePosition(final, uid));
  }
  return best === -Infinity ? evaluatePosition(next, uid) : best;
}

export const BOT_SKILLS = Object.freeze(["easy", "normal", "hard"]);
// Share of decisions a computer player makes without looking ahead.
const CARELESSNESS = { easy: 0.85, normal: 0.45, hard: 0 };

export function normalizeBotSkill(value) {
  return BOT_SKILLS.includes(value) ? value : "normal";
}

// Picks the move whose best two-dice continuation leaves the strongest position.
export function chooseBotMove(state, uid, { skill = "hard", random = Math.random } = {}) {
  const moves = distinctMoves(getLegalMoves(state, uid));
  if (moves.length <= 1) return moves[0] ?? null;
  if (random() < CARELESSNESS[normalizeBotSkill(skill)]) return moves[randomIndex(moves.length)];

  let best = null;
  for (const move of moves) {
    // A small random nudge keeps equal choices from always resolving the same way.
    const value = outcomeValue(state, uid, move) + random() * 0.25;
    if (!best || value > best.value) best = { move, value };
  }
  return best.move;
}
