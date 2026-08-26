import { PLAYER_ORDER, PLAYERS, renderBoard } from "./board.js?v=20260825-23";
import { getPlayerDiceRows, randomIndex, rollDice } from "./dice.js?v=20260825-28";
import { loadTurnReplay, saveTurnReplay } from "./replay.js?v=20260823-19";
import { applyTheme, loadTheme } from "./theme.js?v=20260824-1";
import {
  applyMove,
  applyOpeningRoll,
  applyRoll,
  createGame,
  endGame,
  getLegalMoves,
  skipTurn,
  startGame,
} from "./game.js?v=20260824-22";
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
const gameHeader = document.querySelector(".game-header");
const board = document.querySelector("#board");
const playerDiceGrid = document.querySelector("#player-dice-grid");
const diceRollStage = document.querySelector("#dice-roll-stage");
const rollButton = document.querySelector("#roll-button");
const replayMoveButton = document.querySelector("#replay-move-button");

const endGameButton = document.querySelector("#end-game-button");
const turnStatus = document.querySelector("#turn-status");
const victoryWinner = document.querySelector("#victory-winner");
const victoryStats = document.querySelector("#victory-stats");
const victoryRestartButton = document.querySelector("#victory-restart-button");
const victoryMenuButton = document.querySelector("#victory-menu-button");
const victoryStatus = document.querySelector("#victory-status");

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
let diceInMotion = false;
let moveUnlockDelayMs = 0;

const activeTheme = applyTheme(document.documentElement, localStorage, loadTheme(localStorage));
themeInputs.find(({ value }) => value === activeTheme).checked = true;

settingsButton.addEventListener("click", () => settingsDialog.showModal());
settingsDialog.addEventListener("change", ({ target }) => {
  if (target.matches("[name='theme']")) applyTheme(document.documentElement, localStorage, target.value);
});

function showScreen(name) {
  for (const screen of screens) screen.hidden = screen.dataset.screen !== name;
}

