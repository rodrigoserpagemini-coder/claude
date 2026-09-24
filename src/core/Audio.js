// Everything is synthesised with Web Audio: no sample files to load.
// A detuned drone tracks speed, a band-passed noise bed tracks heat, and
// short one-shots mark pickups, grazes and hits.
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  // Must be called from a user gesture.
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 5;
    this.master.connect(comp).connect(ctx.destination);

    // Drone.
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 320;
    this.droneFilter.Q.value = 6;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.11;
    this.droneFilter.connect(droneGain).connect(this.master);
    this.oscs = [55, 55.35, 82.4, 110.2].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i < 2 ? 'sawtooth' : 'triangle';
      o.frequency.value = f;
      o.connect(this.droneFilter);
      o.start();
      return o;
    });

    // Plasma rush.
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    noise.loop = true;
    this.rushFilter = ctx.createBiquadFilter();
    this.rushFilter.type = 'bandpass';
    this.rushFilter.frequency.value = 600;
    this.rushFilter.Q.value = 0.8;
    this.rushGain = ctx.createGain();
    this.rushGain.gain.value = 0.05;
    noise.connect(this.rushFilter).connect(this.rushGain).connect(this.master);
    noise.start();

    // Boost roar: a separate noise voice, high-passed, faded in while boosting.
    const roar = ctx.createBufferSource();
    roar.buffer = this.noiseBuf;
    roar.loop = true;
    this.roarFilter = ctx.createBiquadFilter();
    this.roarFilter.type = 'bandpass';
    this.roarFilter.frequency.value = 900;
    this.roarFilter.Q.value = 1.4;
    this.roarGain = ctx.createGain();
    this.roarGain.gain.value = 0;
    roar.connect(this.roarFilter).connect(this.roarGain).connect(this.master);
    roar.start(0, 0.7);
    this.alarmIn = 0;
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  // speed and heat in [0, 1].
  update(speed, heat, { boosting = false, alarm = false, dt = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.roarGain.gain.setTargetAtTime(boosting ? 0.2 : 0, t, boosting ? 0.08 : 0.25);
    this.roarFilter.frequency.setTargetAtTime(boosting ? 1500 + speed * 1500 : 700, t, 0.3);
    this.alarmIn -= dt;
    if (alarm && this.alarmIn <= 0) {
      this.alarmIn = 0.55;
      this.tone(1180, 0.12, { type: 'square', gain: 0.06 });
    }
    this.droneFilter.frequency.setTargetAtTime(240 + speed * 900 + heat * 500, t, 0.25);
    this.rushFilter.frequency.setTargetAtTime(420 + speed * 1600, t, 0.3);
    this.rushGain.gain.setTargetAtTime(0.03 + heat * 0.09, t, 0.3);
    const bend = 1 + speed * 0.5;
    this.oscs.forEach((o, i) => o.detune.setTargetAtTime(Math.log2(bend) * 1200 + (i === 1 ? 7 : 0), t, 0.5));
  }

  tone(freq, dur, { type = 'sine', gain = 0.2, delay = 0, slide = 1 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(dur, { freq = 800, q = 1, gain = 0.3, type = 'lowpass', sweep = 1 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  collect(combo) {
    const base = 660 * Math.pow(2, Math.min(combo, 8) / 12);
    this.tone(base, 0.18, { type: 'triangle', gain: 0.22 });
    this.tone(base * 1.5, 0.28, { type: 'sine', gain: 0.16, delay: 0.06 });
    this.tone(base * 2, 0.4, { type: 'sine', gain: 0.1, delay: 0.12 });
  }

  graze() {
    this.noise(0.35, { freq: 3200, q: 2.5, gain: 0.22, type: 'bandpass', sweep: 0.25 });
  }

  hit() {
    this.noise(0.6, { freq: 1400, gain: 0.5, sweep: 0.08 });
    this.tone(90, 0.5, { type: 'sine', gain: 0.5, slide: 0.4 });
  }

  breach() {
    this.noise(2.4, { freq: 2600, gain: 0.7, sweep: 0.03 });
    this.tone(70, 2.0, { type: 'sawtooth', gain: 0.35, slide: 0.3 });
  }

  energy() {
    this.tone(330, 0.3, { type: 'sawtooth', gain: 0.08, slide: 3 });
    this.tone(990, 0.35, { type: 'sine', gain: 0.14, delay: 0.1 });
  }

  shield() {
    this.tone(220, 0.8, { type: 'sine', gain: 0.25, slide: 4 });
    this.noise(0.8, { freq: 5000, q: 6, gain: 0.12, type: 'bandpass', sweep: 0.3 });
  }

  deflect() {
    this.tone(1400, 0.25, { type: 'triangle', gain: 0.15, slide: 0.5 });
    this.noise(0.25, { freq: 4000, q: 3, gain: 0.15, type: 'bandpass', sweep: 0.5 });
  }

  siren() {
    for (let i = 0; i < 3; i++) {
      this.tone(520, 0.45, { type: 'sawtooth', gain: 0.07, delay: i * 0.9, slide: 1.6 });
      this.tone(830, 0.4, { type: 'sawtooth', gain: 0.07, delay: i * 0.9 + 0.45, slide: 0.62 });
    }
  }

  zone() {
    [0, 7, 12, 19].forEach((s, i) => this.tone(220 * Math.pow(2, s / 12), 1.6, { type: 'sine', gain: 0.1, delay: i * 0.14 }));
  }

  milestone() {
    [0, 4, 7, 12].forEach((s, i) => this.tone(440 * Math.pow(2, s / 12), 0.5, { type: 'triangle', gain: 0.14, delay: i * 0.09 }));
  }
}
