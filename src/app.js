import { PLAYERS, renderBoard } from "./board.js?v=20260823-19";
import { rollDice } from "./dice.js?v=20260823-9";
import { loadTurnReplay, saveTurnReplay } from "./replay.js?v=20260823-19";
import {
  applyMove,
  applyOpeningRoll,
  applyRoll,
  createGame,
  endGame,
  getLegalMoves,
  skipTurn,
  startGame,
} from "./game.js?v=20260823-20";
import {
  createRoom,
  joinRoom,
  leaveRoom,
  signIn,
  subscribeToRoom,
  updateRoomTransaction,
} from "./firebase.js?v=20260823-14";

const screens = [...document.querySelectorAll("[data-screen]")];
const createRoomForm = document.querySelector("#create-room-form");
const joinRoomForm = document.querySelector("#join-room-form");
const homeError = document.querySelector("#home-error");
const roomCodeInput = document.querySelector("#room-code");
const localModeButton = document.querySelector("#local-mode-button");
const setupForm = document.querySelector("#local-game-form");
const playerInputs = [...setupForm.querySelectorAll("[name='playerName']")];
const lobbyCode = document.querySelector("#lobby-code");
const inviteLink = document.querySelector("#invite-link");
const copyInviteButton = document.querySelector("#copy-invite-button");
const playerList = document.querySelector("#player-list");
const lobbyStatus = document.querySelector("#lobby-status");
const startButton = document.querySelector("#start-game-button");
const leaveButton = document.querySelector("#leave-room-button");
const phaseLabel = document.querySelector("#phase-label");
const gameTitle = document.querySelector("#game-title");
const newGameButton = document.querySelector("#new-game-button");
const board = document.querySelector("#board");
const diceDisplay = document.querySelector(".dice");
const dieOne = document.querySelector("#die-1");
const dieTwo = document.querySelector("#die-2");
const dieDisplays = [dieOne, dieTwo];
const rollButton = document.querySelector("#roll-button");
const replayMoveButton = document.querySelector("#replay-move-button");
const skipButton = document.querySelector("#skip-turn-button");
const endGameButton = document.querySelector("#end-game-button");
const turnStatus = document.querySelector("#turn-status");

let firebaseUser = null;
let onlineRoom = null;
let onlineRoomCode = null;
let unsubscribeRoom = null;
let onlineBusy = false;
let gameMode = null;
let gameState = null;
let selectedMarbleId = null;
let statusMessage = "";
let actionLocked = false;
let replayInProgress = false;
let pendingMoveReplay = null;
let lastTurnReplay = [];

function showScreen(name) {
  for (const screen of screens) screen.hidden = screen.dataset.screen !== name;
}

function setOnlineBusy(busy) {
  onlineBusy = busy;
  for (const button of [
    createRoomForm.querySelector("button[type='submit']"),
    joinRoomForm.querySelector("button[type='submit']"),
  ]) button.disabled = busy || !firebaseUser;
}

function roomUrl(code) {
  const url = new URL(location.href);
  url.search = `?room=${code}`;
  return url.href;
}

function setRoomUrl(code) {
  const url = new URL(location.href);
  url.search = code ? `?room=${code}` : "";
  history.replaceState(null, "", url);
}

function sortedPlayers(room) {
  return Object.values(room.players ?? {}).sort((first, second) => first.seat - second.seat);
}

function gamePlayers(room) {
  const order = room.turnOrder ?? sortedPlayers(room).map(({ uid }) => uid);
  return order.map((uid) => ({ uid, name: room.players[uid].name }));
}

function freshGame(room, hostUid) {
  return startGame(createGame(gamePlayers(room)), hostUid);
}

