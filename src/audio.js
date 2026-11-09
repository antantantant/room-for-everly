// The sound of the room at dawn, synthesised live with Web Audio: no audio files.
//
// An original little waltz in D minor, for the castle across the valley: a celesta
// music-box tune over an oom-pah-pah accompaniment, filling in as the sun comes up.
// A soft string pad from the start, the waltz once there is a little light, the
// tune after that, then strings singing along an octave down; with birdsong
// outside and the breeze through the window.
const midi = n => 440 * Math.pow(2, (n - 69) / 12);

const BEAT = 0.62, BAR = BEAT * 3;               // seconds: a gentle waltz, three beats to the bar
const CHORD = {                                  // bass, then the chord above it
  Dm: [38, 57, 62, 65], Bb: [34, 58, 62, 65], Gm: [43, 58, 62, 67], A7: [33, 57, 61, 67], F: [41, 57, 60, 65], C: [36, 55, 60, 64],
};
// sixteen bars, then round again
const HARMONY = ['Dm', 'Bb', 'Gm', 'A7', 'Dm', 'F', 'C', 'A7', 'Bb', 'Gm', 'Dm', 'A7', 'Gm', 'Dm', 'A7', 'Dm'];
const TUNE = [                                   // per bar: [note, beat it starts on, beats it lasts]
  [[81, 0, 1.5], [79, 1.5, 0.5], [77, 2, 1]], [[74, 0, 2], [77, 2, 1]], [[79, 0, 1], [82, 1, 1], [81, 2, 1]], [[76, 0, 2], [73, 2, 1]],
  [[74, 0, 1], [77, 1, 1], [81, 2, 1]], [[84, 0, 1.5], [81, 1.5, 0.5], [77, 2, 1]], [[79, 0, 1], [76, 1, 1], [79, 2, 1]], [[81, 0, 3]],
  [[77, 0, 1], [74, 1, 1], [77, 2, 1]], [[82, 0, 1.5], [81, 1.5, 0.5], [79, 2, 1]], [[77, 0, 1], [81, 1, 1], [86, 2, 1]], [[85, 0, 2], [81, 2, 1]],
  [[79, 0, 1], [82, 1, 1], [86, 2, 1]], [[81, 0, 1.5], [77, 1.5, 0.5], [74, 2, 1]], [[76, 0, 1], [79, 1, 1], [73, 2, 1]], [[74, 0, 3]],
];

