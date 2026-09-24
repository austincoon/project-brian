import assert from "node:assert/strict";
import test from "node:test";
import { applyMove, applyOpeningRoll, applyRoll, createGame, startGame } from "../src/game.js";
import { LOCAL_GAME_KEY, loadLocalGame, readStored, writeStored } from "../src/session.js";

test("local saves restore the exact turn, reject damaged data, and tolerate blocked storage", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  let state = startGame(createGame([{ uid: "a", name: "Alex" }, { uid: "b", name: "Blair" }]), "a");
  const roundTrip = () => {
    assert.equal(writeStored(storage, LOCAL_GAME_KEY, state), true);
    assert.deepEqual(loadLocalGame(storage), state);
  };
  roundTrip();
  state = applyOpeningRoll(state, "a", [6, 5]);
  roundTrip();
  state = applyOpeningRoll(state, "b", [2, 3]);
  roundTrip();
  state = applyRoll(state, "a", [6, 4]);
  roundTrip();
  state = applyMove(state, "a", "a:0", "track:2", 6);
  roundTrip(); // Refresh after the first die must not grant a fresh roll.
  assert.deepEqual(loadLocalGame(storage).remainingDice, [4]);
  for (const mutate of [
    (s) => { s.version = 99; },
    (s) => { s.turnUid = "missing"; },
    (s) => { s.pieces["a:0"].positionId = "track:99"; },
    (s) => { s.pieces["a:0"].progress = 20; },
    (s) => { s.remainingDice = [6, 6]; },
    (s) => { s.players = []; },
    (s) => { s.stats.a.rolls = "bad"; },
    (s) => { s.pieces["a:1"].positionId = "base:blue:0"; },
  ]) {
    const damaged = structuredClone(state);
    mutate(damaged);
    writeStored(storage, LOCAL_GAME_KEY, damaged);
    assert.equal(loadLocalGame(storage), null);
  }
  values.set(LOCAL_GAME_KEY, "broken json");
  assert.equal(loadLocalGame(storage), null);
  const blocked = { getItem() { throw Error("Blocked"); }, setItem() { throw Error("Quota"); } };
  assert.equal(loadLocalGame(blocked), null);
  assert.equal(readStored(blocked, "setting", false), false);
  assert.equal(writeStored(blocked, LOCAL_GAME_KEY, state), false);
  writeStored(storage, LOCAL_GAME_KEY, null);
  assert.equal(loadLocalGame(storage), null);
});