function renderOnlineLobby() {
  if (!onlineRoom || !firebaseUser || onlineRoom.status !== "waiting") return;
  const players = sortedPlayers(onlineRoom);
  const isHost = onlineRoom.hostUid === firebaseUser.uid;

  lobbyCode.textContent = onlineRoomCode;
  inviteLink.value = roomUrl(onlineRoomCode);
  playerList.replaceChildren(...players.map((player) => {
    const row = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "player-swatch";
    swatch.style.setProperty("--player-color", PLAYERS[player.color].color);
    swatch.setAttribute("aria-hidden", "true");
    row.append(swatch, document.createTextNode(player.name));
    if (player.uid === onlineRoom.hostUid) row.append(document.createTextNode(" (host)"));
    return row;
  }));

  lobbyStatus.textContent = players.length < 2
    ? "Waiting for at least one more player."
    : `${players.length} players are ready.`;
  startButton.hidden = !isHost;
  startButton.disabled = onlineBusy || players.length < 2 || players.length > 4;
  leaveButton.disabled = onlineBusy;
}

function forgetOnlineRoom() {
  unsubscribeRoom?.();
  unsubscribeRoom = null;
  onlineRoom = null;
  onlineRoomCode = null;
  if (gameMode === "online") {
    gameMode = null;
    gameState = null;
  }
  pendingMoveReplay = null;
  lastTurnReplay = [];
  setRoomUrl(null);
}

function playerName(uid) {
  return gameState?.players.find((player) => player.uid === uid)?.name ?? "Unknown player";
}

function formatRoll(dice) {
  return `${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}`;
}

function describeLastAction() {
  const action = gameState?.lastAction;
  if (!action) return "Waiting for the game state.";
  const name = action.uid ? playerName(action.uid) : "The host";

  switch (action.type) {
    case "started":
      return `${playerName(gameState.turnUid)} rolls first for the opening high score.`;
    case "opening-roll":
      return `${name} rolled ${formatRoll(action.dice)} for the opening high score.`;
    case "roll":
      return `${name} rolled ${formatRoll(action.dice)}. Select a highlighted marble.`;
    case "no-move":
      return `${name} rolled ${formatRoll(action.dice)} with no legal move.${action.extraTurn ? " Doubles grant another roll." : " The turn advanced."}`;
    case "move": {
      const capture = action.captureId
        ? ` ${playerName(gameState.pieces[action.captureId].ownerUid)}'s marble returned to Base.`
        : "";
      const remaining = gameState.remainingDice?.length
        ? ` Die ${gameState.remainingDice.join(" and ")} remains.`
        : "";
      return `${name} used ${action.die} and moved to ${action.destination}.${capture}${remaining}`;
    }
    case "opening-skip":
    case "skip":
      return `${playerName(action.skippedUid)}'s turn was skipped by the host.`;
    case "ended":
      return `${name} ended the game.`;
    default:
      return "The game state was updated.";
  }
}

async function watchRoom(code) {
  unsubscribeRoom?.();
  onlineRoomCode = code;
  unsubscribeRoom = await subscribeToRoom(code, (room) => {
    if (!room) {
      const wasActive = Boolean(onlineRoom);
      forgetOnlineRoom();
      homeError.textContent = wasActive
        ? "This room was deleted. Create or join another room."
        : "That room code does not exist.";
      showScreen("home");
      return;
    }
    if (!room.players?.[firebaseUser.uid]) {
      onlineRoom = null;
      homeError.textContent = room.status === "waiting"
        ? "Enter your name to join this room."
        : "That game has already started.";
      showScreen("home");
      return;
    }

    onlineRoom = room;
    setRoomUrl(code);
    homeError.textContent = "";
    if (room.status === "playing" && room.game) {
      const previousGame = gameMode === "online" ? gameState : null;
      const action = room.game.lastAction;
      const gameId = room.restartedAt ?? room.startedAt;
      if (!previousGame) lastTurnReplay = loadTurnReplay(localStorage, code, gameId);
      if (action?.type === "started") lastTurnReplay = [];
      const previousPiece = previousGame?.pieces?.[action?.pieceId];
      const movedPiece = room.game.pieces?.[action?.pieceId];
      const replay = action?.type === "move"
        && action.uid !== firebaseUser.uid
        && previousPiece
        && movedPiece
        && previousPiece.positionId !== movedPiece.positionId
        ? {
            pieceId: action.pieceId,
            fromPositionId: previousPiece.positionId,
            destinationId: movedPiece.positionId,
          }
        : null;
      pendingMoveReplay = replay;
      if (replay) {
        const continuesRoll = previousGame.lastAction?.type === "move"
          && previousGame.lastAction.uid === action.uid;
        lastTurnReplay = continuesRoll ? [...lastTurnReplay, replay] : [replay];
      }
      saveTurnReplay(localStorage, code, gameId, lastTurnReplay);
      gameMode = "online";
      gameState = room.game;
      selectedMarbleId = null;
      statusMessage = describeLastAction();
      showScreen("game");
      renderGame();
    } else {
      gameMode = null;
      gameState = null;
      pendingMoveReplay = null;
      lastTurnReplay = [];
      renderOnlineLobby();
      showScreen("lobby");
    }
  }, () => {
    statusMessage = "Connection lost. Check your network and retry the action.";
    if (gameState) renderGame();
    else {
      homeError.textContent = statusMessage;
      showScreen("home");
    }
  });
}

