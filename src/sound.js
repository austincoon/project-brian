// Small synthesized sound effects; no audio files are downloaded.
let context = null;
let enabled = true;
let noise = null;

export function setSoundEnabled(value) {
  enabled = Boolean(value);
}

// Browsers only start audio after a user gesture, so the context is created on the first one.
export function unlockSound() {
  const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContext) return;
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") context.resume().catch(() => {});
  } catch {
    context = null;
  }
}

function output() {
  // Sounds queued on a suspended context would all play at once when it resumes.
  return enabled && context?.state === "running" ? context : null;
}

function tone(audio, { at = 0, frequency, endFrequency = frequency, duration = 0.12, type = "sine", volume = 0.12 }) {
  const start = audio.currentTime + at;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function click(audio, { at = 0, duration = 0.035, frequency = 2400, volume = 0.18 }) {
  noise ??= (() => {
    const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * 0.1), audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    return buffer;
  })();
  const start = audio.currentTime + at;
  const source = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const gain = audio.createGain();
  source.buffer = noise;
  filter.type = "bandpass";
  filter.frequency.value = frequency;
  filter.Q.value = 1.4;
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter).connect(gain).connect(audio.destination);
  source.start(start, Math.random() * 0.05, duration + 0.01);
}

const sounds = {
  roll(audio) {
    let at = 0;
    for (let index = 0; index < 7; index += 1) {
      click(audio, { at, frequency: 1600 + Math.random() * 1800, volume: 0.16 - index * 0.015 });
      at += 0.05 + Math.random() * 0.09;
    }
  },
  settle(audio) {
    click(audio, { frequency: 1300, volume: 0.13 });
    click(audio, { at: 0.07, frequency: 1700, volume: 0.1 });
  },
  step(audio, { at = 0 } = {}) {
    tone(audio, { at, frequency: 820, endFrequency: 520, duration: 0.07, type: "triangle", volume: 0.07 });
  },
  capture(audio) {
    tone(audio, { frequency: 420, endFrequency: 70, duration: 0.32, type: "square", volume: 0.05 });
    click(audio, { frequency: 700, duration: 0.09, volume: 0.2 });
  },
  home(audio) {
    [659, 784, 1047].forEach((frequency, index) => tone(audio, { at: index * 0.08, frequency, duration: 0.22, volume: 0.08 }));
  },
  turn(audio) {
    tone(audio, { frequency: 880, duration: 0.16, volume: 0.07 });
    tone(audio, { at: 0.12, frequency: 1175, duration: 0.24, volume: 0.06 });
  },
  win(audio) {
    [523, 659, 784, 1047, 784, 1047].forEach((frequency, index) => (
      tone(audio, { at: index * 0.11, frequency, duration: index === 5 ? 0.6 : 0.18, type: "triangle", volume: 0.1 })
    ));
  },
};

export function playSound(name, options) {
  const audio = output();
  if (!audio || !sounds[name]) return;
  try { sounds[name](audio, options); } catch { /* Sound is decorative. */ }
}
