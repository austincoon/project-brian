import { HOLES_BY_ID, PLAYER_ORDER, PLAYERS, describeMove, renderBoard } from "./board.js?v=20260923-4";
import { chooseBotMove, getPlayerDiceRows, getPlayerProgress, rollDice } from "./dice.js?v=20260826-32";
import { LOCAL_GAME_KEY, loadLocalGame, readStored, writeStored } from "./session.js?v=20260923-1";
import { loadTurnReplay, saveTurnReplay } from "./replay.js?v=20260823-19";
import { applyTheme, loadTheme } from "./theme.js?v=20260826-3";
import {
  applyMove,
  applyOpeningRoll,
  applyRoll,
  createGame,
  endGame,
  gameActionKey,
  getLegalMoves,
  startGame,
} from "./game.js?v=20260923-4";
import {
  createRoom,
  joinRoom,
  leaveRoom,
  signIn,
  subscribeToRoom,
  updateRoomTransaction,
} from "./firebase.js?v=20260923-1";

const screens = [...document.querySelectorAll("[data-screen]")];
const createRoomForm = document.querySelector("#create-room-form");
const joinRoomForm = document.querySelector("#join-room-form");
const homeError = document.querySelector("#home-error");
const roomCodeInput = document.querySelector("#room-code");
const localModeButton = document.querySelector("#local-mode-button");
const settingsButton = document.querySelector("#settings-button");
const settingsDialog = document.querySelector("#settings-dialog");
const themeInputs = [...settingsDialog.querySelectorAll("[name='theme']")];
const setupForm = document.querySelector("#local-game-form");
const playerInputs = [...setupForm.querySelectorAll("[name='playerName']")];
const botInputs = [...setupForm.querySelectorAll("[data-bot-for]")];
const lobbyCode = document.querySelector("#lobby-code");
const inviteLink = document.querySelector("#invite-link");
const copyInviteButton = document.querySelector("#copy-invite-button");
const playerList = document.querySelector("#player-list");
const lobbyStatus = document.querySelector("#lobby-status");
const startButton = document.querySelector("#start-game-button");
const addBotButton = document.querySelector("#add-bot-button");
const removeBotButton = document.querySelector("#remove-bot-button");
const leaveButton = document.querySelector("#leave-room-button");
const phaseLabel = document.querySelector("#phase-label");
const gameTitle = document.querySelector("#game-title");
const mainMenuButton = document.querySelector("#main-menu-button");
const newGameButton = document.querySelector("#new-game-button");
const gameSidebar = document.querySelector(".game-sidebar");
const board = document.querySelector("#board");
const playerDiceGrid = document.querySelector("#player-dice-grid");
const diceRollStage = document.querySelector("#dice-roll-stage");
const rollButton = document.querySelector("#roll-button");
const replayMoveButton = document.querySelector("#replay-move-button");

const endGameButton = document.querySelector("#end-game-button");
const turnStatus = document.querySelector("#turn-status");
const progressBoardList = document.querySelector("#progress-board-list");
const victoryWinner = document.querySelector("#victory-winner");
const victoryStats = document.querySelector("#victory-stats");
const victoryRestartButton = document.querySelector("#victory-restart-button");
const victoryMenuButton = document.querySelector("#victory-menu-button");
const victoryStatus = document.querySelector("#victory-status");
const helpDialog = document.querySelector("#help-dialog");
const quickPlayInput = document.querySelector("#quick-play");
const resumePanel = document.querySelector("#resume-panel");
const moveChoices = document.querySelector("#move-choices");
const onlineStatus = document.querySelector("#online-status");
const retryOnlineButton = document.querySelector("#retry-online-button");
const saveStatus = document.querySelector("#save-status");
let storage;
try { storage = window.localStorage; } catch { /* Play remains available without storage. */ }
let savedLocalGame = loadLocalGame(storage);
let savedState = null;
let lastActivityKey = null;
let activity = [];
let roomWatchToken = 0;

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
let botTimer = null;
let lastDiceByUid = {};
let lastDiceRollKey = null;
let diceScene = null;
let diceRollToken = 0;
let diceRollCancel = null;
let diceInMotion = false;
let lastLocalPhysicalRoll = null;
let moveUnlockDelayMs = 0;

const activeTheme = applyTheme(document.documentElement, storage, loadTheme(storage));
themeInputs.find(({ value }) => value === activeTheme).checked = true;
quickPlayInput.checked = readStored(storage, "project-brian-quick-play", false) === true;
document.documentElement.dataset.quickPlay = quickPlayInput.checked;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const quickMotion = () => quickPlayInput.checked || reducedMotion.matches;
quickPlayInput.addEventListener("change", () => {
  document.documentElement.dataset.quickPlay = quickPlayInput.checked;
  writeStored(storage, "project-brian-quick-play", quickPlayInput.checked);
});
const rememberedName = readStored(storage, "project-brian-name", "");
if (typeof rememberedName === "string") {
  for (const input of [playerInputs[0], document.querySelector("#host-name"), document.querySelector("#join-name")]) input.value = rememberedName.slice(0, 24);
}
renderBoard(document.querySelector("#home-board-preview"), {
  idPrefix: "preview-",
  marbles: Object.values(createGame(PLAYER_ORDER.map((name) => ({ uid: name, name }))).pieces),
});
updateResume();

function openDialog(dialog) {
  clearTimeout(botTimer);
  dialog.showModal();
}
settingsButton.addEventListener("click", () => openDialog(settingsDialog));
for (const button of document.querySelectorAll("[data-help]")) button.addEventListener("click", () => openDialog(helpDialog));
for (const dialog of [settingsDialog, helpDialog]) dialog.addEventListener("close", scheduleBotTurn);
settingsDialog.addEventListener("change", ({ target }) => {
  if (target.matches("[name='theme']")) applyTheme(document.documentElement, storage, target.value);
});