async function runOnlineAction(action, errorTarget = homeError) {
  if (onlineBusy) return;
  setOnlineBusy(true);
  errorTarget.textContent = "";
  let failure = null;
  try {
    await action();
  } catch (error) {
    failure = `Could not save that action. ${error.message} Please retry.`;
  } finally {
    setOnlineBusy(false);
    renderOnlineLobby();
    if (failure) errorTarget.textContent = failure;
  }
}

createRoomForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!createRoomForm.reportValidity()) return;
  runOnlineAction(async () => {
    const result = await createRoom(new FormData(createRoomForm).get("playerName"));
    onlineRoom = result.room;
    onlineRoomCode = result.code;
    renderOnlineLobby();
    showScreen("lobby");
    await watchRoom(result.code);
  });
});

joinRoomForm.addEventListener("submit", (event) => {
  event.preventDefault();
  roomCodeInput.value = roomCodeInput.value.trim().toUpperCase();
  if (!joinRoomForm.reportValidity()) return;
  runOnlineAction(async () => {
    const result = await joinRoom(roomCodeInput.value, new FormData(joinRoomForm).get("playerName"));
    onlineRoom = result.room;
    onlineRoomCode = result.code;
    renderOnlineLobby();
    showScreen("lobby");
    await watchRoom(result.code);
  });
});

copyInviteButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(inviteLink.value);
    lobbyStatus.textContent = "Invite link copied.";
  } catch {
    inviteLink.select();
    lobbyStatus.textContent = "Copy the selected invite link.";
  }
});

startButton.addEventListener("click", () => runOnlineAction(async () => {
  await updateRoomTransaction(onlineRoomCode, (room, uid) => {
    if (!room || room.status !== "waiting") throw new Error("This room is no longer waiting.");
    if (room.hostUid !== uid) throw new Error("Only the host can start the game.");
    const players = sortedPlayers(room);
    if (players.length < 2 || players.length > 4) throw new Error("A game requires two to four players.");
    const turnOrder = players.map(({ uid: playerUid }) => playerUid);
    const readyRoom = { ...room, turnOrder };
    return {
      ...readyRoom,
      status: "playing",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      game: freshGame(readyRoom, uid),
    };
  });
}, lobbyStatus));

leaveButton.addEventListener("click", () => runOnlineAction(async () => {
  if (!confirm(onlineRoom.hostUid === firebaseUser.uid
    ? "Leave and close this room for everyone?"
    : "Leave this room?")) return;
  await leaveRoom(onlineRoomCode);
  forgetOnlineRoom();
  showScreen("home");
}, lobbyStatus));

localModeButton.addEventListener("click", () => showScreen("local"));
for (const button of document.querySelectorAll("[data-home]")) {
  button.addEventListener("click", () => showScreen("home"));
}

function currentPlayer() {
  return gameState?.players.find(({ uid }) => uid === gameState.turnUid) ?? null;
}

