import {
  BASE_POSITIONS,
  CENTER_SHORTCUT,
  HOME_POSITIONS,
  PLAYER_ORDER,
  PLAYERS,
  START_POSITIONS,
  TRACK_ORDER,
} from "./board.js?v=20260823-19";

const TRACK_LENGTH = TRACK_ORDER.length;
const HOME_START = TRACK_LENGTH - 1;
const HOME_END = HOME_START + 4;
const startIndexes = Object.fromEntries(
  PLAYER_ORDER.map((color) => [color, TRACK_ORDER.indexOf(START_POSITIONS[color])]),
);

function copy(state) {
  return structuredClone(state);
}

function requirePhase(state, phase) {
  if (state.phase !== phase) {
    throw new Error(`Expected ${phase} phase, received ${state.phase}.`);
  }
}

function requirePlayer(state, uid) {
  const player = state.players.find((candidate) => candidate.uid === uid);
  if (!player) throw new Error(`Unknown player: ${uid}.`);
  return player;
}

function requireTurn(state, uid) {
  requirePlayer(state, uid);
  if (state.turnUid !== uid) throw new Error("It is not this player's turn.");
}

function readDice(dice) {
  if (!Array.isArray(dice)
    || dice.length !== 2
    || dice.some((value) => !Number.isInteger(value) || value < 1 || value > 6)) {
    throw new TypeError("Dice must be an array containing two integers from 1 through 6.");
  }

  return {
    values: [...dice],
    total: dice[0] + dice[1],
    doubles: dice[0] === dice[1],
  };
}

function piecesFor(state, uid) {
  return Object.values(state.pieces).filter((piece) => piece.ownerUid === uid);
}

function nextPlayerUid(state, uid) {
  const index = state.players.findIndex((player) => player.uid === uid);
  return state.players[(index - 1 + state.players.length) % state.players.length].uid;
}

function counterClockwiseUids(players) {
  return [players[0], ...players.slice(1).reverse()].map(({ uid }) => uid);
}

function relativeTrackIndex(color, trackId) {
  const trackIndex = TRACK_ORDER.indexOf(trackId);
  return (trackIndex - startIndexes[color] + TRACK_LENGTH) % TRACK_LENGTH;
}

function positionAtProgress(color, progress) {
  if (progress < HOME_START) {
    return TRACK_ORDER[(startIndexes[color] + progress) % TRACK_LENGTH];
  }
  return HOME_POSITIONS[color][progress - HOME_START];
}

function forwardPath(color, progress, steps) {
  const finalProgress = progress + steps;
  if (finalProgress > HOME_END) return null;

  const path = [];
  for (let next = progress + 1; next <= finalProgress; next += 1) {
    path.push(positionAtProgress(color, next));
  }

  return {
    destination: path.at(-1),
    path,
    progress: finalProgress,
  };
}

function ownPositions(state, uid, movingPieceId) {
  return new Set(piecesFor(state, uid)
    .filter(({ id }) => id !== movingPieceId)
    .map(({ positionId }) => positionId));
}

function captureAt(state, uid, destination) {
  if (destination.startsWith("base:") || destination.startsWith("home:")) return null;
  return Object.values(state.pieces).find((piece) => (
    piece.ownerUid !== uid && piece.positionId === destination
  ))?.id ?? null;
}

function makeMove(state, piece, destination, path, progress, kind, die) {
  return {
    pieceId: piece.id,
    destination,
    path,
    progress,
    kind,
    die,
    captureId: captureAt(state, piece.ownerUid, destination),
  };
}

function normalMove(state, piece, steps, occupied) {
  const move = forwardPath(piece.color, piece.progress, steps);
  if (!move || move.path.some((id) => occupied.has(id))) return null;

  const enteredHome = piece.progress < HOME_START && move.progress >= HOME_START;
  return makeMove(
    state,
    piece,
    move.destination,
    move.path,
    move.progress,
    enteredHome ? "enter-home" : move.progress >= HOME_START ? "home" : "track",
    steps,
  );
}

function gambitEntryMoves(state, piece, steps, occupied) {
  const moves = [];

  for (const access of CENTER_SHORTCUT.access) {
    let accessProgress = relativeTrackIndex(piece.color, access.track);
    if (accessProgress < piece.progress) accessProgress += TRACK_LENGTH;
    if (accessProgress >= HOME_START) continue;

    const distance = accessProgress - piece.progress + 1;
    if (distance !== steps) continue;

    const trackPath = forwardPath(piece.color, piece.progress, accessProgress - piece.progress)?.path ?? [];
    const path = [...trackPath, CENTER_SHORTCUT.id];
    if (path.some((id) => occupied.has(id))) continue;

    moves.push(makeMove(
      state,
      piece,
      CENTER_SHORTCUT.id,
      path,
      accessProgress,
      "enter-gambit",
      steps,
    ));
  }

  return moves;
}