function showScreen(name) {
  const changed = screens.find((screen) => !screen.hidden)?.dataset.screen !== name;
  for (const screen of screens) screen.hidden = screen.dataset.screen !== name;
  if (name === "home") updateResume();
  if (changed) {
    const heading = document.querySelector(`[data-screen="${name}"] h1`);
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

function updateResume() {
  savedLocalGame = loadLocalGame(storage);
  resumePanel.hidden = !savedLocalGame;
  if (savedLocalGame) document.querySelector("#resume-description").textContent = savedLocalGame.players.map(({ name }) => name).join(" · ");
}

document.querySelector("#resume-button").addEventListener("click", () => {
  updateResume();
  if (!savedLocalGame) return;
  forgetOnlineRoom();
  gameMode = "local";
  gameState = savedLocalGame;
  const dice = gameState.dice ?? gameState.lastAction?.dice;
  const diceUid = gameState.dice ? gameState.turnUid : gameState.lastAction?.uid;
  const roller = gameState.players.find(({ uid }) => uid === diceUid);
  if (dice && roller) {
    lastLocalPhysicalRoll = { uid: diceUid, dice: [...dice] };
  }
  selectedMarbleId = null;
  activity = [];
  lastActivityKey = null;
  statusMessage = "Game resumed.";
  showScreen("game");
  if (dice && roller) animateDice(roller, dice, true).then(() => renderGame());
  renderGame();
});

function resetDiceDisplays() {
  diceScene?.dispose();
  diceScene = null;
  diceRollCancel?.(new Error("The dice roll was canceled."));
  diceRollCancel = null;
  diceRollToken += 1;
  diceInMotion = false;
  lastLocalPhysicalRoll = null;
  lastDiceByUid = {};
  lastDiceRollKey = null;
  const label = document.createElement("strong");
  label.textContent = "Dice table";
  const table = document.createElement("div");
  table.className = "dice-table-surface";
  table.setAttribute("aria-hidden", "true");
  const ready = document.createElement("span");
  ready.className = "dice-table-ready";
  ready.textContent = "Roll 'em";
  table.append(ready);
  diceRollStage.replaceChildren(label, table);
  diceRollStage.hidden = false;
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

function isBotUid(uid) {
  return /^(?:npc-|local-npc-)/.test(uid);
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
    if (isBotUid(player.uid)) row.append(document.createTextNode(" (NPC)"));
    if (player.uid === onlineRoom.hostUid) row.append(document.createTextNode(" (host)"));
    return row;
  }));

  lobbyStatus.textContent = players.length < 2
    ? "Waiting for at least one more player."
    : `${players.length} players are ready.`;
  startButton.hidden = !isHost;
  startButton.disabled = onlineBusy || players.length < 2 || players.length > 4;
  const bots = players.filter(({ uid }) => isBotUid(uid));
  addBotButton.hidden = !isHost;
  addBotButton.disabled = onlineBusy || players.length >= 4;
  removeBotButton.hidden = !isHost || !bots.length;
  removeBotButton.disabled = onlineBusy;
  leaveButton.disabled = onlineBusy;
}

function forgetOnlineRoom() {
  roomWatchToken += 1;
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
  resetDiceDisplays();
  clearTimeout(botTimer);
  botTimer = null;
  setRoomUrl(null);
}

function returnToMainMenu() {
  clearTimeout(botTimer);
  botTimer = null;
  if (gameMode === "online") forgetOnlineRoom();
  else {
    gameMode = null;
    gameState = null;
    pendingMoveReplay = null;
    lastTurnReplay = [];
    resetDiceDisplays();
  }
  selectedMarbleId = null;
  statusMessage = "";
  homeError.textContent = "";
  showScreen("home");
}

function playerName(uid) {
  return gameState?.players.find((player) => player.uid === uid)?.name ?? "Unknown player";
}

function formatRoll(dice) {
  return `${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}`;
}

function moveAnimationDuration(path) {
  if (quickMotion()) return 0;
  return Math.min(1200, 650 + Math.max(path?.length ?? 1, 1) * 80);
}

function moveAnimationTotal(replay) {
  return replay.durationMs + (replay.captureId ? 350 : 50);
}

function createMoveReplay(state, move) {
  const path = move.path?.length ? [...move.path] : [move.destination];
  return {
    pieceId: move.pieceId,
    fromPositionId: state.pieces[move.pieceId].positionId,
    destinationId: move.destination,
    path,
    durationMs: moveAnimationDuration(path),
    forceMotion: false,
    captureId: move.captureId ?? null,
    capturedFromPositionId: move.captureId ? state.pieces[move.captureId].positionId : null,
  };
}

function finishMoveReplay(replay, state) {
  if (replay.captureId) replay.capturedDestinationId = state.pieces[replay.captureId].positionId;
  return replay;
}

function describeLastAction() {
  const action = gameState?.lastAction;
  if (!action) return "Waiting for the game state.";
  const name = action.uid ? playerName(action.uid) : "The host";

  switch (action.type) {
    case "started":
      return `${playerName(gameState.turnUid)} rolls first.`;
    case "opening-roll":
      return `${name} rolled ${formatRoll(action.dice)}.`;
    case "roll":
      return `${name} rolled ${formatRoll(action.dice)}.`;
    case "no-move":
      return `${name} rolled ${formatRoll(action.dice)} with no legal move.${action.extraTurn ? " Doubles grant another roll." : " The turn advanced."}`;
    case "move": {
      const capture = action.captureId
        ? ` ${playerName(gameState.pieces[action.captureId].ownerUid)}'s marble returned to Base.`
        : "";
      const extraTurn = gameState.phase === "roll" && gameState.turnUid === action.uid ? " Doubles — roll again!" : "";
      return `${name}: ${describeMove(action)}.${capture}${extraTurn}`;
    }
    case "ended":
      return `${name} ended the game.`;
    default:
      return "The game state was updated.";
  }
}