const PIP_POSITIONS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function drawDie(button, value) {
  if (!PIP_POSITIONS[value]) {
    button.classList.add("is-empty");
    button.replaceChildren(document.createTextNode("–"));
    return;
  }

  button.classList.remove("is-empty");
  const filled = new Set(PIP_POSITIONS[value]);
  button.replaceChildren(...Array.from({ length: 9 }, (_, index) => {
    const pip = document.createElement("span");
    pip.className = `die-pip${filled.has(index) ? " is-filled" : ""}`;
    pip.setAttribute("aria-hidden", "true");
    return pip;
  }));
}

function renderDice() {
  const dice = gameState?.dice ?? gameState?.lastAction?.dice;
  drawDie(dieOne, dice?.[0]);
  drawDie(dieTwo, dice?.[1]);
  diceDisplay.setAttribute(
    "aria-label",
    dice ? `Dice show ${dice[0]} and ${dice[1]}` : "Dice have not been rolled",
  );

  const counts = new Map();
  for (const die of gameState?.remainingDice ?? []) counts.set(die, (counts.get(die) ?? 0) + 1);
  const available = (dice ?? []).map((die) => {
    const count = counts.get(die) ?? 0;
    if (!count) return false;
    counts.set(die, count - 1);
    return true;
  });
  dieDisplays.forEach((display, index) => {
    const isUsed = gameState?.phase === "move" && !available[index];
    display.classList.toggle("is-used", isUsed);
    display.setAttribute("aria-label", dice?.[index]
      ? `${index ? "Second" : "First"} die: ${dice[index]}${gameState?.phase === "move" ? available[index] ? " available" : " used" : ""}`
      : `${index ? "Second" : "First"} die has not been rolled`);
  });
}

function canControlTurn() {
  return gameMode === "local" || firebaseUser?.uid === gameState?.turnUid;
}

function renderGame() {
  if (!gameState) return;
  const player = currentPlayer();
  const canAct = canControlTurn();
  const allLegalMoves = gameState.phase === "move" ? getLegalMoves(gameState, gameState.turnUid) : [];
  renderDice();
  const legalMoves = allLegalMoves;
  const movableMarbles = [...new Set(legalMoves.map(({ pieceId }) => pieceId))];

  if (selectedMarbleId && (!canAct || !movableMarbles.includes(selectedMarbleId))) selectedMarbleId = null;
  const destinations = selectedMarbleId
    ? legalMoves.filter(({ pieceId }) => pieceId === selectedMarbleId).map(({ destination }) => destination)
    : [];

  phaseLabel.textContent = gameState.phase === "opening-roll"
    ? `Opening roll ${gameState.opening.round}`
    : gameState.phase === "finished" ? "Winner"
    : gameState.phase === "ended" ? "Game ended" : "Current turn";
  gameTitle.textContent = gameState.phase === "finished"
    ? `${playerName(gameState.winnerUid)} wins!`
    : gameState.phase === "ended" ? "Game ended"
    : `${player.name}'s turn`;
  const titlePlayer = gameState.players.find(({ uid }) => uid === (gameState.winnerUid ?? player.uid));
  gameTitle.style.setProperty("--active-color", PLAYERS[titlePlayer.color].darkColor);

  rollButton.textContent = gameState.phase === "opening-roll" ? "Opening roll" : "Roll dice";
  rollButton.disabled = actionLocked || replayInProgress || !canAct || !["opening-roll", "roll"].includes(gameState.phase);
  replayMoveButton.hidden = !lastTurnReplay.length;
  replayMoveButton.textContent = gameMode === "online" ? "Replay opponent move" : "Replay last move";
  replayMoveButton.disabled = actionLocked || replayInProgress;
  const hostUid = gameMode === "online" ? onlineRoom.hostUid : gameState.hostUid;
  const isHost = gameMode === "online" ? firebaseUser.uid === hostUid : true;
  skipButton.hidden = ["finished", "ended"].includes(gameState.phase) || !isHost || !player || player.uid === hostUid;
  skipButton.disabled = actionLocked || replayInProgress;
  endGameButton.hidden = !isHost || !["opening-roll", "roll", "move"].includes(gameState.phase);
  endGameButton.disabled = actionLocked || replayInProgress;
  newGameButton.hidden = gameMode === "online" && (firebaseUser.uid !== hostUid || !["finished", "ended"].includes(gameState.phase));
  newGameButton.textContent = gameMode === "online" ? "Restart game" : "New game";
  newGameButton.disabled = actionLocked || replayInProgress;
  turnStatus.textContent = replayInProgress
    ? "Replaying the last turn..."
    : actionLocked && gameMode === "online"
    ? "Saving action..."
    : statusMessage;
  const showError = /^(Action not saved|Connection lost)/.test(statusMessage);
  turnStatus.classList.toggle("sr-only", !showError);
  turnStatus.classList.toggle("game-error", showError);

  const selectableMarbles = actionLocked || replayInProgress || !canAct ? [] : movableMarbles;
  const replayMove = pendingMoveReplay;
  pendingMoveReplay = null;
  renderBoard(board, {
    marbles: Object.values(gameState.pieces),
    activePlayer: player?.color ?? null,
    playerNames: Object.fromEntries(gameState.players.map(({ color, name }) => [color, name])),
    selectedMarbleId,
    selectableMarbleIds: selectableMarbles,
    legalMarbleIds: canAct && !replayInProgress ? movableMarbles : [],
    legalDestinationIds: actionLocked || replayInProgress || !canAct ? [] : destinations,
    replayMove,
    onMarbleSelect(marbleId) {
      if (actionLocked || replayInProgress || !canControlTurn() || gameState.phase !== "move") return;
      selectedMarbleId = selectedMarbleId === marbleId ? null : marbleId;
      statusMessage = selectedMarbleId
        ? "Choose one of the highlighted destinations."
        : describeLastAction();
      renderGame();
    },
    onDestinationSelect(destination) {
      if (actionLocked || replayInProgress || !selectedMarbleId || !canControlTurn() || gameState.phase !== "move") return;
      runGameAction(() => moveSelectedMarble(destination));
    },
  });
}