function resetDiceDisplays() {
  diceScene?.dispose();
  diceScene = null;
  diceRollToken += 1;
  diceInMotion = false;
  lastDiceByUid = {};
  lastDiceRollKey = null;
  const label = document.createElement("strong");
  label.textContent = "Dice tray · Waiting for a roll";
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
    forceMotion: true,
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
      if (room.game.phase === "ended") {
        returnToMainMenu();
        return;
      }
      const previousGame = gameMode === "online" ? gameState : null;
      if (previousGame && JSON.stringify(previousGame) === JSON.stringify(room.game)) return;
      const action = room.game.lastAction;
      const gameId = room.restartedAt ?? room.startedAt;
      if (!previousGame) lastTurnReplay = loadTurnReplay(localStorage, code, gameId);
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
      saveTurnReplay(localStorage, code, gameId, lastTurnReplay);
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

function renderDiceRoll() {
  const action = gameState.lastAction;
  if (!["opening-roll", "roll", "no-move"].includes(action?.type)) return;
  const stats = gameState.stats?.[action.uid] ?? {};
  const sequence = action.type === "opening-roll" ? stats.openingRolls : stats.rolls;
  const key = `${action.type}:${action.uid}:${sequence}:${action.dice.join("-")}`;
  if (key === lastDiceRollKey) return;
  lastDiceRollKey = key;

  const player = gameState.players.find(({ uid }) => uid === action.uid);
  const label = document.createElement("strong");
  label.textContent = `${player.name} is rolling…`;
  const table = document.createElement("div");
  table.className = "dice-table-surface";
  table.setAttribute("aria-hidden", "true");
  diceScene?.dispose();
  diceScene = null;
  const token = ++diceRollToken;
  diceInMotion = true;
  diceRollStage.style.setProperty("--player-color", PLAYERS[player.color].color);
  diceRollStage.replaceChildren(label, table);
  diceRollStage.hidden = false;
  import("./dice-scene.js?v=20260825-1").then(({ throwDice }) => {
    if (token !== diceRollToken) return;
    diceScene = throwDice(table, action.dice, () => {
      if (token !== diceRollToken) return;
      diceInMotion = false;
      label.textContent = `${player.name} rolled ${formatRoll(action.dice)}`;
      renderGame();
    });
  }).catch((error) => {
    if (token !== diceRollToken) return;
    console.error("The 3D dice renderer failed to load.", error);
    diceInMotion = false;
    label.textContent = `${player.name} rolled ${formatRoll(action.dice)} · 3D unavailable`;
    renderGame();
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
      displays.forEach((display, index) => {
        const count = counts.get(row.dice[index]) ?? 0;
        display.classList.toggle("is-used", !count);
        if (count) counts.set(row.dice[index], count - 1);
      });
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
  if (!player || !isBotUid(player.uid) || !hostCanRunBot || actionLocked || replayInProgress || diceInMotion) return;
  const delay = gameState.lastAction?.type === "move" ? 1600 : 1300;
  botTimer = setTimeout(() => runGameAction(playBotTurn), delay);
}

async function playBotTurn() {
  const uid = currentPlayer()?.uid;
  if (!uid || !isBotUid(uid)) return;

  if (["opening-roll", "roll"].includes(gameState.phase)) {
    const dice = rollDice();
    const transition = (state) => state.phase === "opening-roll"
      ? applyOpeningRoll(state, uid, dice)
      : applyRoll(state, uid, dice);
    transition(gameState);
    if (gameMode === "online") await commitOnlineGame(transition, true, uid);
    else gameState = transition(gameState);
    return;
  }

  const moves = getLegalMoves(gameState, uid);
  if (!moves.length) return;
  const move = moves[randomIndex(moves.length)];
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
      ["Skipped turns", stats.skippedTurns ?? 0],
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

function renderGame() {
  if (!gameState) return;
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
  gameHeader.style.setProperty("--active-color", PLAYERS[titlePlayer.color].darkColor);
  gameHeader.style.setProperty("--active-accent", PLAYERS[titlePlayer.color].color);

  rollButton.textContent = gameState.phase === "move"
    ? "Dice in play"
    : isBotUid(player.uid) ? `${player.name} is thinking...`
    : gameMode === "local" ? `Roll for ${player.name}`
    : canAct ? (gameState.phase === "opening-roll" ? "Make your opening roll" : "Roll your dice")
    : `Waiting for ${player.name}`;
  rollButton.disabled = actionLocked || replayInProgress || diceInMotion || !canAct || !["opening-roll", "roll"].includes(gameState.phase);
  replayMoveButton.hidden = !lastTurnReplay.length;
  replayMoveButton.textContent = gameMode === "online" ? "Replay opponent move" : "Replay last move";
  replayMoveButton.disabled = actionLocked || replayInProgress;
  const hostUid = gameMode === "online" ? onlineRoom.hostUid : gameState.hostUid;
  const isHost = gameMode === "online" ? firebaseUser.uid === hostUid : true;

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
    replayMove,
    onMarbleSelect(marbleId) {
      if (actionLocked || replayInProgress || diceInMotion || !canControlTurn() || gameState.phase !== "move") return;
      selectedMarbleId = selectedMarbleId === marbleId ? null : marbleId;
      statusMessage = selectedMarbleId
        ? "Choose one of the highlighted destinations."
        : describeLastAction();
      renderGame();
    },
    onDestinationSelect(destination) {
      if (actionLocked || replayInProgress || diceInMotion || !selectedMarbleId || !canControlTurn() || gameState.phase !== "move") return;
      runGameAction(() => moveSelectedMarble(destination));
    },
  });
  scheduleBotTurn();
}

async function commitOnlineGame(transition, requireTurn = true, actingUid = null) {
  await updateRoomTransaction(onlineRoomCode, (room, uid) => {
    if (!room || room.status !== "playing" || !room.game) throw new Error("The game state changed.");
    if (!room.players?.[uid]) throw new Error("You are not a member of this room.");
    const actor = actingUid ?? uid;
    if (actingUid && (uid !== room.hostUid || !isBotUid(actor))) throw new Error("Only the host can run an NPC turn.");
    if (requireTurn && room.game.turnUid !== actor) throw new Error("That turn has already changed.");
    return { ...room, game: transition(room.game, actor) };
  });
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
    selectedMarbleId = null;
    moveUnlockDelayMs = 0;
    statusMessage = `Action not saved. ${error.message} The latest room state is shown; please retry.`;
  } finally {
    const settleDelay = moveUnlockDelayMs || 300;
    await new Promise((resolve) => setTimeout(resolve, settleDelay));
    moveUnlockDelayMs = 0;
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
  if (replayInProgress || !lastTurnReplay.length) return;
  replayInProgress = true;
  selectedMarbleId = null;
  try {
    for (const replay of [...lastTurnReplay]) {
      const durationMs = moveAnimationDuration(replay.path);
      pendingMoveReplay = { ...replay, durationMs, forceMotion: true };
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

  gameMode = "local";
  gameState = createGame(players);
  gameState = startGame(gameState, gameState.hostUid);
  resetDiceDisplays();
  selectedMarbleId = null;
  statusMessage = describeLastAction();
  showScreen("game");
  renderGame();
});

for (const input of playerInputs) input.addEventListener("input", () => input.setCustomValidity(""));
for (const [index, checkbox] of botInputs.entries()) {
  checkbox.addEventListener("change", () => {
    const input = document.querySelector(`#${checkbox.dataset.botFor}`);
    input.disabled = checkbox.checked;
    input.value = checkbox.checked ? `NPC ${index + 1}` : "";
    input.setCustomValidity("");
  });
}
rollButton.addEventListener("click", () => runGameAction(handleRoll));
replayMoveButton.addEventListener("click", replayLastTurn);


endGameButton.addEventListener("click", () => {
  if (!confirm("End this game for everyone?")) return;
  runGameAction(async () => {
    if (gameMode === "online") {
      endGame(gameState, firebaseUser.uid);
      await commitOnlineGame((state, uid) => endGame(state, uid), false);
    } else gameState = endGame(gameState, gameState.hostUid);
    selectedMarbleId = null;
    returnToMainMenu();
  });
});

mainMenuButton.addEventListener("click", () => {
  const active = ["opening-roll", "roll", "move"].includes(gameState?.phase);
  const warning = gameMode === "online"
    ? "Return to the main menu? Your seat will remain in the online game."
    : "Return to the main menu? The current local game will be closed.";
  if (active && !confirm(warning)) return;
  returnToMainMenu();
});

function restartGame() {
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
}

newGameButton.addEventListener("click", restartGame);
victoryRestartButton.addEventListener("click", restartGame);
victoryMenuButton.addEventListener("click", returnToMainMenu);

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
