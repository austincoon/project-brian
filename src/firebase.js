const firebaseConfig = {
  apiKey: "AIzaSyCCnvp4RXFjQxCxGvsSZYJ8lo-iAbXRK4Q",
  authDomain: "aggravation-game.firebaseapp.com",
  databaseURL: "https://aggravation-game-default-rtdb.firebaseio.com",
  projectId: "aggravation-game",
  appId: "1:663318022683:web:de7306cb2107005e3b46be",
};

const SDK_VERSION = "12.17.1";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const COLORS = ["red", "blue", "green", "yellow"];
let servicesPromise;
let signInPromise;

function normalizeCode(code) {
  const normalized = String(code ?? "").trim().toUpperCase();
  if (!CODE_PATTERN.test(normalized)) {
    throw new Error("Invite codes contain six letters or numbers without 0, O, 1, or I.");
  }
  return normalized;
}

function normalizeName(name) {
  const normalized = String(name ?? "").trim();
  if (!normalized || normalized.length > 24) {
    throw new Error("Player names must contain 1 through 24 characters.");
  }
  return normalized;
}

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join("");
}

async function services() {
  if (Object.values(firebaseConfig).some((value) => value.startsWith("PASTE_"))) {
    throw new Error("Firebase is not configured yet. Add your web app configuration in src/firebase.js.");
  }

  servicesPromise ??= Promise.all([
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`),
  ]).then(([appApi, authApi]) => {
    const app = appApi.initializeApp(firebaseConfig);
    return {
      auth: authApi.getAuth(app),
      authApi,
    };
  });

  return servicesPromise;
}

async function databaseUrl(path) {
  const user = await signIn();
  const token = await user.getIdToken();
  return `${firebaseConfig.databaseURL}/${path}.json?auth=${encodeURIComponent(token)}`;
}

async function databaseRequest(path, options = {}) {
  const response = await fetch(await databaseUrl(path), { cache: "no-store", ...options });
  if (response.ok || response.status === 412) return response;
  const body = await response.json().catch(() => null);
  throw new Error(body?.error ?? `Firebase request failed (${response.status}).`);
}

async function readRoom(code) {
  const response = await databaseRequest(`rooms/${normalizeCode(code)}`);
  return response.json();
}

async function runRestTransaction(path, updater) {
  const user = await signIn();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const currentResponse = await databaseRequest(path, {
      headers: { "X-Firebase-ETag": "true" },
    });
    const current = await currentResponse.json();
    const next = updater(current, user.uid);
    if (next === undefined) return { committed: false, value: current };

    const response = await databaseRequest(path, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": currentResponse.headers.get("ETag"),
      },
      body: JSON.stringify(next),
    });
    if (response.status === 412) continue;
    return { committed: true, value: await response.json() };
  }
  throw new Error("The room changed too many times. Please retry.");
}

export async function signIn() {
  const { auth, authApi } = await services();
  signInPromise ??= authApi.setPersistence(auth, authApi.browserLocalPersistence).then(async () => {
    if (auth.currentUser) return auth.currentUser;
    return (await authApi.signInAnonymously(auth)).user;
  });
  return signInPromise;
}

export async function createRoom(name) {
  const user = await signIn();
  const playerName = normalizeName(name);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = randomCode();
    const now = Date.now();
    const room = {
      code,
      status: "waiting",
      hostUid: user.uid,
      createdAt: now,
      updatedAt: now,
      playerCount: 1,
      seats: { 0: user.uid, 1: "", 2: "", 3: "" },
      players: {
        [user.uid]: {
          uid: user.uid,
          name: playerName,
          color: COLORS[0],
          seat: 0,
          joinedAt: now,
        },
      },
    };
    const result = await runRestTransaction(
      `rooms/${code}`,
      (current) => current === null ? room : undefined,
    );
    if (result.committed) return { code, room: result.value };
  }

  throw new Error("Could not reserve an invite code. Please try again.");
}

export async function joinRoom(code, name) {
  const normalizedCode = normalizeCode(code);
  const playerName = normalizeName(name);
  const user = await signIn();
  if (!(await readRoom(normalizedCode))) throw new Error("That room does not exist.");

  let rejection = "The room changed while you were joining. Please try again.";
  const result = await runRestTransaction(`rooms/${normalizedCode}`, (room) => {
    if (!room) {
      rejection = "That room does not exist.";
      return undefined;
    }
    if (room.status !== "waiting") {
      rejection = "That game has already started.";
      return undefined;
    }
    if (room.players?.[user.uid]) {
      rejection = "This browser is already seated in that room.";
      return undefined;
    }

    if (room.playerCount >= 4) {
      rejection = "That room already has four players.";
      return undefined;
    }

    const seat = COLORS.findIndex((_, index) => room.seats?.[index] === "");
    if (seat < 0) {
      rejection = "That room has no available seat.";
      return undefined;
    }
    const now = Date.now();
    return {
      ...room,
      updatedAt: now,
      playerCount: room.playerCount + 1,
      seats: { ...room.seats, [seat]: user.uid },
      players: {
        ...room.players,
        [user.uid]: {
          uid: user.uid,
          name: playerName,
          color: COLORS[seat],
          seat,
          joinedAt: now,
        },
      },
    };
  });

  if (!result.committed) throw new Error(rejection);
  return { code: normalizedCode, room: result.value };
}

export async function subscribeToRoom(code, onRoom, onError) {
  if (typeof onRoom !== "function") throw new TypeError("A room callback is required.");
  const normalizedCode = normalizeCode(code);
  let stopped = false;
  let source;
  let refreshing = false;

  const refresh = async () => {
    if (stopped || refreshing) return;
    refreshing = true;
    try {
      onRoom(await readRoom(normalizedCode));
    } catch (error) {
      onError?.(error);
    } finally {
      refreshing = false;
    }
  };

  await refresh();
  source = new EventSource(await databaseUrl(`rooms/${normalizedCode}`));
  source.addEventListener("put", refresh);
  source.addEventListener("patch", refresh);
  source.addEventListener("cancel", () => onError?.(new Error("Room access was canceled.")));
  source.addEventListener("auth_revoked", () => onError?.(new Error("Room authentication expired. Refresh the page.")));
  source.onerror = () => onError?.(new Error("The room connection was interrupted."));
  return () => {
    stopped = true;
    source.close();
  };
}

export async function updateRoomTransaction(code, updater) {
  if (typeof updater !== "function") throw new TypeError("A room updater is required.");
  const user = await signIn();
  const normalizedCode = normalizeCode(code);
  const room = await readRoom(normalizedCode);

  if (room?.status === "playing" && room.game) {
    const result = await runRestTransaction(
      `rooms/${normalizedCode}/game`,
      (game) => updater({ ...room, game }, user.uid)?.game,
    );
    if (!result.committed) throw new Error("The game update was canceled.");
    return { ...room, game: result.value };
  }

  const result = await runRestTransaction(
    `rooms/${normalizedCode}`,
    (currentRoom) => updater(currentRoom, user.uid),
  );
  if (!result.committed) throw new Error("The room update was canceled.");
  return result.value;
}

export async function leaveRoom(code) {
  const user = await signIn();
  const normalizedCode = normalizeCode(code);
  const result = await runRestTransaction(`rooms/${normalizedCode}`, (room) => {
    if (!room?.players?.[user.uid]) return undefined;
    if (room.status !== "waiting") return undefined;
    if (room.hostUid === user.uid) return null;

    const players = { ...room.players };
    const seat = players[user.uid].seat;
    delete players[user.uid];
    return {
      ...room,
      players,
      playerCount: room.playerCount - 1,
      seats: { ...room.seats, [seat]: "" },
      updatedAt: Date.now(),
    };
  });

  if (!result.committed) throw new Error("You cannot leave this room now.");
}
