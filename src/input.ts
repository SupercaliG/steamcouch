// Turns keyboard and controller input into a small set of UI actions.
// Controller buttons use the standard Gamepad mapping (Xbox layout), which is
// what Steam Input and most Linux drivers expose.

export type Action =
  | "up"
  | "down"
  | "left"
  | "right"
  | "accept"
  | "back"
  | "options"
  | "tabPrev"
  | "tabNext"
  | "home";

type Listener = (action: Action) => void;

const KEYS: Record<string, Action> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "accept",
  " ": "accept",
  Escape: "back",
  Backspace: "back",
  o: "options",
  q: "tabPrev",
  e: "tabNext",
  h: "home",
};

// Standard mapping button index -> action.
const BUTTONS: Record<number, Action> = {
  0: "accept", // A
  1: "back", // B
  3: "options", // Y
  4: "tabPrev", // LB
  5: "tabNext", // RB
  9: "options", // Start / Menu
  12: "up",
  13: "down",
  14: "left",
  15: "right",
  16: "home", // Guide / Home / Xbox button
};
const SELECT = 8;
const START = 9;
const POLL_MS = 16;

const REPEAT_DELAY_MS = 380;
const REPEAT_RATE_MS = 110;
const STICK_DEADZONE = 0.55;
const DIRECTIONS: Action[] = ["up", "down", "left", "right"];

export function startInput(onAction: Listener): void {
  window.addEventListener("keydown", (e) => {
    const action = KEYS[e.key];
    if (!action) return;
    e.preventDefault();
    onAction(action);
  });

  // Per-action hold state for auto-repeat on directions.
  const held = new Map<Action, { since: number; last: number }>();

  // setInterval, not requestAnimationFrame: the Home button must still work
  // while a game is in front and the dashboard is not being drawn.
  const poll = () => {
    const now = performance.now();
    const pressed = new Set<Action>();
    for (const pad of navigator.getGamepads()) {
      if (!pad) continue;
      pad.buttons.forEach((b, i) => {
        const action = BUTTONS[i];
        if (action && b.pressed) pressed.add(action);
      });
      // Select + Start together = Home, for controllers whose Home button is
      // taken by something else.
      if (pad.buttons[SELECT]?.pressed && pad.buttons[START]?.pressed) {
        pressed.delete("options");
        pressed.add("home");
      }
      const [x = 0, y = 0] = pad.axes;
      if (x < -STICK_DEADZONE) pressed.add("left");
      if (x > STICK_DEADZONE) pressed.add("right");
      if (y < -STICK_DEADZONE) pressed.add("up");
      if (y > STICK_DEADZONE) pressed.add("down");
    }

    for (const action of pressed) {
      const state = held.get(action);
      if (!state) {
        held.set(action, { since: now, last: now });
        onAction(action);
      } else if (
        DIRECTIONS.includes(action) &&
        now - state.since > REPEAT_DELAY_MS &&
        now - state.last > REPEAT_RATE_MS
      ) {
        state.last = now;
        onAction(action);
      }
    }
    for (const action of [...held.keys()]) {
      if (!pressed.has(action)) held.delete(action);
    }
  };
  setInterval(poll, POLL_MS);
}