function gambitExitMoves(state, piece, steps, occupied) {
  if (steps !== 1 && steps !== 6) return [];
  const moves = [];

  for (const access of CENTER_SHORTCUT.access) {
    const exitProgress = relativeTrackIndex(piece.color, access.exit);
    const path = [access.exit];
    if (path.some((id) => occupied.has(id))) continue;

    moves.push(makeMove(
      state,
      piece,
      access.exit,
      path,
      exitProgress,
      "exit-gambit",
      steps,
    ));
  }

  return moves;
}

function resolveOpeningRound(state) {
  state.opening.rolls ??= {};
  const pending = state.opening.candidateUids.filter((uid) => (
    !Object.hasOwn(state.opening.rolls, uid)
  ));
  if (pending.length) {
    state.turnUid = pending[0];
    return state;
  }

  const completed = state.opening.candidateUids.filter((uid) => state.opening.rolls[uid]);
  if (!completed.length) {
    state.opening = {
      round: state.opening.round + 1,
      candidateUids: counterClockwiseUids(state.players),
      rolls: {},
    };
    state.turnUid = state.opening.candidateUids[0];
    return state;
  }

  const highTotal = Math.max(...completed.map((uid) => state.opening.rolls[uid].total));
  const tied = completed.filter((uid) => state.opening.rolls[uid].total === highTotal);

  if (tied.length > 1) {
    state.opening = {
      round: state.opening.round + 1,
      candidateUids: tied,
      rolls: {},
    };
    state.turnUid = tied[0];
    return state;
  }

  state.phase = "roll";
  state.opening = null;
  state.turnUid = tied[0];
  state.dice = null;
  return state;
}

function finishTurn(state, extraTurn) {
  state.phase = "roll";
  state.dice = null;
  state.remainingDice = null;
  if (!extraTurn) state.turnUid = nextPlayerUid(state, state.turnUid);
  return state;
}

function availableBase(state, capturedPiece) {
  const occupied = new Set(piecesFor(state, capturedPiece.ownerUid)
    .filter(({ id }) => id !== capturedPiece.id)
    .map(({ positionId }) => positionId));
  const position = BASE_POSITIONS[capturedPiece.color].find((id) => !occupied.has(id));
  if (!position) throw new Error("Captured marble has no available Base position.");
  return position;
}

export function createGame(players) {
  if (!Array.isArray(players) || players.length < 2 || players.length > 4) {
    throw new TypeError("A game requires two to four players.");
  }

  const seen = new Set();
  const normalizedPlayers = players.map((player, index) => {
    if (!player || typeof player.uid !== "string" || !player.uid.trim()) {
      throw new TypeError("Every player requires a non-empty uid.");
    }
    if (seen.has(player.uid)) throw new TypeError("Player uids must be unique.");
    seen.add(player.uid);

    if (typeof player.name !== "string" || !player.name.trim() || player.name.trim().length > 24) {
      throw new TypeError("Every player name must contain 1 through 24 characters.");
    }

    const color = PLAYER_ORDER[index];
    return {
      uid: player.uid,
      name: player.name.trim(),
      color,
      seat: index,
      orientation: PLAYERS[color].seat,
    };
  });

  const pieces = {};
  for (const player of normalizedPlayers) {
    BASE_POSITIONS[player.color].forEach((positionId, index) => {
      const id = `${player.uid}:${index}`;
      pieces[id] = {
        id,
        ownerUid: player.uid,
        color: player.color,
        number: index + 1,
        positionId,
        progress: null,
      };
    });
  }

  return {
    version: 1,
    phase: "waiting",
    hostUid: normalizedPlayers[0].uid,
    players: normalizedPlayers,
    pieces,
    opening: null,
    turnUid: null,
    dice: null,
    remainingDice: null,
    winnerUid: null,
    lastAction: { type: "created" },
  };
}

export function startGame(state, hostUid) {
  requirePhase(state, "waiting");
  if (state.hostUid !== hostUid) throw new Error("Only the host can start the game.");

  const next = copy(state);
  next.phase = "opening-roll";
  next.opening = {
    round: 1,
    candidateUids: counterClockwiseUids(next.players),
    rolls: {},
  };
  next.turnUid = next.opening.candidateUids[0];
  next.lastAction = { type: "started", uid: hostUid };
  return next;
}

export function applyOpeningRoll(state, uid, dice) {
  requirePhase(state, "opening-roll");
  requirePlayer(state, uid);
  if (!state.opening.candidateUids.includes(uid)) {
    throw new Error("This player is not part of the current opening roll.");
  }
  if (Object.hasOwn(state.opening.rolls ?? {}, uid)) {
    throw new Error("This player already rolled in the current opening round.");
  }

  const roll = readDice(dice);
  const next = copy(state);
  next.opening.rolls ??= {};
  next.opening.rolls[uid] = { dice: roll.values, total: roll.total };
  next.lastAction = { type: "opening-roll", uid, dice: roll.values, total: roll.total };
  return resolveOpeningRound(next);
}