async function commitOnlineGame(transition, requireTurn = true) {
  await updateRoomTransaction(onlineRoomCode, (room, uid) => {
    if (!room || room.status !== "playing" || !room.game) throw new Error("The game state changed.");
    if (!room.players?.[uid]) throw new Error("You are not a member of this room.");
    if (requireTurn && room.game.turnUid !== uid) throw new Error("That turn has already changed.");
    return { ...room, game: transition(room.game, uid) };
  });
}

async function runGameAction(action) {
  if (actionLocked) return;
  actionLocked = true;
  renderGame();
  try {
    await action();
    if (gameMode === "local") statusMessage = describeLastAction();
  } catch (error) {
    selectedMarbleId = null;
    statusMessage = `Action not saved. ${error.message} The latest room state is shown; please retry.`;
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 300));
    actionLocked = false;
    renderGame();
  }
}

async function handleRoll() {
  const uid = gameMode === "online" ? firebaseUser.uid : currentPlayer().uid;
  const dice = rollDice();
  const transition = (state, actingUid) => state.phase === "opening-roll"
    ? applyOpeningRoll(state, actingUid, dice)
    : applyRoll(state, actingUid, dice);
  transition(gameState, uid);

  if (gameMode === "online") await commitOnlineGame(transition);
  else gameState = transition(gameState, uid);
}

async function moveSelectedMarble(destination) {
  const uid = gameMode === "online" ? firebaseUser.uid : currentPlayer().uid;
  const pieceId = selectedMarbleId;
  // ponytail: if both dice reach the same hole, consume them in rolled order.
  const move = getLegalMoves(gameState, uid).find((candidate) => (
    candidate.pieceId === pieceId && candidate.destination === destination
  ));
  if (!move) throw new Error("That destination is no longer available.");
  const die = move.die;
  const replay = {
    pieceId,
    fromPositionId: gameState.pieces[pieceId].positionId,
    destinationId: destination,
  };
  const continuesRoll = gameState.lastAction?.type === "move"
    && gameState.lastAction.uid === uid;
  const transition = (state, actingUid) => applyMove(state, actingUid, pieceId, destination, die);
  transition(gameState, uid);
  selectedMarbleId = null;

  if (gameMode === "online") await commitOnlineGame(transition);
  else {
    gameState = transition(gameState, uid);
    lastTurnReplay = continuesRoll ? [...lastTurnReplay, replay] : [replay];
  }
}

