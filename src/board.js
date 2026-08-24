const SVG_NS = "http://www.w3.org/2000/svg";
const CENTER = 500;
const TRACK_LENGTH = 48;
const BOARD_SURFACE_PATH = "M350 80H650V350H920V650H650V920H350V650H80V350H350Z";

const rotateCounterClockwise = ({ x, y }, turns) => {
  let point = { x, y };
  for (let turn = 0; turn < turns; turn += 1) {
    point = { x: CENTER + (point.y - CENTER), y: CENTER - (point.x - CENTER) };
  }
  return point;
};

export const PLAYER_ORDER = Object.freeze(["red", "blue", "green", "yellow"]);

export const PLAYERS = Object.freeze({
  red: {
    label: "Red",
    color: "#d94b4b",
    darkColor: "#8f2828",
    seat: "south",
    orientation: 90,
    start: "track:2",
    homeEntrance: "track:0",
    baseCenter: { x: 850, y: 850 },
  },
  blue: {
    label: "Blue",
    color: "#367bc7",
    darkColor: "#1f4f88",
    seat: "west",
    orientation: 180,
    start: "track:38",
    homeEntrance: "track:36",
    baseCenter: { x: 150, y: 850 },
  },
  green: {
    label: "Green",
    color: "#3f9b68",
    darkColor: "#23613e",
    seat: "north",
    orientation: 270,
    start: "track:26",
    homeEntrance: "track:24",
    baseCenter: { x: 150, y: 150 },
  },
  yellow: {
    label: "Yellow",
    color: "#e0ad2f",
    darkColor: "#8a6511",
    seat: "east",
    orientation: 0,
    start: "track:14",
    homeEntrance: "track:12",
    baseCenter: { x: 850, y: 150 },
  },
});

export const TRACK_ORDER = Object.freeze(
  Array.from({ length: TRACK_LENGTH }, (_, index) => `track:${index}`),
);

const startColors = Object.fromEntries(
  PLAYER_ORDER.map((color) => [PLAYERS[color].start, color]),
);

const quarterTrack = [
  { x: 500, y: 860 },
  { x: 560, y: 860 },
  { x: 620, y: 860 },
  { x: 620, y: 800 },
  { x: 620, y: 740 },
  { x: 620, y: 680 },
  { x: 620, y: 620 },
  { x: 680, y: 620 },
  { x: 740, y: 620 },
  { x: 800, y: 620 },
  { x: 860, y: 620 },
  { x: 860, y: 560 },
];

const trackHoles = TRACK_ORDER.map((id, index) => ({
  id,
  kind: "track",
  ...rotateCounterClockwise(
    quarterTrack[index % quarterTrack.length],
    Math.floor(index / quarterTrack.length),
  ),
  player: startColors[id] ?? null,
}));

const baseOffsets = Array.from({ length: 5 }, (_, index) => {
  const angle = (-126 + index * 72) * Math.PI / 180;
  return { x: 46 * Math.cos(angle), y: 46 * Math.sin(angle) };
});

export const BASE_POSITIONS = Object.freeze(Object.fromEntries(
  PLAYER_ORDER.map((color) => [
    color,
    Object.freeze(baseOffsets.map((offset, index) => `base:${color}:${index}`)),
  ]),
));

const baseHoles = PLAYER_ORDER.flatMap((color) => {
  const { baseCenter } = PLAYERS[color];
  return BASE_POSITIONS[color].map((id, index) => ({
    id,
    kind: "base",
    player: color,
    x: baseCenter.x + baseOffsets[index].x,
    y: baseCenter.y + baseOffsets[index].y,
  }));
});

export const HOME_POSITIONS = Object.freeze(Object.fromEntries(
  PLAYER_ORDER.map((color) => [
    color,
    Object.freeze(Array.from({ length: 5 }, (_, index) => `home:${color}:${index}`)),
  ]),
));

