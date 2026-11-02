// Menu sounds. Every sound is made here in code with the Web Audio API: no
// sound files, nothing copied from a console. They are short, soft and quiet,
// so they sit under the TV volume and do not get annoying.
//
// All sounds go through a small mixer: a dry path and a shared reverb (a
// generated "room"), then a compressor so stacked sounds never get loud.

const MASTER = 0.55;
/** Let the sound card rest when nobody presses anything. */
const IDLE_MS = 60_000;
/** Small offset so a sound never starts in the past. */
const LEAD = 0.004;

let ctx: AudioContext | null = null;
let dry: GainNode;
let reverb: GainNode;
let noise: AudioBuffer;
let enabled = true;
let idle: ReturnType<typeof setTimeout> | undefined;
/** Counts named sounds, so the input code knows if a screen already made one. */
let played = 0;

function setup(): AudioContext {
  const c = new AudioContext({ latencyHint: "interactive" });
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  const master = c.createGain();
  master.gain.value = MASTER;
  comp.connect(master).connect(c.destination);

  dry = c.createGain();
  dry.connect(comp);

  const room = c.createConvolver();
  room.buffer = impulse(c, 1.8, 3.2);
  const wet = c.createGain();
  wet.gain.value = 0.45;
  reverb = c.createGain();
  reverb.connect(room).connect(wet).connect(comp);

  noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const n = noise.getChannelData(0);
  for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
  return c;
}

/** A soft stereo "room": noise that fades out, slightly muffled. */
function impulse(c: BaseAudioContext, seconds: number, fade: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let y = 0;
    for (let i = 0; i < len; i++) {
      y += 0.4 * (Math.random() * 2 - 1 - y); // one-pole low-pass
      d[i] = y * Math.pow(1 - i / len, fade);
    }
  }
  return buf;
}

function audio(): AudioContext {
  ctx ??= setup();
  if (ctx.state === "suspended") void ctx.resume();
  clearTimeout(idle);
  idle = setTimeout(() => void ctx?.suspend(), IDLE_MS);
  return ctx;
}

/** Send a voice to the speakers, panned, with some of it into the reverb. */
function route(c: AudioContext, node: AudioNode, pan = 0, wet = 0.2) {
  const p = c.createStereoPanner();
  p.pan.value = pan;
  node.connect(p).connect(dry);
  if (wet > 0) {
    const s = c.createGain();
    s.gain.value = wet;
    p.connect(s).connect(reverb);
  }
}

interface Tone {
  f: number;
  /** Seconds from now. */
  at?: number;
  type?: OscillatorType;
  gain: number;
  attack?: number;
  /** Seconds to fade out after the attack. */
  decay: number;
  /** Pitch at the end of the decay (a slide). */
  glide?: number;
  detune?: number;
  pan?: number;
  wet?: number;
}

function tone(c: AudioContext, o: Tone) {
  const t = c.currentTime + LEAD + (o.at ?? 0);
  const a = o.attack ?? 0.003;
  const end = t + a + o.decay;
  const osc = c.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.f, t);
  if (o.glide) osc.frequency.exponentialRampToValueAtTime(o.glide, end);
  if (o.detune) osc.detune.value = o.detune;
  const env = c.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(o.gain, t + a);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(env);
  route(c, env, o.pan, o.wet);
  osc.start(t);
  osc.stop(end + 0.05);
}

/** Glassy bell: a sine plus two quiet overtones that fade faster. */
function bell(c: AudioContext, f: number, o: Omit<Tone, "f">) {
  tone(c, { ...o, f });
  tone(c, { ...o, f: f * 2.01, gain: o.gain * 0.22, decay: o.decay * 0.45 });
  tone(c, { ...o, f: f * 3.03, gain: o.gain * 0.07, decay: o.decay * 0.25 });
}

interface Whoosh {
  at?: number;
  dur: number;
  gain: number;
  /** Filter sweep, Hz. */
  from: number;
  to: number;
  q?: number;
  pan?: number;
  wet?: number;
}

/** Filtered noise that sweeps up or down: air moving. */
function whoosh(c: AudioContext, o: Whoosh) {
  const t = c.currentTime + LEAD + (o.at ?? 0);
  const end = t + o.dur;
  const src = c.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = o.q ?? 1.1;
  bp.frequency.setValueAtTime(o.from, t);
  bp.frequency.exponentialRampToValueAtTime(o.to, end);
  const env = c.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(o.gain, t + o.dur * 0.45);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  src.connect(bp).connect(env);
  route(c, env, o.pan, o.wet);
  src.start(t, Math.random() * 0.8);
  src.stop(end + 0.05);
}

function play(make: (c: AudioContext) => void) {
  played++;
  if (!enabled) return;
  try {
    make(audio());
  } catch (err) {
    console.warn("[steamcouch] sound:", err);
  }
}

const jitter = (cents: number) => (Math.random() - 0.5) * 2 * cents;