async function replayLastTurn() {
  if (replayInProgress || !lastTurnReplay.length) return;
  replayInProgress = true;
  selectedMarbleId = null;
  try {
    for (const replay of [...lastTurnReplay]) {
      pendingMoveReplay = { ...replay, forceMotion: true };
      renderGame();
      await new Promise((resolve) => setTimeout(resolve, 950));
    }
  } finally {
    pendingMoveReplay = null;
    replayInProgress = false;
    renderGame();
  }
}

setupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const names = playerInputs.map((input) => input.value.trim());
  for (const [index, input] of playerInputs.entries()) {
    input.setCustomValidity(index < 2 && !names[index] ? "Enter a player name." : "");
  }
  if (!setupForm.reportValidity()) return;

  gameMode = "local";
  gameState = createGame(names.filter(Boolean).map((name, index) => ({
    uid: `local-${index + 1}`,
    name,
  })));
  gameState = startGame(gameState, gameState.hostUid);
  selectedMarbleId = null;
  statusMessage = describeLastAction();
  showScreen("game");
  renderGame();
});

for (const input of playerInputs) input.addEventListener("input", () => input.setCustomValidity(""));
rollButton.addEventListener("click", () => runGameAction(handleRoll));
replayMoveButton.addEventListener("click", replayLastTurn);
skipButton.addEventListener("click", () => {
  const skipped = currentPlayer();
  if (!skipped || !confirm(`Skip ${skipped.name}'s turn?`)) return;
  runGameAction(async () => {
    if (gameMode === "online") {
      skipTurn(gameState, firebaseUser.uid);
      await commitOnlineGame((state, uid) => skipTurn(state, uid), false);
    } else gameState = skipTurn(gameState, gameState.hostUid);
    selectedMarbleId = null;
  });
});

endGameButton.addEventListener("click", () => {
  if (!confirm("End this game for everyone?")) return;
  runGameAction(async () => {
    if (gameMode === "online") {
      endGame(gameState, firebaseUser.uid);
      await commitOnlineGame((state, uid) => endGame(state, uid), false);
    } else gameState = endGame(gameState, gameState.hostUid);
    selectedMarbleId = null;
  });
});

newGameButton.addEventListener("click", () => {
  if (gameMode === "local") {
    if (!["finished", "ended"].includes(gameState.phase) && !confirm("Start a new game?")) return;
    gameState = null;
    selectedMarbleId = null;
    statusMessage = "";
    lastTurnReplay = [];
    showScreen("local");
    return;
  }

  if (!confirm("Restart this room with the same players?")) return;
  runGameAction(async () => {
    await updateRoomTransaction(onlineRoomCode, (room, uid) => {
      if (room.hostUid !== uid) throw new Error("Only the host can restart the room.");
      if (!["finished", "ended"].includes(room.game?.phase)) throw new Error("The current game is still active.");
      return { ...room, game: freshGame(room, uid) };
    });
  });
});

async function initializeOnlinePlay() {
  const requestedCode = new URLSearchParams(location.search).get("room")?.trim().toUpperCase();
  if (requestedCode) roomCodeInput.value = requestedCode;
  try {
    firebaseUser = await signIn();
    setOnlineBusy(false);
    if (requestedCode && !/^[A-HJ-NP-Z2-9]{6}$/.test(requestedCode)) {
      homeError.textContent = "That invite code is invalid.";
    } else if (requestedCode) await watchRoom(requestedCode);
  } catch {
    homeError.textContent = "Online rooms are unavailable. Check Firebase setup and your network.";
  }
}

initializeOnlinePlay();