const homeHoles = PLAYER_ORDER.flatMap((color) => {
  const quarter = { south: 0, east: 1, north: 2, west: 3 }[PLAYERS[color].seat];
  return HOME_POSITIONS[color].map((id, index) => ({
    id,
    kind: "home",
    player: color,
    ...rotateCounterClockwise({ x: 500, y: 800 - index * 60 }, quarter),
  }));
});

const centerAccess = [
  { track: "track:6", exit: "track:6" },
  { track: "track:18", exit: "track:18" },
  { track: "track:30", exit: "track:30" },
  { track: "track:42", exit: "track:42" },
];

export const CENTER_SHORTCUT = Object.freeze({
  id: "center",
  access: Object.freeze(centerAccess),
});

const centerHole = { id: CENTER_SHORTCUT.id, kind: "center", x: CENTER, y: CENTER };

export const BOARD_HOLES = Object.freeze([
  ...trackHoles,
  ...baseHoles,
  ...homeHoles,
  centerHole,
]);

export const HOLES_BY_ID = Object.freeze(Object.fromEntries(
  BOARD_HOLES.map((hole) => [hole.id, hole]),
));

export const START_POSITIONS = Object.freeze(Object.fromEntries(
  PLAYER_ORDER.map((color) => [color, PLAYERS[color].start]),
));

const connections = Object.fromEntries(BOARD_HOLES.map(({ id }) => [id, []]));

TRACK_ORDER.forEach((id, index) => {
  connections[id].push(TRACK_ORDER[(index + 1) % TRACK_LENGTH]);
});

for (const color of PLAYER_ORDER) {
  for (const baseId of BASE_POSITIONS[color]) {
    connections[baseId].push(START_POSITIONS[color]);
  }

  connections[PLAYERS[color].homeEntrance].push(HOME_POSITIONS[color][0]);
  HOME_POSITIONS[color].forEach((id, index) => {
    if (HOME_POSITIONS[color][index + 1]) {
      connections[id].push(HOME_POSITIONS[color][index + 1]);
    }
  });
}

for (const { track, exit } of centerAccess) {
  connections[track].push(CENTER_SHORTCUT.id);
  connections[CENTER_SHORTCUT.id].push(exit);
}

export const ROUTE_CONNECTIONS = Object.freeze(Object.fromEntries(
  Object.entries(connections).map(([id, destinations]) => [id, Object.freeze(destinations)]),
));

export function validateBoardData() {
  const ids = BOARD_HOLES.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Every board hole must have a unique stable ID.");
  }

  for (const color of PLAYER_ORDER) {
    if (BASE_POSITIONS[color].length !== 5 || HOME_POSITIONS[color].length !== 5) {
      throw new Error(`${color} must have five Base and five Home positions.`);
    }
    if (!HOLES_BY_ID[START_POSITIONS[color]]) {
      throw new Error(`${color} has an invalid Start position.`);
    }
  }

  for (const [from, destinations] of Object.entries(ROUTE_CONNECTIONS)) {
    if (!HOLES_BY_ID[from] || destinations.some((id) => !HOLES_BY_ID[id])) {
      throw new Error(`Route contains an unknown hole at ${from}.`);
    }
  }

  return true;
}

validateBoardData();

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}

function points(ids) {
  return ids.map((id) => `${HOLES_BY_ID[id].x},${HOLES_BY_ID[id].y}`).join(" ");
}

function accessibleHoleName(hole, playerNames = {}) {
  if (hole.kind === "center") return "Gambit center";
  if (hole.kind === "track") return hole.player
    ? `${playerNames[hole.player] ?? PLAYERS[hole.player].label} Start, track ${hole.id.split(":")[1]}`
    : `Track ${hole.id.split(":")[1]}`;
  return `${playerNames[hole.player] ?? PLAYERS[hole.player].label} ${hole.kind} ${Number(hole.id.split(":")[2]) + 1}`;
}