async function watchRoom(code) {
  unsubscribeRoom?.();
  const watchToken = ++roomWatchToken;
  onlineRoomCode = code;
  const stopWatching = await subscribeToRoom(code, (room) => {
    if (watchToken !== roomWatchToken) return;
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
      if (room.game.phase === "ended") {
        returnToMainMenu();
        return;
      }
      const previousGame = gameMode === "online" ? gameState : null;
      if (previousGame && JSON.stringify(previousGame) === JSON.stringify(room.game)) {
        if (statusMessage.startsWith("Connection lost")) { statusMessage = "Connection restored."; renderGame(); }
        return;
      }
      const action = room.game.lastAction;
      const gameId = room.restartedAt ?? room.startedAt;
      if (!previousGame) lastTurnReplay = loadTurnReplay(storage, code, gameId);
      if (action?.type === "started") {
        lastTurnReplay = [];
        resetDiceDisplays();
      }
      const previousPiece = previousGame?.pieces?.[action?.pieceId];
      const movedPiece = room.game.pieces?.[action?.pieceId];
      const legalMove = action?.type === "move" && previousGame
        ? getLegalMoves(previousGame, action.uid).find((move) => (
          move.pieceId === action.pieceId
          && move.destination === action.destination
          && move.die === action.die
        ))
        : null;
      const replay = action?.type === "move"
        && previousPiece
        && movedPiece
        && previousPiece.positionId !== movedPiece.positionId
        ? finishMoveReplay(createMoveReplay(previousGame, legalMove ?? {
          pieceId: action.pieceId,
          destination: action.destination,
          path: [action.destination],
          captureId: action.captureId,
        }), room.game)
        : null;
      pendingMoveReplay = replay;
      if (replay && action.uid !== firebaseUser.uid) {
        const continuesRoll = previousGame.lastAction?.type === "move"
          && previousGame.lastAction.uid === action.uid;
        lastTurnReplay = continuesRoll ? [...lastTurnReplay, replay] : [replay];
      }
      saveTurnReplay(storage, code, gameId, lastTurnReplay);
      gameMode = "online";
      gameState = room.game;
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
    if (watchToken !== roomWatchToken) return;
    statusMessage = "Connection lost. Check your network and retry the action.";
    if (gameState) renderGame();
    else {
      homeError.textContent = statusMessage;
      showScreen("home");
    }
  });
  if (watchToken !== roomWatchToken) stopWatching();
  else unsubscribeRoom = stopWatching;
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
  writeStored(storage, "project-brian-name", document.querySelector("#host-name").value.trim());
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
  writeStored(storage, "project-brian-name", document.querySelector("#join-name").value.trim());
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

addBotButton.addEventListener("click", () => runOnlineAction(async () => {
  await updateRoomTransaction(onlineRoomCode, (room, uid) => {
    if (!room || room.status !== "waiting") throw new Error("This lobby is no longer waiting.");
    if (room.hostUid !== uid) throw new Error("Only the host can add an NPC.");
    if (room.playerCount >= 4) throw new Error("The lobby already has four players.");
    const seat = [1, 2, 3].find((index) => room.seats?.[index] === "");
    if (!seat) throw new Error("There is no available NPC seat.");
    const botUid = `npc-${seat}`;
    const now = Date.now();
    return {
      ...room,
      updatedAt: now,
      playerCount: room.playerCount + 1,
      seats: { ...room.seats, [seat]: botUid },
      players: {
        ...room.players,
        [botUid]: {
          uid: botUid,
          name: `NPC ${seat}`,
          color: PLAYER_ORDER[seat],
          seat,
          joinedAt: now,
          isBot: true,
        },
      },
    };
  });
}, lobbyStatus));

removeBotButton.addEventListener("click", () => runOnlineAction(async () => {
  await updateRoomTransaction(onlineRoomCode, (room, uid) => {
    if (!room || room.status !== "waiting") throw new Error("This lobby is no longer waiting.");
    if (room.hostUid !== uid) throw new Error("Only the host can remove an NPC.");
    const bot = sortedPlayers(room).filter((player) => isBotUid(player.uid)).at(-1);
    if (!bot) throw new Error("There is no NPC to remove.");
    const players = { ...room.players };
    delete players[bot.uid];
    return {
      ...room,
      updatedAt: Date.now(),
      playerCount: room.playerCount - 1,
      seats: { ...room.seats, [bot.seat]: "" },
      players,
    };
  });
}, lobbyStatus));

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

localModeButton.addEventListener("click", () => { forgetOnlineRoom(); showScreen("local"); });
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

function stopPhysicalDiceRoll() {
  diceScene?.dispose();
  diceScene = null;
  diceRollCancel?.(new Error("The dice roll was canceled."));
  diceRollCancel = null;
  diceRollToken += 1;
  diceInMotion = false;
}

function physicalDiceRoll(player, seed, renderer = null, settled = false) {
  const token = diceRollToken;
  const label = document.createElement("strong");
  label.textContent = `${player.name} is rolling…`;
  const table = document.createElement("div");
  table.className = "dice-table-surface";
  table.setAttribute("aria-hidden", "true");
  diceInMotion = true;
  diceRollStage.style.setProperty("--player-color", PLAYERS[player.color].color);
  diceRollStage.replaceChildren(label, table);
  diceRollStage.hidden = false;

  return new Promise((resolve, reject) => {
    diceRollCancel = reject;
    const loadRenderer = renderer ? Promise.resolve(renderer) : import("./dice-scene.js?v=20260923-2");
    loadRenderer.then(({ throwDice }) => {
      if (token !== diceRollToken) return;
      diceScene = throwDice(table, seed, (dice) => {
        if (token !== diceRollToken) return;
        diceRollCancel = null;
        diceInMotion = false;
        label.textContent = `${player.name} rolled ${formatRoll(dice)}`;
        resolve(dice);
      }, settled);
    }).catch((error) => {
      if (token !== diceRollToken) return;
      diceRollCancel = null;
      diceInMotion = false;
      label.textContent = "3D dice unavailable";
      reject(error);
    });
  });
}

function showStaticDice(player, dice) {
  stopPhysicalDiceRoll();
  const label = document.createElement("strong");
  label.textContent = `${player.name} rolled ${formatRoll(dice)}`;
  const tray = document.createElement("div");
  tray.className = "dice-table-surface";
  const faces = document.createElement("div");
  faces.className = "dice static-dice";
  faces.setAttribute("aria-hidden", "true");
  for (const value of dice) {
    const face = document.createElement("span");
    face.className = "die-button";
    drawDie(face, value);
    faces.append(face);
  }
  tray.append(faces);
  diceRollStage.replaceChildren(label, tray);
}

async function animateDice(player, dice, settled = false) {
  stopPhysicalDiceRoll();
  const token = diceRollToken;
  if (quickPlayInput.checked) { showStaticDice(player, dice); return; }
  diceInMotion = true;
  try {
    const renderer = await import("./dice-scene.js?v=20260923-2");
    if (token !== diceRollToken) return;
    await physicalDiceRoll(player, renderer.replaySeedFor(dice), renderer, settled);
  } catch {
    // Rendering is cosmetic: a lost WebGL context must never prevent a turn.
    if (token === diceRollToken) showStaticDice(player, dice);
  }
}

async function rollDiceFromPhysics(uid) {
  const player = gameState.players.find((candidate) => candidate.uid === uid);
  const dice = rollDice();
  await animateDice(player, dice);
  lastLocalPhysicalRoll = { uid, dice: [...dice] };
  return dice;
}

function renderDiceRoll() {
  const action = gameState.lastAction;
  if (!["opening-roll", "roll", "no-move"].includes(action?.type)) return;
  const stats = gameState.stats?.[action.uid] ?? {};
  const sequence = action.type === "opening-roll" ? stats.openingRolls : stats.rolls;
  const key = `${action.type}:${action.uid}:${sequence}:${action.dice.join("-")}`;
  if (key === lastDiceRollKey) return;
  lastDiceRollKey = key;

  const player = gameState.players.find(({ uid }) => uid === action.uid);
  if (lastLocalPhysicalRoll?.uid === action.uid
      && lastLocalPhysicalRoll.dice.every((die, index) => die === action.dice[index])) {
    lastLocalPhysicalRoll = null;
    return;
  }

  animateDice(player, action.dice).then(() => {
    if (key === lastDiceRollKey) renderGame();
  });
}

function renderDice() {
  const rows = getPlayerDiceRows(gameState, lastDiceByUid);
  lastDiceByUid = Object.fromEntries(rows.flatMap(({ uid, dice }) => dice ? [[uid, dice]] : []));
  playerDiceGrid.replaceChildren(...rows.map((row) => {
    const card = document.createElement("article");
    card.className = `player-dice-card${row.isActive ? " is-active" : ""}${row.isLastRoller ? " is-last-roller" : ""}`;
    card.dataset.seat = PLAYERS[row.color].seat;
    card.style.setProperty("--player-color", PLAYERS[row.color].color);

    const identity = document.createElement("div");
    identity.className = "player-dice-identity";
    const swatch = document.createElement("span");
    swatch.className = "player-dice-swatch";
    swatch.setAttribute("aria-hidden", "true");
    const name = document.createElement("strong");
    name.textContent = `${row.name}${isBotUid(row.uid) ? " · NPC" : ""}`;
    identity.append(swatch, name);

    const status = document.createElement("span");
    status.className = "player-dice-status";
    const total = row.dice ? row.dice[0] + row.dice[1] : null;
    status.textContent = row.isActive
      ? gameState.phase === "move" ? "Moving now" : gameState.phase === "opening-roll" ? "Opening roll" : "Up next"
      : total ? `Last roll: ${total}` : "Waiting to roll";

    const dice = document.createElement("div");
    dice.className = "dice player-dice-set";
    dice.setAttribute("aria-label", row.dice
      ? `${row.name} rolled ${row.dice[0]} and ${row.dice[1]}, total ${total}`
      : `${row.name} has not rolled yet`);
    const displays = [0, 1].map((index) => {
      const display = document.createElement("span");
      display.className = "die-button";
      display.setAttribute("aria-hidden", "true");
      drawDie(display, row.dice?.[index]);
      return display;
    });

    if (row.isActive && gameState.phase === "move" && row.dice) {
      const counts = new Map();
      for (const die of gameState.remainingDice ?? []) counts.set(die, (counts.get(die) ?? 0) + 1);
      const availability = [];
      displays.forEach((display, index) => {
        const count = counts.get(row.dice[index]) ?? 0;
        display.classList.toggle("is-used", !count);
        availability.push(`${row.dice[index]} ${count ? "available" : "used"}`);
        if (count) counts.set(row.dice[index], count - 1);
      });
      dice.setAttribute("aria-label", `${row.name}: ${availability.join(", ")}`);
    }

    dice.append(...displays);
    card.append(identity, status, dice);
    return card;
  }));
  renderDiceRoll();
}

function canControlTurn() {
  return !isBotUid(gameState?.turnUid)
    && (gameMode === "local" || firebaseUser?.uid === gameState?.turnUid);
}

function scheduleBotTurn() {
  clearTimeout(botTimer);
  botTimer = null;
  const player = currentPlayer();
  const hostCanRunBot = gameMode === "local" || firebaseUser?.uid === onlineRoom?.hostUid;
  if (settingsDialog.open || helpDialog.open) return;
  if (!player || !isBotUid(player.uid) || !hostCanRunBot || actionLocked || replayInProgress || diceInMotion) return;
  const delay = quickMotion() ? 350 : gameState.lastAction?.type === "move" ? 1600 : 1300;
  botTimer = setTimeout(() => runGameAction(playBotTurn), delay);
}

async function playBotTurn() {
  const uid = currentPlayer()?.uid;
  if (!uid || !isBotUid(uid)) return;

  if (["opening-roll", "roll"].includes(gameState.phase)) {
    const expectedGame = gameState;
    const expectedKey = gameActionKey(expectedGame);
    const dice = await rollDiceFromPhysics(uid);
    const transition = (state) => state.phase === "opening-roll"
      ? applyOpeningRoll(state, uid, dice)
      : applyRoll(state, uid, dice);
    if (gameMode === "online" && gameState !== expectedGame) return;
    transition(gameState);
    if (gameMode === "online") await commitOnlineGame(transition, true, uid, expectedKey);
    else gameState = transition(gameState);
    return;
  }

  const moves = getLegalMoves(gameState, uid);
  if (!moves.length) return;
  const move = chooseBotMove(moves);
  const replay = createMoveReplay(gameState, move);
  moveUnlockDelayMs = moveAnimationTotal(replay);
  const continuesRoll = gameState.lastAction?.type === "move" && gameState.lastAction.uid === uid;
  const transition = (state) => applyMove(state, uid, move.pieceId, move.destination, move.die);
  transition(gameState);
  if (gameMode === "online") await commitOnlineGame(transition, true, uid);
  else {
    gameState = transition(gameState);
    finishMoveReplay(replay, gameState);
    pendingMoveReplay = replay;
    lastTurnReplay = continuesRoll ? [...lastTurnReplay, replay] : [replay];
  }
}

function renderVictory() {
  clearTimeout(botTimer);
  botTimer = null;
  const winner = gameState.players.find(({ uid }) => uid === gameState.winnerUid);
  const hostUid = gameMode === "online" ? onlineRoom.hostUid : gameState.hostUid;
  const canRestart = gameMode === "local" || firebaseUser.uid === hostUid;
  victoryWinner.textContent = winner.name;
  victoryWinner.style.setProperty("--winner-color", PLAYERS[winner.color].color);
  victoryRestartButton.hidden = !canRestart;
  victoryRestartButton.disabled = actionLocked;
  victoryMenuButton.disabled = actionLocked;
  victoryStatus.textContent = canRestart ? "" : `Waiting for ${playerName(hostUid)} to start the next game.`;

  const players = [winner, ...gameState.players.filter(({ uid }) => uid !== winner.uid)];
  victoryStats.replaceChildren(...players.map((player) => {
    const stats = gameState.stats?.[player.uid] ?? {};
    const home = Object.values(gameState.pieces).filter((piece) => (
      piece.ownerUid === player.uid && piece.positionId.startsWith("home:")
    )).length;
    const values = [
      ["Marbles Home", `${home} / 5`],
      ["Opening rolls", stats.openingRolls ?? 0],
      ["Rolls", stats.rolls ?? 0],
      ["Average roll", stats.rolls ? (stats.diceTotal / stats.rolls).toFixed(1) : "–"],
      ["Dice total", stats.diceTotal ?? 0],
      ["Sixes", stats.sixes ?? 0],
      ["Doubles", stats.doubles ?? 0],
      ["Moves", stats.moves ?? 0],
      ["Captures", stats.captures ?? 0],
      ["Times captured", stats.timesCaptured ?? 0],
      ["Gambit visits", stats.gambits ?? 0],
      ["Blocked rolls", stats.blockedRolls ?? 0],
    ];
    const card = document.createElement("article");
    card.className = `victory-player${player.uid === winner.uid ? " is-winner" : ""}`;
    card.style.setProperty("--player-color", PLAYERS[player.color].color);
    const heading = document.createElement("h3");
    heading.textContent = player.uid === winner.uid ? `${player.name} — Champion` : player.name;
    const list = document.createElement("dl");
    for (const [label, value] of values) {
      const row = document.createElement("div");
      const term = document.createElement("dt");
      const detail = document.createElement("dd");
      term.textContent = label;
      detail.textContent = value;
      row.append(term, detail);
      list.append(row);
    }
    card.append(heading, list);
    return card;
  }));
}

function destinationName(id) {
  const hole = HOLES_BY_ID[id];
  if (!hole) return "the board";
  if (hole.kind === "center") return "the Gambit";
  if (hole.kind === "home") return `Home ${Number(id.split(":")[2]) + 1}`;
  if (hole.kind === "base") return "Base";
  return hole.player ? `${PLAYERS[hole.player].label} Start` : "the track";
}

function selectMarble(id) {
  selectedMarbleId = selectedMarbleId === id ? null : id;
  statusMessage = selectedMarbleId ? "" : describeLastAction();
  renderGame();
}

function renderTurnGuide(legalMoves, canAct) {
  const player = currentPlayer();
  const busy = actionLocked || replayInProgress || diceInMotion;
  const moving = gameState.phase === "move";
  const opening = gameState.phase === "opening-roll";
  document.querySelector("#turn-guide-title").textContent = replayInProgress ? "Replaying the last move"
    : diceInMotion ? "Rolling…" : !canAct ? `Waiting for ${player.name}`
    : moving ? selectedMarbleId ? "Choose a move" : "Choose a marble"
    : opening ? "Opening roll" : "Roll dice";
  document.querySelector("#turn-guide-copy").textContent = moving && canAct
    ? `Dice: ${gameState.remainingDice.join(" & ")}`
    : opening ? (gameState.opening.round > 1 ? "Tied players roll again." : "Highest total starts.") : "";
  rollButton.hidden = moving;
  moveChoices.replaceChildren();
  if (!moving || !canAct) return;
  const choices = document.createElement("div");
  choices.className = "marble-choices";
  choices.setAttribute("aria-label", "Playable marbles");
  for (const id of new Set(legalMoves.map(({ pieceId }) => pieceId))) {
    const piece = gameState.pieces[id];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary marble-choice";
    button.textContent = piece.number;
    button.setAttribute("aria-label", `Marble ${piece.number} at ${destinationName(piece.positionId)}`);
    button.setAttribute("aria-pressed", String(id === selectedMarbleId));
    button.disabled = busy;
    button.addEventListener("click", (event) => {
      selectMarble(id);
      if (event.detail === 0) moveChoices.querySelector(".move-choice")?.focus();
    });
    choices.append(button);
  }
  moveChoices.append(choices);
  for (const move of legalMoves.filter(({ pieceId }) => pieceId === selectedMarbleId)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary move-choice";
    button.disabled = busy;
    const die = document.createElement("span");
    die.className = "move-die";
    die.textContent = move.die;
    die.setAttribute("aria-hidden", "true");
    const description = `${describeMove(move)}${move.captureId ? " · Capture" : ""}`;
    button.setAttribute("aria-label", `Use die ${move.die}: ${description}`);
    button.append(die, document.createTextNode(description));
    button.addEventListener("click", () => runGameAction(() => moveSelectedMarble(move.destination, move.die)));
    moveChoices.append(button);
  }
}

function renderGame() {
  if (!gameState) return;
  if (gameMode === "local" && savedState !== gameState) {
    const saved = writeStored(storage, LOCAL_GAME_KEY, gameState);
    if (saved) savedState = gameState;
    saveStatus.textContent = saved ? "Game saved" : "Storage unavailable — keep this page open to keep your game.";
  } else if (gameMode === "online") saveStatus.textContent = `Room ${onlineRoomCode}`;
  const activityKey = gameActionKey(gameState);
  if (activityKey !== lastActivityKey) {
    if (gameState.lastAction?.type === "started") activity = [];
    lastActivityKey = activityKey;
    activity = [describeLastAction(), ...activity].slice(0, 12);
    document.querySelector("#activity-list").replaceChildren(...activity.map((message) => {
      const item = document.createElement("li");
      item.textContent = message;
      return item;
    }));
  }
  if (gameState.phase === "finished") {
    showScreen("victory");
    renderVictory();
    return;
  }
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

  const openingWinner = gameState.phase === "roll" && gameState.lastAction?.type === "opening-roll";
  phaseLabel.textContent = gameState.phase === "opening-roll"
    ? `Opening roll ${gameState.opening.round}`
    : openingWinner ? "Opening winner"
    : gameState.phase === "finished" ? "Winner"
    : gameState.phase === "ended" ? "Game ended" : "Current turn";
  gameTitle.textContent = gameState.phase === "finished"
    ? `${playerName(gameState.winnerUid)} wins!`
    : gameState.phase === "ended" ? "Game ended"
    : `${player.name}'s turn`;
  const titlePlayer = gameState.players.find(({ uid }) => uid === (gameState.winnerUid ?? player.uid));
  gameSidebar.style.setProperty("--active-color", PLAYERS[titlePlayer.color].darkColor);
  gameSidebar.style.setProperty("--active-accent", PLAYERS[titlePlayer.color].color);
  progressBoardList.replaceChildren(...getPlayerProgress(gameState).map((progress) => {
    const item = document.createElement("li");
    item.style.setProperty("--player-color", PLAYERS[progress.color].color);
    item.classList.toggle("is-current", progress.uid === player.uid);
    const identity = document.createElement("div");
    identity.className = "progress-player";
    const name = document.createElement("strong");
    name.textContent = progress.name;
    const total = document.createElement("span");
    total.textContent = `${progress.homeCount}/5 Home`;
    identity.append(name, total);
    const marbles = document.createElement("div");
    marbles.className = "progress-marbles";
    marbles.setAttribute("aria-label", `${progress.homeCount} of 5 marbles Home`);
    marbles.append(...Array.from({ length: 5 }, (_, index) => {
      const marble = document.createElement("span");
      marble.classList.toggle("is-home", index < progress.homeCount);
      return marble;
    }));
    const captures = document.createElement("span");
    captures.className = "progress-captures";
    captures.textContent = `${progress.captures} capture${progress.captures === 1 ? "" : "s"}`;
    item.append(identity, marbles, captures);
    return item;
  }));

  rollButton.textContent = gameState.phase === "move"
    ? "Dice in play"
    : isBotUid(player.uid) ? `${player.name} is thinking...`
    : gameMode === "local" ? `Roll for ${player.name}`
    : canAct ? (gameState.phase === "opening-roll" ? "Make your opening roll" : "Roll your dice")
    : `Waiting for ${player.name}`;
  rollButton.disabled = actionLocked || replayInProgress || diceInMotion || !canAct || !["opening-roll", "roll"].includes(gameState.phase);
  replayMoveButton.hidden = !lastTurnReplay.length;
  replayMoveButton.textContent = gameMode === "online" ? "Replay opponent move" : "Replay last move";
  replayMoveButton.disabled = actionLocked || replayInProgress || diceInMotion;
  const hostUid = gameMode === "online" ? onlineRoom.hostUid : gameState.hostUid;
  const isHost = gameMode === "online" ? firebaseUser.uid === hostUid : true;
  mainMenuButton.disabled = actionLocked || replayInProgress || diceInMotion;
  mainMenuButton.textContent = gameMode === "local" ? "Save & main menu" : "Main menu";

  endGameButton.hidden = !isHost || !["opening-roll", "roll", "move"].includes(gameState.phase);
  endGameButton.disabled = actionLocked || replayInProgress || diceInMotion;
  newGameButton.hidden = gameMode === "online" && (firebaseUser.uid !== hostUid || !["finished", "ended"].includes(gameState.phase));
  newGameButton.textContent = gameMode === "online" ? "Restart game" : "New game";
  newGameButton.disabled = actionLocked || replayInProgress || diceInMotion;
  turnStatus.textContent = replayInProgress
    ? "Replaying last move…"
    : actionLocked && gameMode === "online"
    ? "Saving action..."
    : statusMessage;
  const showError = /^(Action not saved|Connection lost)/.test(statusMessage);
  turnStatus.classList.toggle("game-error", showError);
  renderTurnGuide(legalMoves, canAct);

  const selectableMarbles = actionLocked || replayInProgress || diceInMotion || !canAct ? [] : movableMarbles;
  const replayMove = pendingMoveReplay;
  pendingMoveReplay = null;
  renderBoard(board, {
    marbles: Object.values(gameState.pieces),
    activePlayer: player?.color ?? null,
    playerNames: Object.fromEntries(gameState.players.map(({ color, name }) => [color, name])),
    selectedMarbleId,
    selectableMarbleIds: selectableMarbles,
    legalMarbleIds: canAct && !replayInProgress && !diceInMotion ? movableMarbles : [],
    legalDestinationIds: actionLocked || replayInProgress || diceInMotion || !canAct ? [] : destinations,
    destinationLabels: Object.fromEntries(legalMoves.filter(({ pieceId }) => pieceId === selectedMarbleId).map((move) => [move.destination, describeMove(move)])),
    replayMove: quickMotion() && !replayInProgress ? null : replayMove,
    reducedMotion: quickMotion(),
    onMarbleSelect(marbleId) {
      if (actionLocked || replayInProgress || diceInMotion || !canControlTurn() || gameState.phase !== "move") return;
      selectMarble(marbleId);
    },
    onDestinationSelect(destination) {
      if (actionLocked || replayInProgress || diceInMotion || !selectedMarbleId || !canControlTurn() || gameState.phase !== "move") return;
      runGameAction(() => moveSelectedMarble(destination));
    },
  });
  scheduleBotTurn();
}

async function commitOnlineGame(transition, requireTurn = true, actingUid = null, expectedKey = gameActionKey(gameState)) {
  const staleAction = new Error("The action is stale.");
  let latestGame = null;
  try {
    await updateRoomTransaction(onlineRoomCode, (room, uid) => {
      if (!room || room.status !== "playing" || !room.game) throw new Error("The game state changed.");
      if (!room.players?.[uid]) throw new Error("You are not a member of this room.");
      if (gameActionKey(room.game) !== expectedKey) {
        latestGame = room.game;
        throw staleAction;
      }
      const actor = actingUid ?? uid;
      if (actingUid && (uid !== room.hostUid || !isBotUid(actor))) throw new Error("Only the host can run an NPC turn.");
      if (requireTurn && room.game.turnUid !== actor) throw new Error("That turn has already changed.");
      return { ...room, game: transition(room.game, actor) };
    });
  } catch (error) {
    if (error !== staleAction) throw error;
    gameState = latestGame;
    statusMessage = describeLastAction();
  }
}

async function runGameAction(action) {
  if (actionLocked) return;
  actionLocked = true;
  moveUnlockDelayMs = 0;
  renderGame();
  try {
    await action();
    if (gameMode === "local") {
      statusMessage = describeLastAction();
      renderGame();
    }
  } catch (error) {
    lastLocalPhysicalRoll = null;
    selectedMarbleId = null;
    moveUnlockDelayMs = 0;
    statusMessage = `Action not saved. ${error.message} The latest room state is shown; please retry.`;
  } finally {
    const settleDelay = quickMotion() ? 0 : moveUnlockDelayMs || 300;
    await new Promise((resolve) => setTimeout(resolve, settleDelay));
    moveUnlockDelayMs = 0;
    actionLocked = false;
    renderGame();
  }
}

async function handleRoll() {
  const uid = gameMode === "online" ? firebaseUser.uid : currentPlayer().uid;
  const expectedGame = gameState;
  const expectedKey = gameActionKey(expectedGame);
  const dice = await rollDiceFromPhysics(uid);
  const transition = (state, actingUid) => state.phase === "opening-roll"
    ? applyOpeningRoll(state, actingUid, dice)
    : applyRoll(state, actingUid, dice);
  if (gameMode === "online" && gameState !== expectedGame) return;
  transition(gameState, uid);

  if (gameMode === "online") await commitOnlineGame(transition, true, null, expectedKey);
  else gameState = transition(gameState, uid);
}

async function moveSelectedMarble(destination, selectedDie = null) {
  const uid = gameMode === "online" ? firebaseUser.uid : currentPlayer().uid;
  const pieceId = selectedMarbleId;
  // Board clicks use rolled order for shared destinations; move buttons can choose either die.
  const move = getLegalMoves(gameState, uid).find((candidate) => (
    candidate.pieceId === pieceId && candidate.destination === destination
    && (selectedDie === null || candidate.die === selectedDie)
  ));
  if (!move) throw new Error("That destination is no longer available.");
  const die = move.die;
  const replay = createMoveReplay(gameState, move);
  moveUnlockDelayMs = moveAnimationTotal(replay);
  const continuesRoll = gameState.lastAction?.type === "move"
    && gameState.lastAction.uid === uid;
  const transition = (state, actingUid) => applyMove(state, actingUid, pieceId, destination, die);
  transition(gameState, uid);

  if (gameMode === "online") await commitOnlineGame(transition);
  else {
    gameState = transition(gameState, uid);
    finishMoveReplay(replay, gameState);
    pendingMoveReplay = replay;
    lastTurnReplay = continuesRoll ? [...lastTurnReplay, replay] : [replay];
  }
}

async function replayLastTurn() {
  if (actionLocked || diceInMotion || replayInProgress || !lastTurnReplay.length) return;
  replayInProgress = true;
  selectedMarbleId = null;
  try {
    for (const replay of [...lastTurnReplay]) {
      const durationMs = quickMotion() ? 900 : moveAnimationDuration(replay.path);
      pendingMoveReplay = { ...replay, durationMs, forceMotion: false };
      renderGame();
      await new Promise((resolve) => setTimeout(
        resolve,
        moveAnimationTotal({ ...replay, durationMs }),
      ));
    }
  } finally {
    pendingMoveReplay = null;
    replayInProgress = false;
    renderGame();
  }
}

setupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const players = playerInputs.map((input, index) => {
    const bot = botInputs.find(({ dataset }) => dataset.botFor === input.id)?.checked;
    const name = input.value.trim();
    if (!name) return null;
    return {
      uid: bot ? `local-npc-${index}` : `local-${index + 1}`,
      name,
    };
  }).filter(Boolean);
  playerInputs[0].setCustomValidity(playerInputs[0].value.trim() ? "" : "Enter your name.");
  playerInputs[1].setCustomValidity(players.length >= 2 ? "" : "Add another person or select NPC.");
  if (!setupForm.reportValidity()) return;

  if (loadLocalGame(storage) && !confirm("Replace the saved local game with a new game?")) return;
  forgetOnlineRoom();
  writeStored(storage, "project-brian-name", players[0].name);
  activity = [];
  lastActivityKey = null;
  gameMode = "local";
  gameState = createGame(players);
  gameState = startGame(gameState, gameState.hostUid);
  resetDiceDisplays();
  selectedMarbleId = null;
  statusMessage = describeLastAction();
  showScreen("game");
  renderGame();
});