// Notes (Hz) used below.
const C4 = 261.63, E4 = 329.63, G4 = 392, B4 = 493.88;
const C5 = 523.25, D5 = 587.33, E5 = 659.25, G5 = 783.99, B5 = 987.77;
const C6 = 1046.5, D6 = 1174.66, E6 = 1318.51, G6 = 1567.98, A6 = 1760;

export const sfx = {
  /** Focus moved to the next tile or row. */
  move() {
    play((c) => {
      const d = jitter(18);
      tone(c, { f: 1568, gain: 0.05, decay: 0.045, detune: d, wet: 0.12 });
      tone(c, { f: 3136, type: "triangle", gain: 0.01, decay: 0.02, detune: d, wet: 0 });
    });
  },
  /** Pressed a direction, but there is nothing more that way. */
  edge() {
    play((c) => tone(c, { f: 210, glide: 170, gain: 0.07, decay: 0.07, wet: 0.04 }));
  },
  /** A (open, choose, toggle). */
  select() {
    play((c) => {
      bell(c, B5, { gain: 0.07, decay: 0.16, wet: 0.25 });
      bell(c, E6, { at: 0.035, gain: 0.05, decay: 0.22, wet: 0.3 });
    });
  },
  /** B (go back, close). */
  back() {
    play((c) => tone(c, { f: 740, glide: 520, gain: 0.07, decay: 0.12, wet: 0.18 }));
  },
  /** LB / RB: switch tab. */
  tab() {
    play((c) => {
      whoosh(c, { dur: 0.09, gain: 0.05, from: 2400, to: 5200, q: 1.4, wet: 0.1 });
      tone(c, { f: D6, at: 0.02, gain: 0.04, decay: 0.06, wet: 0.15 });
    });
  },
  /** Control Center slides up. */
  open() {
    play((c) => {
      whoosh(c, { dur: 0.28, gain: 0.06, from: 500, to: 3600, wet: 0.3 });
      bell(c, C5, { at: 0.08, gain: 0.04, decay: 0.45, wet: 0.5, pan: -0.15 });
      bell(c, G5, { at: 0.11, gain: 0.035, decay: 0.45, wet: 0.5, pan: 0.15 });
    });
  },
  /** Control Center or Steam store page closes. */
  close() {
    play((c) => {
      whoosh(c, { dur: 0.22, gain: 0.05, from: 3400, to: 600, wet: 0.25 });
      tone(c, { f: E5, glide: B4, at: 0.03, gain: 0.05, decay: 0.18, wet: 0.3 });
    });
  },
  /** A message at the bottom of the screen. */
  notify() {
    play((c) => {
      bell(c, E6, { gain: 0.045, decay: 0.5, wet: 0.45, pan: -0.1 });
      bell(c, A6, { at: 0.09, gain: 0.04, decay: 0.6, wet: 0.5, pan: 0.1 });
    });
  },
  /** Wrong passcode, or something did not work. */
  error() {
    play((c) => {
      tone(c, { f: 247, type: "triangle", gain: 0.08, decay: 0.09, wet: 0.08 });
      tone(c, { f: 233, type: "triangle", at: 0.13, gain: 0.08, decay: 0.14, wet: 0.1 });
    });
  },
  /** A profile was chosen: a bright rising chime. */
  login() {
    play((c) => {
      [C5, E5, G5, B5, D6].forEach((f, i) =>
        bell(c, f, { at: i * 0.07, gain: 0.05, decay: 0.9, wet: 0.6, pan: -0.4 + i * 0.2 }),
      );
    });
  },
  /** A game starts: air rising into a warm chord. */
  launch() {
    play((c) => {
      whoosh(c, { dur: 0.95, gain: 0.05, from: 280, to: 6500, q: 0.9, wet: 0.5 });
      [C4, G4, C5, E5].forEach((f, i) =>
        tone(c, { f, type: i < 2 ? "triangle" : "sine", at: 0.15, attack: 0.45, decay: 1.4, gain: 0.03, wet: 0.6, pan: (i - 1.5) * 0.2 }),
      );
      bell(c, C6, { at: 0.75, gain: 0.04, decay: 1.2, wet: 0.7 });
      bell(c, G6, { at: 0.83, gain: 0.03, decay: 1.2, wet: 0.7 });
    });
  },
  /** The dashboard turns on: a slow, soft chord that swells in. */
  startup() {
    play((c) => {
      [C4 / 2, G4 / 2, C4, E4, B4, D5].forEach((f, i) =>
        tone(c, { f, type: i % 2 ? "triangle" : "sine", attack: 1.1, decay: 2.6, gain: 0.028, wet: 0.7, pan: (i - 2.5) * 0.15 }),
      );
      bell(c, G5, { at: 1.1, gain: 0.03, decay: 1.6, wet: 0.8, pan: 0.2 });
      bell(c, C6, { at: 1.25, gain: 0.025, decay: 1.8, wet: 0.8, pan: -0.2 });
    });
  },

  setEnabled(on: boolean) {
    enabled = on;
    if (!on) void ctx?.suspend();
  },
  /** Use with `playedSince` to see if anything made a sound in between. */
  mark(): number {
    return played;
  },
  playedSince(mark: number): boolean {
    return played !== mark;
  },
};