function drawRoutes(svg) {
  const routes = svgElement("g", { class: "board-routes", "aria-hidden": "true" });
  routes.append(svgElement("polyline", {
    class: "route-line route-line--track",
    points: points([...TRACK_ORDER, TRACK_ORDER[0]]),
  }));

  for (const color of PLAYER_ORDER) {
    routes.append(svgElement("polyline", {
      class: "route-line route-line--home",
      points: points([PLAYERS[color].homeEntrance, ...HOME_POSITIONS[color]]),
      style: `--player-color: ${PLAYERS[color].color}`,
    }));
  }

  for (const { track } of CENTER_SHORTCUT.access) {
    routes.append(svgElement("polyline", {
      class: "route-line route-line--gambit",
      points: points([track, CENTER_SHORTCUT.id]),
    }));
  }

  svg.append(routes);
}

function drawPlayerZones(svg, state) {
  const zones = svgElement("g", { class: "player-zones", "aria-hidden": "true" });

  for (const color of PLAYER_ORDER) {
    const player = PLAYERS[color];
    const zone = svgElement("g", {
      class: `player-zone${color === state.activePlayer ? " is-active-player" : ""}`,
      style: `--player-color: ${player.color}; --player-dark: ${player.darkColor}`,
    });
    zone.append(svgElement("circle", {
      class: "base-tray",
      cx: player.baseCenter.x,
      cy: player.baseCenter.y,
      r: 78,
    }));

    const label = svgElement("text", {
      class: "base-label",
      x: player.baseCenter.x,
      y: player.baseCenter.y - 90,
      "text-anchor": "middle",
    });
    const name = state.playerNames[color];
    label.textContent = name ? `${name}'s Base` : `${player.label} Base`;
    zone.append(label);
    zones.append(zone);
  }

  svg.append(zones);
}

function drawHoles(svg, state) {
  const holes = svgElement("g", { class: "board-holes" });

  for (const hole of BOARD_HOLES) {
    const classes = ["board-hole", `board-hole--${hole.kind}`];
    const legalDestination = state.legalDestinationIds.has(hole.id);
    if (hole.player) classes.push("board-hole--player");
    if (hole.kind === "track" && hole.player) classes.push("is-start");
    if (legalDestination) classes.push("is-legal-move");
    if (hole.id === state.replayMove?.destinationId) classes.push("is-replay-destination");

    const circle = svgElement("circle", {
      id: hole.id,
      class: classes.join(" "),
      cx: hole.x,
      cy: hole.y,
      r: hole.kind === "center" ? 19 : 12,
      "data-hole-id": hole.id,
      "aria-hidden": String(!legalDestination),
    });
    if (hole.player) {
      circle.setAttribute("style", `--player-color: ${PLAYERS[hole.player].color}`);
    }

    const title = svgElement("title");
    title.textContent = accessibleHoleName(hole, state.playerNames);
    circle.append(title);

    if (legalDestination && state.onDestinationSelect) {
      circle.setAttribute("role", "button");
      circle.setAttribute("tabindex", "0");
      circle.setAttribute("aria-label", `Move to ${accessibleHoleName(hole, state.playerNames)}`);
      circle.addEventListener("click", () => state.onDestinationSelect(hole.id));
      circle.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          state.onDestinationSelect(hole.id);
        }
      });
    }

    holes.append(circle);
  }

  const centerLabel = svgElement("text", {
    class: "center-label",
    x: CENTER,
    y: CENTER + 38,
    "text-anchor": "middle",
    "aria-hidden": "true",
  });
  centerLabel.textContent = "";
  holes.append(centerLabel);
  svg.append(holes);
}

