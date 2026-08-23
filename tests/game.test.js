import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BASE_POSITIONS,
  BOARD_HOLES,
  CENTER_SHORTCUT,
  HOLES_BY_ID,
  HOME_POSITIONS,
  PLAYER_ORDER,
  PLAYERS,
  ROUTE_CONNECTIONS,
  START_POSITIONS,
  TRACK_ORDER,
  renderBoard,
  validateBoardData,
} from "../src/board.js";
import {
  applyMove,
  applyOpeningRoll,
  applyRoll,
  createGame,
  endGame,
  getLegalMoves,
  skipTurn,
  startGame,
} from "../src/game.js";
import { rollDie } from "../src/dice.js";
import { loadTurnReplay, saveTurnReplay } from "../src/replay.js";

const players = [
  { uid: "a", name: "Alex" },
  { uid: "b", name: "Blair" },
];

test("a room replay survives refresh only for the same game", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const moves = [{ pieceId: "a:0", fromPositionId: "track:2", destinationId: "track:4" }];

  saveTurnReplay(storage, "ABC234", 123, moves);
  assert.deepEqual(loadTurnReplay(storage, "ABC234", 123), moves);
  assert.deepEqual(loadTurnReplay(storage, "ABC234", 456), []);
});

test("move replays start after the SVG is attached", () => {
  let container;
  let scheduledAnimation;
  let attachedAtStart = false;
  let replayDestination;

  class FakeElement {
    constructor() { this.attributes = {}; this.children = []; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    append(...children) { this.children.push(...children); }
    addEventListener() {}
    replaceChildren(...children) { this.children = children; }
    beginElement() {
      attachedAtStart = container.children.length === 1;
      replayDestination = this.attributes.to;
    }
  }

  const previousDocument = globalThis.document;
  const previousMatchMedia = globalThis.matchMedia;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.document = { createElementNS: () => new FakeElement() };
  globalThis.matchMedia = () => ({ matches: true });
  globalThis.requestAnimationFrame = (callback) => { scheduledAnimation = callback; };

  try {
    container = new FakeElement();
    renderBoard(container, {
      marbles: [{ id: "a:0", ownerUid: "a", color: "red", number: 1, positionId: "track:6" }],
      replayMove: { pieceId: "a:0", fromPositionId: "track:2", destinationId: "track:4", forceMotion: true },
    });
    assert.equal(attachedAtStart, false);
    scheduledAnimation();
    assert.equal(attachedAtStart, true);
    assert.equal(replayDestination, `${HOLES_BY_ID["track:4"].x} ${HOLES_BY_ID["track:4"].y}`);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousMatchMedia === undefined) delete globalThis.matchMedia;
    else globalThis.matchMedia = previousMatchMedia;
    if (previousRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousRequestAnimationFrame;
  }
});

test("Web Crypto die sampling is unbiased and always returns 1 through 6", () => {
  const counts = Array(6).fill(0);
  for (let byte = 0; byte < 252; byte += 1) {
    counts[rollDie((buffer) => { buffer[0] = byte; }) - 1] += 1;
  }
  assert.deepEqual(counts, [42, 42, 42, 42, 42, 42]);

  const bytes = [255, 5];
  assert.equal(rollDie((buffer) => { buffer[0] = bytes.shift(); }), 6);
});

test("database rules enforce the room security boundary", () => {
  const source = readFileSync(new URL("../database.rules.json", import.meta.url), "utf8");
  const firebaseSource = readFileSync(new URL("../src/firebase.js", import.meta.url), "utf8");
  const rules = JSON.parse(source);
  assert.equal(rules.rules[".read"], false);
  assert.equal(rules.rules[".write"], false);
  assert.equal(rules.rules.rooms[".read"], undefined);
  assert.match(rules.rules.rooms.$code[".read"], /auth !== null/);
  assert.match(rules.rules.rooms.$code[".write"], /auth !== null/);
  assert.match(rules.rules.rooms.$code[".write"], /players.*auth\.uid.*exists/);
  assert.match(rules.rules.rooms.$code[".write"], /auth\.uid === data\.child\('hostUid'\)/);
  assert.match(rules.rules.rooms.$code[".write"], /!newData\.exists\(\)/);
  assert.match(rules.rules.rooms.$code.players.$uid[".validate"], /length <= 24/);
  assert.match(rules.rules.rooms.$code.game[".write"], /status.*playing/);
  assert.match(rules.rules.rooms.$code.game[".write"], /players.*auth\.uid.*exists/);
  assert.match(rules.rules.rooms.$code.game[".write"], /root\.child\('rooms'\).*child\(\$code\)/);
  assert.match(rules.rules.rooms.$code.game[".validate"], /opening-roll.*finished/);
  assert.match(rules.rules.rooms.$code.game[".validate"], /remainingDice/);
  assert.match(rules.rules.rooms.$code.game.remainingDice[".validate"], /newData\.hasChild\('0'\)/);
  assert.equal(rules.rules.rooms.$code.game.$other[".validate"], false);
  assert.doesNotMatch(source, /numChildren/);
  assert.match(source, /playerCount/);
  assert.match(firebaseSource, /X-Firebase-ETag/);
  assert.match(firebaseSource, /If-Match/);
  assert.match(firebaseSource, /new EventSource/);
});

function activeGame() {
  let state = startGame(createGame(players), "a");
  state = applyOpeningRoll(state, "a", [3, 3]);
  return applyOpeningRoll(state, "b", [1, 1]);
}

function movePhase(dice) {
  const state = activeGame();
  state.phase = "move";
  state.dice = dice;
  state.remainingDice = [...dice];
  return state;
}

function place(state, pieceId, positionId, progress) {
  state.pieces[pieceId].positionId = positionId;
  state.pieces[pieceId].progress = progress;
}

test("board IDs and connections remain internally consistent", () => {
  assert.equal(validateBoardData(), true);
  assert.equal(BOARD_HOLES.length, 93);
  assert.equal(new Set(BOARD_HOLES.map(({ id }) => id)).size, BOARD_HOLES.length);
  assert.equal(TRACK_ORDER.length, 48);
  assert.deepEqual(Object.values(BASE_POSITIONS).map(({ length }) => length), [5, 5, 5, 5]);
  assert.deepEqual(Object.values(HOME_POSITIONS).map(({ length }) => length), [5, 5, 5, 5]);
  assert.equal(Object.keys(ROUTE_CONNECTIONS).length, BOARD_HOLES.length);
  assert.deepEqual(
    [0, 12, 24, 36].map((index) => [HOLES_BY_ID[`track:${index}`].x, HOLES_BY_ID[`track:${index}`].y]),
    [[500, 860], [860, 500], [500, 140], [140, 500]],
  );
  assert.equal(TRACK_ORDER.every((id, index) => {
    const from = HOLES_BY_ID[id];
    const to = HOLES_BY_ID[TRACK_ORDER[(index + 1) % TRACK_ORDER.length]];
    return Math.hypot(to.x - from.x, to.y - from.y) === 60;
  }), true);
  assert.deepEqual(
    HOME_POSITIONS.red.map((id) => HOLES_BY_ID[id].x),
    [500, 500, 500, 500, 500],
  );
  assert.deepEqual(
    HOME_POSITIONS.red.map((id) => HOLES_BY_ID[id].y),
    [800, 740, 680, 620, 560],
  );
  assert.deepEqual(START_POSITIONS, {
    red: "track:2",
    blue: "track:38",
    green: "track:26",
    yellow: "track:14",
  });
  assert.deepEqual(
    Object.fromEntries(Object.entries(PLAYERS).map(([color, player]) => [color, player.homeEntrance])),
    { red: "track:0", blue: "track:36", green: "track:24", yellow: "track:12" },
  );
});

test("turn order advances counterclockwise", () => {
  const fourPlayers = [
    { uid: "a", name: "Alex" },
    { uid: "b", name: "Blair" },
    { uid: "c", name: "Casey" },
    { uid: "d", name: "Devon" },
  ];
  let state = startGame(createGame(fourPlayers), "a");
  assert.deepEqual(state.opening.candidateUids, ["a", "d", "c", "b"]);
  state = applyOpeningRoll(state, "a", [6, 6]);
  state = applyOpeningRoll(state, "d", [1, 1]);
  state = applyOpeningRoll(state, "c", [2, 2]);
  state = applyOpeningRoll(state, "b", [3, 3]);
  state = applyRoll(state, "a", [2, 3]);
  assert.equal(state.turnUid, "d");
});

test("a marble cannot leave Base when both dice show only 2 through 5", () => {
  for (const first of [2, 3, 4, 5]) {
    for (const second of [2, 3, 4, 5]) {
      assert.equal(getLegalMoves(movePhase([first, second]), "a").length, 0);
    }
  }
});

test("a marble can leave Base when either die shows 1 or 6", () => {
  for (const dice of [[1, 2], [6, 2]]) {
    const moves = getLegalMoves(movePhase(dice), "a");
    assert.equal(moves.filter(({ kind }) => kind === "leave-base").length, 5);
    assert.equal(moves.every(({ destination }) => destination === "track:2"), true);
  }
});

test("an opponent occupying Start is captured", () => {
  let state = activeGame();
  place(state, "b:0", "track:2", 12);
  state = applyRoll(state, "a", [1, 2]);
  state = applyMove(state, "a", "a:0", "track:2");

  assert.match(state.pieces["b:0"].positionId, /^base:blue:/);
  assert.equal(state.pieces["b:0"].progress, null);
});

test("a friendly marble blocks Start", () => {
  const state = movePhase([1, 2]);
  place(state, "a:0", "track:2", 0);
  assert.equal(getLegalMoves(state, "a").some(({ kind }) => kind === "leave-base"), false);
});

test("friendly marbles cannot be jumped", () => {
  const state = movePhase([1, 2]);
  place(state, "a:0", "track:2", 0);
  place(state, "a:1", "track:4", 2);
  assert.equal(getLegalMoves(state, "a").some(({ pieceId, destination, die }) => (
    pieceId === "a:0" && destination === "track:4" && die === 2
  )), false);
});

test("opponent marbles can be jumped", () => {
  const state = movePhase([1, 2]);
  place(state, "a:0", "track:2", 0);
  place(state, "b:0", "track:3", 13);
  const move = getLegalMoves(state, "a").find(({ pieceId, destination, die }) => (
    pieceId === "a:0" && destination === "track:4" && die === 2
  ));

  assert.ok(move);
  const moved = applyMove(state, "a", move.pieceId, move.destination, move.die);
  assert.equal(moved.pieces["b:0"].positionId, "track:3");
});

test("landing on an opponent captures it", () => {
  const state = movePhase([1, 2]);
  place(state, "a:0", "track:2", 0);
  place(state, "b:0", "track:4", 14);
  const moved = applyMove(state, "a", "a:0", "track:4", 2);
  assert.match(moved.pieces["b:0"].positionId, /^base:blue:/);
});

test("Home requires an exact roll and cannot be overshot", () => {
  const exact = movePhase([2, 3]);
  place(exact, "a:0", "track:47", 45);
  assert.equal(getLegalMoves(exact, "a").some(({ pieceId, destination, die }) => (
    pieceId === "a:0" && destination === "home:red:0" && die === 2
  )), true);

  const overshoot = movePhase([2, 2]);
  place(overshoot, "a:0", "home:red:3", 50);
  assert.equal(getLegalMoves(overshoot, "a").some(({ pieceId }) => pieceId === "a:0"), false);
});

test("opponent Base and Home positions are never legal capture destinations", () => {
  const state = movePhase([1, 2]);
  place(state, "a:0", "track:2", 0);
  place(state, "b:0", "home:blue:0", 47);

  assert.throws(() => applyMove(state, "a", "a:0", "base:blue:0"), /not legal/);
  assert.throws(() => applyMove(state, "a", "a:0", "home:blue:0"), /not legal/);
  assert.equal(state.pieces["b:0"].positionId, "home:blue:0");
});

test("every Gambit approach accepts the exact roll without counting its star marker", () => {
  const fourPlayers = PLAYER_ORDER.map((_, index) => ({ uid: String(index), name: `Player ${index + 1}` }));

  PLAYER_ORDER.forEach((color, playerIndex) => {
    const uid = String(playerIndex);
    const startIndex = TRACK_ORDER.indexOf(START_POSITIONS[color]);

    for (const access of CENTER_SHORTCUT.access) {
      const accessProgress = (TRACK_ORDER.indexOf(access.track) - startIndex + TRACK_ORDER.length) % TRACK_ORDER.length;
      for (let distance = 0; distance <= Math.min(5, accessProgress); distance += 1) {
        const progress = accessProgress - distance;
        const die = distance + 1;
        const state = createGame(fourPlayers);
        state.phase = "move";
        state.turnUid = uid;
        state.dice = [die, die];
        state.remainingDice = [die, die];
        place(state, `${uid}:0`, TRACK_ORDER[(startIndex + progress) % TRACK_ORDER.length], progress);

        const centerMove = getLegalMoves(state, uid).find(({ pieceId, destination }) => (
          pieceId === `${uid}:0` && destination === CENTER_SHORTCUT.id
        ));
        assert.equal(centerMove.die, die);
        assert.equal(centerMove.path.length, die);
        assert.equal(centerMove.path.at(-1), CENTER_SHORTCUT.id);
      }
    }
  });
});

test("the center Gambit exits to a corner only on 1 or 6", () => {
  const corners = ["track:6", "track:18", "track:30", "track:42"];
  for (const allowedDie of [1, 6]) {
    const state = movePhase([allowedDie, 3]);
    place(state, "a:0", "center", 6);
    assert.deepEqual(
      getLegalMoves(state, "a").filter(({ pieceId, die }) => pieceId === "a:0" && die === allowedDie).map(({ destination }) => destination),
      corners,
    );
    assert.equal(getLegalMoves(state, "a").some(({ pieceId, die }) => pieceId === "a:0" && die === 3), false);
  }
});

test("a 6 can leave Base and the remaining 5 can enter the Gambit", () => {
  let state = movePhase([6, 5]);
  state = applyMove(state, "a", "a:0", "track:2", 6);
  assert.equal(getLegalMoves(state, "a").some(({ pieceId, destination, die }) => (
    pieceId === "a:0" && destination === "center" && die === 5
  )), true);
  state = applyMove(state, "a", "a:0", "center", 5);
  assert.equal(state.pieces["a:0"].positionId, "center");
});

test("the two dice can move different marbles or the same marble", () => {
  let split = movePhase([4, 6]);
  place(split, "a:1", "track:5", 3);
  split = applyMove(split, "a", "a:0", "track:2", 6);
  assert.deepEqual(split.remainingDice, [4]);
  split = applyMove(split, "a", "a:1", "track:9", 4);
  assert.equal(split.phase, "roll");
  assert.equal(split.turnUid, "b");

  let combined = movePhase([4, 6]);
  place(combined, "a:0", "track:2", 0);
  combined = applyMove(combined, "a", "a:0", "track:6", 4);
  combined = applyMove(combined, "a", "a:0", "track:12", 6);
  assert.equal(combined.pieces["a:0"].positionId, "track:12");
});

test("double 6 grants another turn", () => {
  let state = applyRoll(activeGame(), "a", [6, 6]);
  state = applyMove(state, "a", "a:0", "track:2", 6);
  state = applyMove(state, "a", "a:0", "track:8", 6);
  assert.equal(state.phase, "roll");
  assert.equal(state.turnUid, "a");
});

test("a turn advances when no legal move exists", () => {
  const before = activeGame();
  const after = applyRoll(before, "a", [2, 3]);
  assert.equal(before.phase, "roll");
  assert.equal(after.phase, "roll");
  assert.equal(after.turnUid, "b");
});

test("opening-roll ties reroll until one player wins", () => {
  let state = startGame(createGame(players), "a");
  state = applyOpeningRoll(state, "b", [4, 2]);
  state = applyOpeningRoll(state, "a", [3, 3]);
  assert.equal(state.opening.round, 2);
  assert.deepEqual(state.opening.candidateUids, ["a", "b"]);

  state = applyOpeningRoll(state, "b", [1, 1]);
  state = applyOpeningRoll(state, "a", [1, 2]);
  assert.equal(state.phase, "roll");
  assert.equal(state.turnUid, "a");
});

test("opening rolls survive Firebase omitting an empty rolls object", () => {
  const state = startGame(createGame(players), "a");
  delete state.opening.rolls;
  const rolled = applyOpeningRoll(state, "a", [2, 3]);
  assert.deepEqual(rolled.opening.rolls.a, { dice: [2, 3], total: 5 });
});

test("the fifth Home marble ends the game and cancels doubles", () => {
  let state = movePhase([2, 2]);
  place(state, "a:0", "home:red:1", 48);
  place(state, "a:1", "home:red:2", 49);
  place(state, "a:2", "home:red:3", 50);
  place(state, "a:3", "home:red:4", 51);
  place(state, "a:4", "track:47", 45);

  state = applyMove(state, "a", "a:4", "home:red:0", 2);
  assert.equal(state.phase, "finished");
  assert.equal(state.winnerUid, "a");
  assert.equal(state.dice, null);
});

test("the host can skip another player's opening or normal turn", () => {
  let opening = startGame(createGame(players), "a");
  opening = applyOpeningRoll(opening, "a", [2, 2]);
  opening = skipTurn(opening, "a");
  assert.equal(opening.phase, "roll");
  assert.equal(opening.turnUid, "a");

  let active = applyRoll(activeGame(), "a", [2, 3]);
  active = skipTurn(active, "a");
  assert.equal(active.turnUid, "a");
});

test("only the host can end an active game", () => {
  const active = activeGame();
  assert.throws(() => endGame(active, "b"), /Only the host/);

  const ended = endGame(active, "a");
  assert.equal(active.phase, "roll");
  assert.equal(ended.phase, "ended");
  assert.equal(ended.winnerUid, null);
  assert.deepEqual(ended.lastAction, { type: "ended", uid: "a" });
  assert.throws(() => applyRoll(ended, "a", [1, 6]), /Expected roll phase/);
});
