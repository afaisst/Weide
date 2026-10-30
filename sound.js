'use strict';
/*
 * Weide – sounds.
 *
 * Most sounds are made right here in the browser with the Web Audio API
 * (oscillators, filtered noise, envelopes). The dog's bark, the sheep, the wolves'
 * howls, the ducks, the crickets, the lawn mower,
 * the beer bottle and the streams are recordings: the files in soundeffects/, packed into
 * soundeffects/sounds.js (run soundeffects/make_sounds_js.py after adding files).
 * Without recordings the made-up sounds are used.
 * game.js decides WHEN a sound plays, how LOUD (the closer to the dog, the louder)
 * and from WHERE (left / right). This file only knows how each sound is made.
 *
 *   const snd = WeideSound.create();
 *   snd.unlock();                              // on a click / key press (browsers need that)
 *   snd.play('baa', { gain, pan, pitch });     // one-shot sounds
 *   snd.loop('wind', gain, pan, tone);         // steady sounds: call every frame
 */
window.WeideSound = (() => {
  const rand = (a, b) => a + Math.random() * (b - a);

  function create(opts = {}) {
    let ctx = null, master = null, revIn = null, noiseBuf = null, ok = false;
    let voices = 0;                 // one-shot sounds playing right now
    const MAX_VOICES = 16;
    const loops = {};
    let volume = 0.7, running = true;

    // ---- set-up (needs a user gesture in most browsers) ----
    function init() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (opts.context) ctx = opts.context;          // (for testing: an OfflineAudioContext)
      else if (!AC) return false;
      else ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4;
      comp.attack.value = 0.004; comp.release.value = 0.2;
      master.connect(comp); comp.connect(ctx.destination);

      // white noise, shared by everything that hisses
      const len = ctx.sampleRate * 2;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      // a little reverb: the alp is wide and open (mostly heard on the wolves' howls)
      const conv = ctx.createConvolver();
      const rl = Math.floor(ctx.sampleRate * 2.4);
      const ir = ctx.createBuffer(2, rl, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const ch = ir.getChannelData(c);
        for (let i = 0; i < rl; i++) {
          const t = i / ctx.sampleRate;
          ch[i] = (Math.random() * 2 - 1) * Math.exp(-t * 2.6) * (t < 0.02 ? t / 0.02 : 1);
        }
      }
      conv.buffer = ir;
      revIn = ctx.createGain(); revIn.gain.value = 0.4;
      revIn.connect(conv); conv.connect(master);
      ok = true;
      loadSamples();
      return true;
    }

    function unlock() {
      if (!ctx && !init()) return;
      if (ctx.state !== 'running' && running) ctx.resume().catch(() => {});
    }

    // pause: freeze everything (a howl carries on where it stopped)
    function setRunning(on) {
      if (on === running || !ctx) { running = on; return; }
      running = on;
      if (on) ctx.resume().catch(() => {}); else ctx.suspend().catch(() => {});
    }

    function setVolume(v) {
      volume = v;
      if (ok) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    }

    // ---- small building blocks ----
    const now = () => ctx.currentTime + 0.01;
    function osc(type, f) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; }
    function noise(loop = false) {
      const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = loop;
      if (loop) s.loopStart = 0;
      return s;
    }
    function filter(type, f, Q = 1) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; return b; }
    function gain(v = 1) { const g = ctx.createGain(); g.gain.value = v; return g; }
    function shaper(k) {
      const ws = ctx.createWaveShaper(), n = 1024, c = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
      ws.curve = c; return ws;
    }
    // voice output: volume -> left/right -> speakers (+ some reverb)
    function output(vol, pan, wet, endAt) {
      const g = gain(vol);
      let tail = g;
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan || 0));
        g.connect(p); tail = p;
      }
      tail.connect(master);
      if (wet) { const s = gain(wet); tail.connect(s); s.connect(revIn); }
      voices++;
      // tidy up when the sound is over
      const done = ctx.createConstantSource ? ctx.createConstantSource() : osc('sine', 0);
      const sink = gain(0); done.connect(sink); sink.connect(master);
      done.onended = () => { voices--; try { g.disconnect(); tail.disconnect(); sink.disconnect(); } catch (e) { /* ignore */ } };
      done.start(); done.stop(endAt + 0.6);
      return g;
    }
    // attack - hold - release on a gain
    function env(g, t, a, peak, hold, rel) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + a);
      g.gain.setValueAtTime(peak, t + a + hold);
      g.gain.setTargetAtTime(0, t + a + hold, rel / 4);
    }

    // ---------------------------------------------------------------------------
    // Sheep: "Bäähh" - a buzzy voice through vowel filters, with the typical quaver
    // ---------------------------------------------------------------------------
    function baa(o, t0 = now()) {
      const p = o.pitch || 1, panic = !!o.panic, cold = !!o.cold;
      const dur = (panic ? rand(0.35, 0.5) : cold ? rand(0.3, 0.45) : rand(0.55, 0.9)) * (p > 1.3 ? 0.8 : 1);
      const f0 = rand(165, 210) * p * (panic ? 1.25 : 1);
      const out = output(o.gain * 0.9, o.pan, 0.12, t0 + dur);
      const v = osc('sawtooth', f0);
      v.frequency.setValueAtTime(f0 * 0.85, t0);
      v.frequency.linearRampToValueAtTime(f0, t0 + 0.07);
      v.frequency.linearRampToValueAtTime(f0 * rand(0.9, 1.02), t0 + dur);
      // the quaver: wobbling pitch and loudness
      const lfo = osc('sine', rand(8, 12) * (panic ? 1.35 : cold ? 1.6 : 1));
      const fm = gain(f0 * (cold ? 0.06 : 0.035)); lfo.connect(fm); fm.connect(v.frequency);
      const am = gain(0.7), amd = gain(cold ? 0.45 : 0.3); lfo.connect(amd); amd.connect(am.gain);
      const sum = gain(1);
      [[700, 5, 1], [1250, 7, 0.55], [2600, 9, 0.22]].forEach(([f, Q, g], i) => {
        const bp = filter('bandpass', f * (p > 1.3 ? 1.12 : 1), Q), gg = gain(g * 2.2);
        if (i === 0) { bp.frequency.setValueAtTime(380, t0); bp.frequency.linearRampToValueAtTime(f, t0 + 0.08); }  // "b-aa"
        v.connect(bp); bp.connect(gg); gg.connect(sum);
      });
      const e = gain(0);
      sum.connect(am); am.connect(e); e.connect(out);
      env(e, t0, 0.03, 1, dur - 0.12, 0.25);
      v.start(t0); lfo.start(t0); v.stop(t0 + dur + 0.4); lfo.stop(t0 + dur + 0.4);
    }

    // ---------------------------------------------------------------------------
    // Dog: a big Saint Bernard - deep "WOOF"
    // ---------------------------------------------------------------------------
    function woofOne(o, t0, loud = 1) {
      const p = o.pitch || 1, f0 = rand(118, 140) * p;
      const out = output(o.gain * loud, o.pan, 0.1, t0 + 0.4);
      const v = osc('sawtooth', f0), sub = osc('square', f0 / 2);
      v.frequency.setValueAtTime(f0 * 1.15, t0);
      v.frequency.linearRampToValueAtTime(f0 * 1.6, t0 + 0.035);
      v.frequency.exponentialRampToValueAtTime(f0 * 0.8, t0 + 0.24);
      sub.frequency.setValueAtTime(f0 * 0.58, t0);
      sub.frequency.exponentialRampToValueAtTime(f0 * 0.4, t0 + 0.24);
      const sh = shaper(2.5), subg = gain(0.35);
      v.connect(sh); sub.connect(subg); subg.connect(sh);
      const sum = gain(1);
      [[480, 1.6, 1.6], [1150, 2.5, 0.9], [2400, 4, 0.25]].forEach(([f, Q, g]) => {
        const bp = filter('bandpass', f, Q), gg = gain(g); sh.connect(bp); bp.connect(gg); gg.connect(sum);
      });
      // a puff of breath at the start
      const n = noise(), nb = filter('bandpass', 900, 0.8), ng = gain(0);
      n.connect(nb); nb.connect(ng); ng.connect(sum);
      env(ng, t0, 0.005, 0.5, 0.02, 0.06);
      const e = gain(0); sum.connect(e); e.connect(out);
      e.gain.setValueAtTime(0, t0);
      e.gain.linearRampToValueAtTime(1, t0 + 0.012);
      e.gain.setTargetAtTime(0.55, t0 + 0.03, 0.04);
      e.gain.setTargetAtTime(0, t0 + 0.13, 0.045);
      v.start(t0); sub.start(t0); n.start(t0, rand(0, 1.5));
      v.stop(t0 + 0.45); sub.stop(t0 + 0.45); n.stop(t0 + 0.2);
    }
    function yelp(o, t0 = now()) {
      for (let k = 0; k < 2; k++) {
        const t = t0 + k * 0.2, out = output(o.gain * 0.55, o.pan, 0.1, t + 0.3);
        const v = osc('sawtooth', 800);
        v.frequency.setValueAtTime(760, t);
        v.frequency.linearRampToValueAtTime(1250, t + 0.04);
        v.frequency.exponentialRampToValueAtTime(620, t + 0.18);
        const bp = filter('bandpass', 1300, 2.5), e = gain(0);
        v.connect(bp); bp.connect(e); e.connect(out);
        env(e, t, 0.01, 1.6, 0.08, 0.08);
        v.start(t); v.stop(t + 0.3);
      }
    }
    function yawn(o, t0 = now()) {
      const dur = 1.1, out = output(o.gain * 0.6, o.pan, 0.08, t0 + dur);
      const v = osc('sawtooth', 300);
      v.frequency.setValueAtTime(330, t0);
      v.frequency.linearRampToValueAtTime(470, t0 + 0.3);
      v.frequency.exponentialRampToValueAtTime(170, t0 + dur);
      const bp = filter('bandpass', 1000, 3);
      bp.frequency.setValueAtTime(1100, t0); bp.frequency.exponentialRampToValueAtTime(500, t0 + dur);
      const n = noise(), nb = filter('bandpass', 1400, 0.7), ng = gain(0.25);
      const e = gain(0);
      v.connect(bp); bp.connect(e); n.connect(nb); nb.connect(ng); ng.connect(e); e.connect(out);
      env(e, t0, 0.15, 1.2, dur - 0.35, 0.3);
      v.start(t0); n.start(t0); v.stop(t0 + dur + 0.3); n.stop(t0 + dur + 0.3);
    }

    // ---------------------------------------------------------------------------
    // Wolf: long howl rising and falling, and a rough growl
    // ---------------------------------------------------------------------------
    function howl(o, t0 = now()) {
      const dur = rand(2.4, 3.4), p = (o.pitch || 1) * rand(0.9, 1.12);
      const out = output(o.gain * 0.75, o.pan, 0.7, t0 + dur);
      const lo = 300 * p, hi = rand(520, 600) * p;
      const v = osc('sine', lo), v2 = osc('triangle', lo * 2);
      for (const [node, m] of [[v, 1], [v2, 2]]) {
        const fr = node.frequency;
        fr.setValueAtTime(lo * m, t0);
        fr.exponentialRampToValueAtTime(hi * m, t0 + dur * 0.22);
        fr.linearRampToValueAtTime(hi * 1.04 * m, t0 + dur * 0.6);
        fr.exponentialRampToValueAtTime(hi * 0.68 * m, t0 + dur);
      }
      const lfo = osc('sine', 5.2), vib = gain(hi * 0.012), vib2 = gain(hi * 0.024);
      lfo.connect(vib); vib.connect(v.frequency); lfo.connect(vib2); vib2.connect(v2.frequency);
      const g2 = gain(0.18), lp = filter('lowpass', 1900, 0.7), e = gain(0);
      v.connect(lp); v2.connect(g2); g2.connect(lp); lp.connect(e); e.connect(out);
      const n = noise(true), nb = filter('bandpass', 1000, 1.5), ng = gain(0.035);
      n.connect(nb); nb.connect(ng); ng.connect(e);
      env(e, t0, 0.4, 1, dur - 1.0, 0.9);
      for (const s of [v, v2, lfo, n]) { s.start(t0); s.stop(t0 + dur + 0.6); }
    }
    function growl(o, t0 = now()) {
      const dur = rand(0.8, 1.1), out = output(o.gain * 1.1, o.pan, 0.08, t0 + dur);
      const v = osc('sawtooth', 72);
      v.frequency.setValueAtTime(65, t0); v.frequency.linearRampToValueAtTime(85, t0 + dur * 0.4); v.frequency.linearRampToValueAtTime(68, t0 + dur);
      const n = noise(), ng = gain(0.6);
      const mix = gain(1); v.connect(mix); n.connect(ng); ng.connect(mix);
      const rough = gain(0.5), lfo = osc('sine', 26), lg = gain(0.5);
      lfo.connect(lg); lg.connect(rough.gain);
      const lp = filter('lowpass', 520, 1.5), bp = filter('peaking', 260, 2); bp.gain.value = 8;
      const e = gain(0);
      mix.connect(rough); rough.connect(lp); lp.connect(bp); bp.connect(e); e.connect(out);
      env(e, t0, 0.12, 1.4, dur - 0.3, 0.25);
      for (const s of [v, n, lfo]) { s.start(t0); s.stop(t0 + dur + 0.3); }
    }

    // ---------------------------------------------------------------------------
    // Ducks: nasal "quack"
    // ---------------------------------------------------------------------------
    function quackOne(o, t0, p = 1, loud = 1) {
      const f0 = rand(235, 265) * p, dur = rand(0.11, 0.16);
      const out = output(o.gain * loud, o.pan, 0.08, t0 + dur);
      const v = osc('sawtooth', f0), sub = osc('square', f0 / 2);
      v.frequency.setValueAtTime(f0 * 1.12, t0); v.frequency.exponentialRampToValueAtTime(f0 * 0.82, t0 + dur);
      sub.frequency.setValueAtTime(f0 * 0.56, t0); sub.frequency.exponentialRampToValueAtTime(f0 * 0.41, t0 + dur);
      const sh = shaper(3), sg = gain(0.5);
      v.connect(sh); sub.connect(sg); sg.connect(sh);
      const sum = gain(1);
      [[1050, 4, 2.2], [2300, 6, 1.1], [3400, 8, 0.3]].forEach(([f, Q, g]) => {
        const bp = filter('bandpass', f, Q), gg = gain(g); sh.connect(bp); bp.connect(gg); gg.connect(sum);
      });
      const e = gain(0); sum.connect(e); e.connect(out);
      env(e, t0, 0.012, 1, dur - 0.05, 0.05);
      v.start(t0); sub.start(t0); v.stop(t0 + dur + 0.15); sub.stop(t0 + dur + 0.15);
    }
    function quack(o, t0 = now()) {
      const n = Math.random() < 0.5 ? 1 : 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) quackOne(o, t0 + i * rand(0.2, 0.26), 1 - i * 0.04, 1 - i * 0.12);
    }
    function quackScared(o, t0 = now()) {
      const n = 4 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) quackOne(o, t0 + i * 0.15, 1.12 - i * 0.05, 1.15 - i * 0.12);
    }

    // ---------------------------------------------------------------------------
    // Tractor: horn and the beeper when it backs out
    // ---------------------------------------------------------------------------
    function honk(o, t0 = now()) {
      for (let k = 0; k < 2; k++) {
        const t = t0 + k * 0.28, out = output(o.gain * 0.5, o.pan, 0.15, t + 0.25);
        const lp = filter('lowpass', 1700, 1), e = gain(0);
        for (const f of [370, 466]) { const v = osc('square', f); v.connect(lp); v.start(t); v.stop(t + 0.3); }
        lp.connect(e); e.connect(out);
        env(e, t, 0.01, 0.5, 0.17, 0.04);
      }
    }
    function beep(o, t0 = now()) {
      const out = output(o.gain * 0.35, o.pan, 0.05, t0 + 0.3);
      const v = osc('square', 1040), lp = filter('lowpass', 2200, 0.7), e = gain(0);
      v.connect(lp); lp.connect(e); e.connect(out);
      env(e, t0, 0.005, 0.6, 0.22, 0.02);
      v.start(t0); v.stop(t0 + 0.32);
    }

    // ---------------------------------------------------------------------------
    // Birds in the trees: songbirds (three kinds of song), the cuckoo, the owl at night
    // ---------------------------------------------------------------------------
    // one phrase = a single whistle that jumps from note to note: [start, f0, f1, length]
    function whistle(o, t0, notes, wet = 0.18) {
      const end = notes.reduce((m, n) => Math.max(m, n[0] + n[3]), 0);
      const out = output(o.gain * 0.32, o.pan, wet, t0 + end);
      const v = osc('sine', notes[0][1]), h = osc('sine', notes[0][1] * 2), hg = gain(0.12);
      const e = gain(0);
      v.connect(e); h.connect(hg); hg.connect(e); e.connect(out);
      e.gain.setValueAtTime(0, t0);
      for (const [st, f0, f1, len] of notes) {
        const t = t0 + st;
        v.frequency.setValueAtTime(f0, t); v.frequency.exponentialRampToValueAtTime(f1, t + len);
        h.frequency.setValueAtTime(f0 * 2, t); h.frequency.exponentialRampToValueAtTime(f1 * 2, t + len);
        e.gain.setValueAtTime(0, t);
        e.gain.linearRampToValueAtTime(1, t + Math.min(0.012, len * 0.3));
        e.gain.setValueAtTime(1, t + len * 0.7);
        e.gain.linearRampToValueAtTime(0, t + len);
      }
      v.start(t0); h.start(t0); v.stop(t0 + end + 0.05); h.stop(t0 + end + 0.05);
    }
    function birdSong(o, t0 = now()) {
      const p = o.pitch || 1, kind = o.kind || 0, notes = [];
      if (kind === 0) {                                  // "tweet tweet tweet": rising little whistles
        const n = 2 + Math.floor(Math.random() * 3), f = rand(2900, 3600) * p;
        for (let i = 0; i < n; i++) notes.push([i * 0.16, f * 0.8, f * rand(1.15, 1.3), rand(0.07, 0.09)]);
      } else if (kind === 1) {                           // a fast trill, ending with a flourish
        const n = 8 + Math.floor(Math.random() * 7), f = rand(4200, 5200) * p;
        for (let i = 0; i < n; i++) notes.push([i * 0.045, f * (i % 2 ? 0.92 : 1.05), f * (i % 2 ? 0.88 : 1.1), 0.03]);
        notes.push([n * 0.045 + 0.05, f * 1.1, f * 0.62, 0.16]);
      } else {                                           // a blackbird-like warble: a few varied notes
        const n = 4 + Math.floor(Math.random() * 4); let st = 0;
        for (let i = 0; i < n; i++) {
          const f0 = rand(1800, 3400) * p, len = rand(0.07, 0.16);
          notes.push([st, f0, f0 * rand(0.75, 1.35), len]); st += len + rand(0.03, 0.08);
        }
      }
      whistle(o, t0, notes);
    }
    function cuckoo(o, t0 = now()) {
      const n = 2 + Math.floor(Math.random() * 2), f = rand(660, 700);
      for (let k = 0; k < n; k++) {
        const t = t0 + k * 0.75;
        for (const [st, fr, len] of [[0, f, 0.2], [0.27, f * 0.84, 0.3]]) {
          const out = output(o.gain * 0.45, o.pan, 0.35, t + st + len);
          const v = osc('sine', fr), lp = filter('lowpass', 1500, 0.7), e = gain(0);
          v.frequency.setValueAtTime(fr * 1.02, t + st); v.frequency.linearRampToValueAtTime(fr * 0.98, t + st + len);
          v.connect(lp); lp.connect(e); e.connect(out);
          env(e, t + st, 0.03, 1, len - 0.08, 0.12);
          v.start(t + st); v.stop(t + st + len + 0.2);
        }
      }
    }
    function owl(o, t0 = now()) {                        // tawny owl: "Hooo ... hu-hu-huhuuuu"
      for (const [st, len, f] of [[0, 0.55, 410], [1.25, 0.14, 380], [1.48, 0.14, 380], [1.7, 0.75, 395]]) {
        const t = t0 + st, out = output(o.gain * 0.5, o.pan, 0.45, t + len);
        const v = osc('sine', f), lp = filter('lowpass', 900, 0.7), e = gain(0);
        v.frequency.setValueAtTime(f * 0.94, t); v.frequency.linearRampToValueAtTime(f, t + 0.08);
        v.frequency.linearRampToValueAtTime(f * 0.9, t + len);
        const lfo = osc('sine', 9), lg = gain(len > 0.5 ? 0.35 : 0); lfo.connect(lg);
        const am = gain(0.75); lg.connect(am.gain);
        v.connect(lp); lp.connect(am); am.connect(e); e.connect(out);
        env(e, t, 0.05, 1, len - 0.12, 0.15);
        v.start(t); lfo.start(t); v.stop(t + len + 0.25); lfo.stop(t + len + 0.25);
      }
    }

    // ---------------------------------------------------------------------------
    // Recorded sounds: window.WEIDE_SOUNDS = { name: base64 mp3 } (soundeffects/sounds.js).
    // Files are grouped by name: sheep_1, sheep_2, ... -> 'sheep' (a random one plays each time).
    // ---------------------------------------------------------------------------
    const samples = {}, lastPick = {};
    // how loud each kind of recording plays (they are all made equally loud first)
    const SAMPLE_GAIN = { dog_bark: 0.6, sheep: 0.45, wolf: 0.5, duck: 0.45, duck_ambient: 0.6, crickets: 0.4, grassmower: 0.35, beeropen: 0.8, stream: 0.4 };
    // recordings that play over and over: no fading in and out at the ends (that would be a gap)
    const LOOP_GROUPS = ['duck_ambient', 'crickets', 'grassmower', 'stream'];
    const decode = (ab) => new Promise((res, rej) => {
      const p = ctx.decodeAudioData(ab, res, rej);       // (old Safari only knows the callbacks)
      if (p && p.then) p.then(res, rej);
    });
    function loadSamples() {
      const src = window.WEIDE_SOUNDS;
      if (!src) return;
      for (const [name, b64] of Object.entries(src)) {
        const group = name.replace(/_\d+$/, '');
        try {
          const bin = atob(b64), bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          decode(bytes.buffer).then((buf) => { const t = tidy(buf, LOOP_GROUPS.includes(group)); if (t) (samples[group] = samples[group] || []).push(t); }).catch(() => {});
        } catch (e) { /* a broken file: skip it */ }
      }
    }
    // mono (so left/right works), no silence before and after, loudest point = 1, soft edges
    // (loops: cut exactly where the sound starts and ends, no soft edges)
    function tidy(buf, loop = false) {
      const n = buf.length, ch = buf.numberOfChannels, sr = buf.sampleRate, mono = new Float32Array(n);
      for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ch; }
      let pk = 0;
      for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(mono[i]));
      if (pk < 1e-4) return null;
      let a = 0, b = n - 1;
      while (a < n && Math.abs(mono[a]) < pk * 0.02) a++;
      while (b > a && Math.abs(mono[b]) < pk * 0.02) b--;
      if (!loop) { a = Math.max(0, a - Math.round(sr * 0.01)); b = Math.min(n - 1, b + Math.round(sr * 0.06)); }
      const len = b - a + 1, out = ctx.createBuffer(1, len, sr), od = out.getChannelData(0), fade = loop ? 0 : Math.min(len / 4, sr * 0.01);
      for (let i = 0; i < len; i++) {
        const edge = fade ? Math.min(1, i / fade, (len - 1 - i) / fade) : 1;
        od[i] = (mono[a + i] / pk) * edge;
      }
      return out;
    }
    const has = (group) => !!(samples[group] && samples[group].length);
    function pick(group) {
      const L = samples[group];
      let i = Math.floor(Math.random() * L.length);
      if (L.length > 1 && i === lastPick[group]) i = (i + 1) % L.length;   // not the same one twice in a row
      lastPick[group] = i;
      return L[i];
    }
    // play a recording; false if there is none (then the made-up sound plays instead)
    function sample(group, o, rate = 1, vol = 1, wet = 0.1, t0 = now()) {
      if (!has(group)) return false;
      const buf = pick(group), s = ctx.createBufferSource();
      s.buffer = buf; s.playbackRate.value = rate;
      const out = output(o.gain * vol * (SAMPLE_GAIN[group] ?? 0.5), o.pan, wet, t0 + buf.duration / rate);
      s.connect(out); s.start(t0);
      return true;
    }
    const vary = (a = 0.04) => rand(1 - a, 1 + a);

    const ONE_SHOTS = {
      bird: (o) => birdSong(o),
      cuckoo: (o) => cuckoo(o),
      owl: (o) => owl(o),
      baa: (o) => sample('sheep', o, o.pitch * vary(0.03), 1, 0.12) || baa(o),
      baaPanic: (o) => sample('sheep', o, o.pitch * 1.12 * vary(0.03), 1.1, 0.1) || baa({ ...o, panic: true }),
      baaCold: (o) => sample('sheep', o, o.pitch * 1.05, 0.6, 0.1) || baa({ ...o, cold: true, gain: o.gain * 0.75 }),
      woof: (o) => sample('dog_bark', o, o.pitch * vary(), 0.9) || woofOne(o, now()),
      woof2: (o) => {
        const t = now();
        if (sample('dog_bark', o, vary(), 0.9, 0.1, t)) sample('dog_bark', o, vary() * 0.97, 0.8, 0.1, t + rand(0.3, 0.36));
        else { woofOne(o, t); woofOne(o, t + rand(0.26, 0.32), 0.9); }
      },
      bark: (o) => {
        const t = now();
        if (sample('dog_bark', o, 1.03, 1.1, 0.12, t)) sample('dog_bark', o, 0.97, 1, 0.12, t + 0.32);
        else { woofOne({ ...o, pitch: 1.05 }, t, 1.15); woofOne(o, t + 0.3, 1.05); }
      },
      yelp: (o) => yelp(o),
      yawn: (o) => yawn(o),
      howl: (o) => sample('wolf', o, (o.pitch || 1) * vary(0.04), 1, 0.45) || howl(o),
      growl: (o) => growl(o),
      quack: (o) => sample('duck', o, vary(0.08), 0.5, 0.08) || quack(o),
      quackScared: (o) => {
        if (!has('duck')) return quackScared(o);
        const t = now();
        [1.1, 1.02, 0.95].forEach((r, i) => sample('duck', o, r * vary(0.03), 1 - i * 0.15, 0.08, t + i * 0.2));
      },
      honk: (o) => honk(o),
      beerOpen: (o) => sample('beeropen', o, 1, 1, 0.05),     // (recording only)
      beep: (o) => beep(o),
    };

    function play(name, o = {}) {
      if (!ok || !running) return;          // (while the page is still waking the sound up, it is just queued)
      if (voices >= MAX_VOICES && (o.gain || 0) < 0.5) return;   // busy: skip quiet, far-away sounds
      if (voices >= MAX_VOICES * 1.5) return;
      const f = ONE_SHOTS[name];
      if (f) f({ gain: 1, pan: 0, pitch: 1, ...o });
    }

    // ---------------------------------------------------------------------------
    // Steady sounds (loops): built once, then only their volume / pan / tone change
    // ---------------------------------------------------------------------------
    // a recording played over and over (starting somewhere in the middle)
    function recordingLoop(group) {
      if (!has(group)) return null;
      const s = ctx.createBufferSource(), g = gain(SAMPLE_GAIN[group] ?? 0.5);
      s.buffer = samples[group][0]; s.loop = true;
      s.connect(g); s.start(0, rand(0, s.buffer.duration));
      return { out: g };
    }
    const LOOPS = {
      // a lake full of ducks (recording); none without the recording
      duckAmbient: () => recordingLoop('duck_ambient'),
      // crickets on summer evenings (recording); none without the recording
      crickets: () => recordingLoop('crickets'),
      // the farmer's lawn mower (recording)
      mower: () => recordingLoop('grassmower'),
      // a babbling stream (recording)
      stream: () => recordingLoop('stream'),
      // wind: soft rushing noise plus a whistle that grows with the gusts (and the blizzard)
      wind() {
        const n1 = noise(true), n2 = noise(true);
        const bp1 = filter('bandpass', 400, 0.6), bp2 = filter('bandpass', 800, 7);
        const g1 = gain(1.6), g2 = gain(0.2), lp = filter('lowpass', 2600, 0.7);
        n1.connect(bp1); bp1.connect(g1); g1.connect(lp);
        n2.connect(bp2); bp2.connect(g2); g2.connect(lp);
        n1.start(0, 0); n2.start(0, 1.1);
        return { out: lp, tone(s) {
          const t = ctx.currentTime;
          bp1.frequency.setTargetAtTime(220 + 520 * s, t, 0.3);
          bp2.frequency.setTargetAtTime(560 + 900 * s, t, 0.4);
          g2.gain.setTargetAtTime(0.08 + 0.9 * s * s, t, 0.3);
        } };
      },
      // bees: a swarm of slightly out-of-tune buzzes
      bees() {
        const mix = gain(1), bp = filter('bandpass', 560, 1.3), lp = filter('lowpass', 2200, 0.7);
        const wob = osc('sine', 3.3), wg = gain(7);
        wob.connect(wg);
        for (const [f, g] of [[224, 0.5], [231, 0.45], [452, 0.18]]) {
          const v = osc('sawtooth', f), vg = gain(g); wg.connect(v.frequency);
          v.connect(vg); vg.connect(mix); v.start();
        }
        const am = gain(0.75), lfo = osc('sine', 0.9), lg = gain(0.25);
        lfo.connect(lg); lg.connect(am.gain);
        mix.connect(bp); bp.connect(am); am.connect(lp);
        wob.start(); lfo.start();
        return { out: lp };
      },
      // tractor: a chugging diesel; tone = engine speed (0 idle .. 1 driving)
      tractor() {
        const v = osc('sawtooth', 26), sh = shaper(4), lp = filter('lowpass', 320, 2), vg = gain(1);
        v.connect(sh); sh.connect(lp); lp.connect(vg);
        const n = noise(true), nb = filter('bandpass', 650, 0.9), chug = gain(0), pulse = osc('square', 26), pg = gain(0.5);
        pulse.connect(pg); pg.connect(chug.gain);
        n.connect(nb); nb.connect(chug);
        const cg = gain(0.55), mix = gain(0.6);
        chug.connect(cg); cg.connect(mix); vg.connect(mix);
        v.start(); pulse.start(); n.start();
        return { out: mix, tone(s) {
          const t = ctx.currentTime, f = 22 + 16 * s;
          v.frequency.setTargetAtTime(f, t, 0.4); pulse.frequency.setTargetAtTime(f, t, 0.4);
          lp.frequency.setTargetAtTime(260 + 220 * s, t, 0.4);
        } };
      },
      // the dog snoring in its hut (volume follows its breathing, set by the game)
      snore() {
        const n = noise(true), lp = filter('lowpass', 420, 3), v = osc('sawtooth', 48), vg = gain(0.25), mix = gain(1.8);
        n.connect(lp); lp.connect(mix); v.connect(vg); vg.connect(mix);
        n.start(); v.start();
        return { out: mix };
      },
      // the dog panting when it is tired
      pant() {
        const n = noise(true), bp = filter('bandpass', 1700, 1.4), g = gain(2.2);
        n.connect(bp); bp.connect(g); n.start(0, 0.5);
        return { out: g };
      },
    };

    // set a loop's volume (0 = silent), left/right and tone; call every frame
    // (tc: how fast the volume follows, in seconds)
    function loop(name, vol, pan = 0, tone = 0, tc = 0.04) {
      if (!ok) return;
      let L = loops[name];
      if (!L) {
        if (vol < 0.002) return;          // not needed yet
        const made = LOOPS[name]();
        if (!made) return;                // (its recording isn't loaded yet)
        const g = gain(0); made.out.connect(g);
        let tail = g;
        if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); g.connect(p); tail = p; L = { g, p, made }; }
        else L = { g, p: null, made };
        tail.connect(master);
        loops[name] = L;
      }
      const t = ctx.currentTime;
      L.g.gain.setTargetAtTime(Math.max(0, vol), t, tc);
      if (L.p) L.p.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.08);
      if (L.made.tone) L.made.tone(tone);
    }
    function silence() { for (const k in loops) loop(k, 0); }

    return {
      unlock, play, loop, silence, setVolume, setRunning, has,
      get ready() { return ok && ctx.state === 'running'; },
      get ctx() { return ctx; },
      get voices() { return voices; },
    };
  }

  return { create };
})();