for (const input of playerInputs) input.addEventListener("input", () => {
  for (const field of playerInputs) field.setCustomValidity("");
});
for (const [index, checkbox] of botInputs.entries()) {
  checkbox.addEventListener("change", () => {
    const input = document.querySelector(`#${checkbox.dataset.botFor}`);
    input.disabled = checkbox.checked;
    input.value = checkbox.checked ? `Computer ${index + 1}` : "";
    for (const field of playerInputs) field.setCustomValidity("");
    input.setCustomValidity("");
  });
}
rollButton.addEventListener("click", () => runGameAction(handleRoll));
replayMoveButton.addEventListener("click", replayLastTurn);
document.addEventListener("keydown", (event) => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target.closest("input, textarea, select, [contenteditable], dialog") || settingsDialog.open || helpDialog.open) return;
  if (gameState && !document.querySelector('[data-screen="game"]').hidden) {
    if (event.key.toLowerCase() === "r" && !rollButton.disabled && !rollButton.hidden) { event.preventDefault(); rollButton.click(); }
    if (event.key === "Escape" && selectedMarbleId) { selectedMarbleId = null; renderGame(); }
  }
});
document.querySelector(".brand").addEventListener("click", (event) => {
  event.preventDefault();
  if (gameState?.phase === "finished") returnToMainMenu();
  else if (gameState) mainMenuButton.click();
  else if (onlineRoom) leaveButton.click();
  else showScreen("home");
});


