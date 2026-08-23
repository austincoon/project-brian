const storageKey = (code) => `project-brian-replay:${code}`;

const validMove = (move) => move
  && typeof move.pieceId === "string"
  && typeof move.fromPositionId === "string"
  && typeof move.destinationId === "string";

export function loadTurnReplay(storage, code, gameId) {
  try {
    const saved = JSON.parse(storage.getItem(storageKey(code)));
    return saved?.gameId === gameId && Array.isArray(saved.moves)
      ? saved.moves.filter(validMove)
      : [];
  } catch {
    return [];
  }
}

export function saveTurnReplay(storage, code, gameId, moves) {
  try {
    storage.setItem(storageKey(code), JSON.stringify({ gameId, moves }));
  } catch {
    // The game remains playable when private browsing blocks storage.
  }
}