function drawMarbles(svg, marbles, state) {
  const layer = svgElement("g", { class: "board-marbles" });
  const replayAnimations = [];

  for (const marble of marbles) {
    const actualPosition = HOLES_BY_ID[marble.positionId];
    const replayDestination = marble.id === state.replayMove?.pieceId
      ? HOLES_BY_ID[state.replayMove.destinationId]
      : null;
    const position = replayDestination ?? actualPosition;
    if (!actualPosition || !position || !PLAYERS[marble.color]) {
      throw new Error(`Marble ${marble.id} has invalid board data.`);
    }

    const selectable = state.selectableMarbleIds.has(marble.id);
    const replayFrom = marble.id === state.replayMove?.pieceId
      ? HOLES_BY_ID[state.replayMove.fromPositionId]
      : null;
    const replaying = replayFrom
      && replayFrom.id !== position.id
      && (state.replayMove.forceMotion
        || !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    const classes = ["marble"];
    if (marble.color === state.activePlayer) classes.push("is-active-player");
    if (marble.id === state.selectedMarbleId) classes.push("is-selected");
    if (state.legalMarbleIds.has(marble.id)) classes.push("is-legal-move");
    if (replaying) classes.push("is-replaying");

    const group = svgElement("g", {
      class: classes.join(" "),
      role: "button",
      tabindex: selectable ? "0" : "-1",
      "aria-disabled": String(!selectable),
      "aria-pressed": String(marble.id === state.selectedMarbleId),
      "aria-label": marble.label ?? `${state.playerNames[marble.color] ?? PLAYERS[marble.color].label} marble ${marble.number} at ${accessibleHoleName(position, state.playerNames)}`,
      "data-marble-id": marble.id,
      "data-position-id": marble.positionId,
      style: `--player-color: ${PLAYERS[marble.color].color}; --player-dark: ${PLAYERS[marble.color].darkColor}`,
      transform: `translate(${position.x} ${position.y})`,
    });

    group.append(
      svgElement("circle", { class: "marble-focus", r: 18 }),
      svgElement("circle", { class: "marble-active-ring", r: 16 }),
      svgElement("circle", { class: "marble-disc", r: 13 }),
      svgElement("circle", { class: "marble-shine", cx: -4, cy: -5, r: 3.5 }),
    );

    if (replaying) {
      const animation = svgElement("animateTransform", {
        attributeName: "transform",
        type: "translate",
        from: `${replayFrom.x} ${replayFrom.y}`,
        to: `${position.x} ${position.y}`,
        dur: "850ms",
        begin: "indefinite",
        calcMode: "spline",
        keyTimes: "0;1",
        keySplines: "0.22 0.8 0.24 1",
      });
      group.append(animation);
      replayAnimations.push(animation);
    }

    if (selectable && state.onMarbleSelect) {
      group.addEventListener("click", () => state.onMarbleSelect(marble.id));
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          state.onMarbleSelect(marble.id);
        }
      });
    }

    layer.append(group);
  }

  svg.append(layer);
  return replayAnimations;
}

export function renderBoard(container, options = {}) {
  const state = {
    activePlayer: options.activePlayer ?? null,
    legalDestinationIds: new Set(options.legalDestinationIds ?? []),
    legalMarbleIds: new Set(options.legalMarbleIds ?? []),
    selectableMarbleIds: new Set(options.selectableMarbleIds ?? []),
    selectedMarbleId: options.selectedMarbleId ?? null,
    onMarbleSelect: options.onMarbleSelect ?? null,
    onDestinationSelect: options.onDestinationSelect ?? null,
    playerNames: options.playerNames ?? {},
    replayMove: options.replayMove ?? null,
  };

  const svg = svgElement("svg", {
    class: "game-board",
    viewBox: "0 0 1000 1000",
    role: "group",
    "aria-labelledby": "board-title board-description",
  });
  const title = svgElement("title", { id: "board-title" });
  title.textContent = "Project Brian game board";
  const description = svgElement("desc", { id: "board-description" });
  description.textContent = "A four-player board with five Base and Home positions per player, a shared track, and the center Gambit.";
  svg.append(
    title,
    description,
    svgElement("path", { class: "board-surface", d: BOARD_SURFACE_PATH }),
  );

  drawRoutes(svg);
  drawPlayerZones(svg, state);
  drawHoles(svg, state);
  const replayAnimations = drawMarbles(svg, options.marbles ?? [], state);
  container.replaceChildren(svg);
  (globalThis.requestAnimationFrame ?? ((callback) => callback()))(() => {
    for (const animation of replayAnimations) animation.beginElement();
  });
}