endGameButton.addEventListener("click", () => {
  if (!confirm("End this game for everyone?")) return;
  runGameAction(async () => {
    if (gameMode === "online") {
      endGame(gameState, firebaseUser.uid);
      await commitOnlineGame((state, uid) => endGame(state, uid), false);
    } else {
      gameState = endGame(gameState, gameState.hostUid);
      writeStored(storage, LOCAL_GAME_KEY, null);
    }
    selectedMarbleId = null;
    returnToMainMenu();
  });
});

mainMenuButton.addEventListener("click", () => {
  const active = ["opening-roll", "roll", "move"].includes(gameState?.phase);
  const warning = gameMode === "online"
    ? "Return to the main menu? Your seat will remain in the online game."
    : "Return to the main menu? Your local game is saved on this browser.";
  if (actionLocked || replayInProgress || diceInMotion) return;
  if (active && gameMode === "online" && !confirm(warning)) return;
  if (active && gameMode === "local" && savedState !== gameState && !confirm("This browser could not save your game. Leave anyway?")) return;
  returnToMainMenu();
});

function restartGame() {
  if (gameMode === "local") {
    if (!["finished", "ended"].includes(gameState.phase) && !confirm("Start a new game?")) return;
    clearTimeout(botTimer);
    resetDiceDisplays();
    gameMode = null;
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
}

newGameButton.addEventListener("click", restartGame);
victoryRestartButton.addEventListener("click", restartGame);
victoryMenuButton.addEventListener("click", returnToMainMenu);

async function initializeOnlinePlay() {
  setOnlineBusy(true);
  retryOnlineButton.hidden = true;
  onlineStatus.textContent = "Connecting to online rooms…";
  const initialWatchToken = roomWatchToken;
  const requestedCode = new URLSearchParams(location.search).get("room")?.trim().toUpperCase();
  if (requestedCode) roomCodeInput.value = requestedCode;
  try {
    firebaseUser = await signIn();
    setOnlineBusy(false);
    onlineStatus.textContent = "Online rooms ready";
    onlineStatus.dataset.state = "ready";
    if (requestedCode && !/^[A-HJ-NP-Z2-9]{6}$/.test(requestedCode)) {
      homeError.textContent = "That invite code is invalid.";
    } else if (requestedCode && roomWatchToken === initialWatchToken) await watchRoom(requestedCode);
  } catch {
    onlineStatus.textContent = "Online unavailable · Local play is ready";
    onlineStatus.dataset.state = "offline";
    retryOnlineButton.hidden = false;
    setOnlineBusy(false);
  }
}

retryOnlineButton.addEventListener("click", initializeOnlinePlay);
initializeOnlinePlay();