export function getLegalMoves(state, uid) {
  if (state.phase !== "move" || state.turnUid !== uid || !state.dice || !state.remainingDice?.length) return [];
  const player = requirePlayer(state, uid);
  const moves = [];

  for (const die of new Set(state.remainingDice)) {
    for (const piece of piecesFor(state, uid)) {
      const occupied = ownPositions(state, uid, piece.id);

      if (piece.positionId.startsWith("base:")) {
        if ((die === 1 || die === 6) && !occupied.has(START_POSITIONS[player.color])) {
          moves.push(makeMove(
            state,
            piece,
            START_POSITIONS[player.color],
            [START_POSITIONS[player.color]],
            0,
            "leave-base",
            die,
          ));
        }
        continue;
      }

      if (piece.positionId === CENTER_SHORTCUT.id) {
        moves.push(...gambitExitMoves(state, piece, die, occupied));
        continue;
      }

      const move = normalMove(state, piece, die, occupied);
      if (move) moves.push(move);

      if (piece.positionId.startsWith("track:")) {
        moves.push(...gambitEntryMoves(state, piece, die, occupied));
      }
    }
  }

  return moves;
}

export function applyRoll(state, uid, dice) {
  requirePhase(state, "roll");
  requireTurn(state, uid);
  const roll = readDice(dice);
  const next = copy(state);
  next.phase = "move";
  next.dice = roll.values;
  next.remainingDice = [...roll.values];
  next.lastAction = { type: "roll", uid, dice: roll.values, total: roll.total };

  if (!getLegalMoves(next, uid).length) {
    finishTurn(next, roll.doubles);
    next.lastAction = {
      type: "no-move",
      uid,
      dice: roll.values,
      total: roll.total,
      extraTurn: roll.doubles,
    };
  }

  return next;
}

export function applyMove(state, uid, pieceId, destination, die = null) {
  requirePhase(state, "move");
  requireTurn(state, uid);
  const move = getLegalMoves(state, uid).find((candidate) => (
    candidate.pieceId === pieceId
    && candidate.destination === destination
    && (die === null || candidate.die === die)
  ));
  if (!move) throw new Error("The requested move is not legal.");

  const roll = readDice(state.dice);
  const next = copy(state);
  const piece = next.pieces[pieceId];
  piece.positionId = move.destination;
  piece.progress = move.progress;

  if (move.captureId) {
    const captured = next.pieces[move.captureId];
    captured.positionId = availableBase(next, captured);
    captured.progress = null;
  }

  next.lastAction = {
    type: "move",
    uid,
    pieceId,
    destination,
    kind: move.kind,
    captureId: move.captureId,
    dice: [...state.dice],
    die: move.die,
  };

  next.remainingDice.splice(next.remainingDice.indexOf(move.die), 1);

  if (piecesFor(next, uid).every(({ positionId }) => positionId.startsWith("home:"))) {
    next.phase = "finished";
    next.winnerUid = uid;
    next.dice = null;
    next.remainingDice = null;
    return next;
  }

  if (next.remainingDice.length && getLegalMoves(next, uid).length) return next;
  return finishTurn(next, roll.doubles);
}

export function endGame(state, hostUid) {
  if (state.hostUid !== hostUid) throw new Error("Only the host can end the game.");
  if (!["opening-roll", "roll", "move"].includes(state.phase)) {
    throw new Error(`The game cannot be ended during the ${state.phase} phase.`);
  }

  const next = copy(state);
  next.phase = "ended";
  next.opening = null;
  next.dice = null;
  next.remainingDice = null;
  next.winnerUid = null;
  next.lastAction = { type: "ended", uid: hostUid };
  return next;
}

export function skipTurn(state, hostUid) {
  if (state.hostUid !== hostUid) throw new Error("Only the host can skip a turn.");
  if (["waiting", "finished", "ended"].includes(state.phase)) {
    throw new Error(`A turn cannot be skipped during the ${state.phase} phase.`);
  }
  if (!state.turnUid) throw new Error("There is no current player to skip.");
  if (state.turnUid === hostUid) throw new Error("The host cannot skip their own turn.");

  const next = copy(state);
  const skippedUid = next.turnUid;

  if (next.phase === "opening-roll") {
    next.opening.rolls[skippedUid] = null;
    next.lastAction = { type: "opening-skip", hostUid, skippedUid };
    return resolveOpeningRound(next);
  }

  next.turnUid = nextPlayerUid(next, skippedUid);
  next.phase = "roll";
  next.dice = null;
  next.remainingDice = null;
  next.lastAction = { type: "skip", hostUid, skippedUid };
  return next;
}