export function createMusic() {
  let ctx, master, wet, windGain, timer;
  let progress = 0, muted = false, nextBar = 0, bar = 0;

  // one note: an oscillator through a gain envelope, sent partly to the reverb
  function tone(type, freq, t, { attack, hold = 0, release, gain, detune = 0, pan = 0, send = 0.5 }) {
    const osc = ctx.createOscillator(), env = ctx.createGain(), panner = ctx.createStereoPanner();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    panner.pan.value = pan;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.setValueAtTime(gain, t + attack + hold);
    env.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    osc.connect(env).connect(panner);
    panner.connect(master);
    const toWet = ctx.createGain();
    toWet.gain.value = send;
    panner.connect(toWet).connect(wet);
    osc.start(t);
    osc.stop(t + attack + hold + release + 0.1);
    return osc;
  }

  function pad(chord, t) {                       // strings: a slow swell under each bar
    chord.slice(1).forEach((n, i) => {
      for (const detune of [-6, 6]) tone('sawtooth', midi(n - 12), t, { attack: 0.9, hold: BAR - 0.9, release: 1.6, gain: 0.0045, detune, pan: (i - 1) * 0.3, send: 0.8 });
    });
  }
  function pluck(n, t, gain, pan) {              // the waltz: a soft harp-like pluck
    tone('triangle', midi(n), t, { attack: 0.004, release: 0.9, gain, pan, send: 0.6 });
    tone('sine', midi(n) * 2, t, { attack: 0.003, release: 0.4, gain: gain * 0.3, pan, send: 0.6 });
  }
  function celesta(n, t, beats, gain) {          // the tune: a bright, bell-like music box
    tone('sine', midi(n), t, { attack: 0.004, hold: beats * BEAT * 0.2, release: 1.4 + beats * 0.4, gain, send: 0.9 });
    tone('sine', midi(n) * 4, t, { attack: 0.002, release: 0.3, gain: gain * 0.22, send: 0.9 });
    tone('sine', midi(n) * 2.01, t, { attack: 0.003, release: 0.8, gain: gain * 0.18, send: 0.9 });
  }
  function strings(n, t, beats, gain) {          // later on, strings sing the tune an octave down
    for (const detune of [-7, 7]) tone('sawtooth', midi(n - 12), t, { attack: 0.18, hold: beats * BEAT - 0.18, release: 0.6, gain, detune, send: 0.9 });
  }
  function bird(t) {                             // a few quick falling chirps, somewhere outside
    const base = 2600 + Math.random() * 2200, pan = Math.random() * 1.6 - 0.8, count = 2 + (Math.random() * 4 | 0);
    for (let i = 0; i < count; i++) {
      const at = t + i * (0.09 + Math.random() * 0.05);
      const osc = tone('sine', base, at, { attack: 0.01, release: 0.07, gain: 0.012 + Math.random() * 0.01, pan, send: 1 });
      osc.frequency.setValueAtTime(base * (1.15 + Math.random() * 0.2), at);
      osc.frequency.exponentialRampToValueAtTime(base * 0.85, at + 0.07);
    }
  }

  function scheduleBar(t) {
    const k = bar % HARMONY.length, chord = CHORD[HARMONY[k]];
    pad(chord, t);
    if (progress > 0.08) {                       // oom-pah-pah: the bass on one, the chord on two and three
      const level = Math.min(1, (progress - 0.08) / 0.2);
      pluck(chord[0], t, 0.06 * level, 0);
      for (const beat of [1, 2]) chord.slice(1).forEach((n, i) => pluck(n, t + beat * BEAT + i * 0.012, 0.016 * level, (i - 1) * 0.35));
    }
    if (progress > 0.2) {                        // the tune
      const level = Math.min(1, (progress - 0.2) / 0.2);
      for (const [n, beat, beats] of TUNE[k]) celesta(n, t + beat * BEAT, beats, 0.055 * level);
    }
    if (progress > 0.5) {                        // and the strings join it
      const level = Math.min(1, (progress - 0.5) / 0.3);
      for (const [n, beat, beats] of TUNE[k]) strings(n, t + beat * BEAT, beats, 0.006 * level);
    }
    if (progress > 0.2) {                        // the birds wake with the light
      const calls = Math.random() * (1 + progress * 2) | 0;
      for (let i = 0; i < calls; i++) bird(t + Math.random() * BAR);
    }
    bar++;
  }

  function start() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const limiter = ctx.createDynamicsCompressor();
    limiter.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(muted ? 0.0001 : 0.9, ctx.currentTime + 4);   // fade in
    master.connect(limiter);

    // a roomy reverb from a burst of decaying noise
    const seconds = 3.2, impulse = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.6);
    }
    const reverb = ctx.createConvolver();
    reverb.buffer = impulse;
    wet = ctx.createGain();
    wet.gain.value = 0.55;
    wet.connect(reverb).connect(master);

    // the breeze: looped noise through a soft band-pass, its level following the swells
    const noise = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate), nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(), band = ctx.createBiquadFilter();
    src.buffer = noise;
    src.loop = true;
    band.type = 'bandpass';
    band.frequency.value = 420;
    band.Q.value = 0.4;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    src.connect(band).connect(windGain).connect(master);
    src.start();

    nextBar = ctx.currentTime + 0.3;
    timer = setInterval(() => {
      if (ctx.state !== 'running') return;
      while (nextBar < ctx.currentTime + 0.6) { scheduleBar(nextBar); nextBar += BAR; }
    }, 150);
  }

  return {
    start,
    setProgress(p) { progress = p; },                                        // 0 = before sunrise, 1 = full morning
    setGust(g) { if (ctx) windGain.gain.setTargetAtTime(0.012 + 0.03 * g, ctx.currentTime, 0.4); },
    setPlaying(on) { if (ctx) on ? ctx.resume() : ctx.suspend(); },
    setMuted(m) { muted = m; if (ctx) master.gain.setTargetAtTime(m ? 0.0001 : 0.9, ctx.currentTime, 0.2); },
    restart() { bar = 0; },
    stop() { clearInterval(timer); },
  };
}
