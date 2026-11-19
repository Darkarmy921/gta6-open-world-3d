// audio.js — Cayo Azul synthesized sound effects.
// Every sound is made with the browser's own audio synthesis. Nothing is
// loaded from a file, nothing is fetched, nothing is imported.
// Shared state: CA.state.settings.volume (0..1) and .muted. All volume
// goes through that one setting so the pause menu has a single knob.
// Revision notes: noise bursts now advance a counter-fed seed so two
// crashes never sound identical; the engine idles at low rpm while
// the player sits in a car instead of cutting out; mute toggle and a
// traffic honk added; every effect guards against a missing context.
(function () {
  'use strict';
  var CA = window.CA || (window.CA = {});
  if (!CA.state) CA.state = {};
  if (!CA.state.settings) CA.state.settings = { volume: 0.8, radioStation: 0, muted: false };
  if (typeof CA.state.settings.volume !== 'number') CA.state.settings.volume = 0.8;
  if (typeof CA.state.settings.muted !== 'boolean') CA.state.settings.muted = false;

  var ctx = null;
  var master = null;
  var noiseSeed = 987654321;
  var engineOsc1 = null;
  var engineOsc2 = null;
  var engineGain = null;
  var engineFilter = null;
  var engineOn = false;
  var engineIdle = false;
  var sirenOsc = null;
  var sirenLfo = null;
  var sirenGain = null;
  var sirenOn = false;

  function ensureContext() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume();
    master.connect(ctx.destination);
    return ctx;
  }

  function volume() {
    var s = CA.state.settings;
    if (s.muted) return 0;
    var v = typeof s.volume === 'number' ? s.volume : 0.8;
    if (v < 0) v = 0;
    if (v > 1) v = 1;
    return v;
  }

  function applyVolume() {
    if (master && ctx) master.gain.setTargetAtTime(volume(), ctx.currentTime, 0.02);
  }

  function resume() {
    var c = ensureContext();
    if (c && c.state === 'suspended') c.resume();
  }

  // Short oscillator burst: the building block for most effects.
  function blip(freqStart, freqEnd, dur, type, peak, when) {
    var c = ensureContext();
    if (!c) return;
    resume();
    var t0 = c.currentTime + (when || 0);
    var o = c.createOscillator();
    var g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(Math.max(1, freqStart), t0);
    if (freqEnd && freqEnd !== freqStart) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  // Filtered noise burst: thuds, whooshes, splashes. The seed advances
  // on every call so repeated effects do not sound like one sample.
  function noise(dur, filterFreq, peak, type, when) {
    var c = ensureContext();
    if (!c) return;
    resume();
    var t0 = c.currentTime + (when || 0);
    var len = Math.max(1, Math.floor(c.sampleRate * dur));
    var buf = c.createBuffer(1, len, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      noiseSeed = (noiseSeed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (noiseSeed / 0x40000000 - 1) * (1 - i / len);
    }
    var src = c.createBufferSource();
    src.buffer = buf;
    var f = c.createBiquadFilter();
    f.type = type || 'lowpass';
    f.frequency.value = filterFreq;
    var g = c.createGain();
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur);
  }

  function startEngineNodes(c) {
    engineOsc1 = c.createOscillator();
    engineOsc2 = c.createOscillator();
    engineGain = c.createGain();
    engineFilter = c.createBiquadFilter();
    engineOsc1.type = 'sawtooth';
    engineOsc2.type = 'square';
    engineGain.gain.value = 0.03;
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 900;
    engineOsc1.connect(engineFilter);
    engineOsc2.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);
    engineOsc1.start();
    engineOsc2.start();
    engineOn = true;
  }

  // Engine hum: two detuned oscillators whose pitch follows speed 0..1.
  // Call every frame while driving. inCar keeps a low idle hum when
  // speed is zero; on foot with no speed the hum stops entirely.
  function engine(speed01, dt, inCar) {
    var c = ensureContext();
    if (!c) return;
    var s = speed01 == null ? 0 : speed01;
    if (s < 0) s = 0;
    if (s > 1) s = 1;
    if (s <= 0.01 && !inCar) { stopEngine(); return; }
    resume();
    if (!engineOn) startEngineNodes(c);
    var t = c.currentTime;
    if (s <= 0.01) {
      engineIdle = true;
      engineOsc1.frequency.setTargetAtTime(48, t, 0.05);
      engineOsc2.frequency.setTargetAtTime(72, t, 0.05);
      engineGain.gain.setTargetAtTime(0.025, t, 0.1);
      return;
    }
    engineIdle = false;
    var base = 55 + s * 165;
    engineOsc1.frequency.setTargetAtTime(base, t, 0.05);
    engineOsc2.frequency.setTargetAtTime(base * 1.5 + 2, t, 0.05);
    engineGain.gain.setTargetAtTime(0.04 + s * 0.09, t, 0.08);
  }

  function stopEngine() {
    if (!engineOn) return;
    try {
      var t = ctx.currentTime;
      engineGain.gain.setTargetAtTime(0.0001, t, 0.05);
      engineOsc1.stop(t + 0.2);
      engineOsc2.stop(t + 0.2);
    } catch (e) { /* already stopped */ }
    engineOsc1 = null;
    engineOsc2 = null;
    engineGain = null;
    engineFilter = null;
    engineOn = false;
    engineIdle = false;
  }

  function crash(strength) {
    var s = strength == null ? 0.6 : strength;
    if (s < 0) s = 0;
    if (s > 1) s = 1;
    noise(0.28 + s * 0.25, 300 + s * 500, 0.25 + s * 0.55, 'lowpass');
    blip(120, 38, 0.3 + s * 0.2, 'sine', 0.35 + s * 0.4);
    if (s > 0.7) noise(0.15, 2500, 0.2, 'highpass', 0.02);
  }

  function whoosh() {
    noise(0.18, 1800, 0.22, 'bandpass');
  }

  function honk() {
    blip(370, 370, 0.16, 'square', 0.12);
    blip(466, 466, 0.16, 'square', 0.1);
  }

  function pickup() {
    blip(660, 660, 0.09, 'sine', 0.25);
    blip(880, 880, 0.12, 'sine', 0.25, 0.08);
    blip(1320, 1320, 0.16, 'sine', 0.2, 0.16);
  }

  function radioClick() {
    blip(1900, 1400, 0.05, 'square', 0.12);
  }

  function splashSound() {
    noise(0.22, 900, 0.14, 'bandpass');
  }

  // Mission-complete jingle: a short rising major phrase.
  function jingle() {
    var notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    for (var i = 0; i < notes.length; i++) {
      blip(notes[i], notes[i], 0.22, 'triangle', 0.28, i * 0.13);
    }
  }

  // Fail sting: two falling notes, used when a mission fails.
  function failSting() {
    blip(392, 392, 0.25, 'triangle', 0.25);
    blip(311.13, 233.08, 0.5, 'triangle', 0.25, 0.22);
  }

  // Siren wail: one oscillator swung up and down by a slow LFO.
  // siren(true) starts it, siren(false) stops it.
  function siren(on) {
    var c = ensureContext();
    if (!c) return;
    if (on && !sirenOn) {
      resume();
      sirenOsc = c.createOscillator();
      sirenOsc.type = 'triangle';
      sirenOsc.frequency.value = 750;
      sirenLfo = c.createOscillator();
      sirenLfo.type = 'sine';
      sirenLfo.frequency.value = 0.6;
      var lfoGain = c.createGain();
      lfoGain.gain.value = 280;
      sirenGain = c.createGain();
      sirenGain.gain.value = 0.05;
      sirenLfo.connect(lfoGain);
      lfoGain.connect(sirenOsc.frequency);
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
      sirenLfo.start();
      sirenOn = true;
    } else if (!on && sirenOn) {
      try {
        var t = c.currentTime;
        sirenGain.gain.setTargetAtTime(0.0001, t, 0.1);
        sirenOsc.stop(t + 0.4);
        sirenLfo.stop(t + 0.4);
      } catch (e) { /* already stopped */ }
      sirenOsc = null;
      sirenLfo = null;
      sirenGain = null;
      sirenOn = false;
    }
  }

  function setVolume(v) {
    if (typeof v !== 'number') return;
    if (v < 0) v = 0;
    if (v > 1) v = 1;
    CA.state.settings.volume = v;
    applyVolume();
  }

  function setMuted(m) {
    CA.state.settings.muted = !!m;
    applyVolume();
  }

  function toggleMute() {
    setMuted(!CA.state.settings.muted);
    return CA.state.settings.muted;
  }

  function update(dt) {
    // Volume can be changed from the pause menu at any time; keep the
    // master gain in step with the setting every frame.
    applyVolume();
  }

  /* Named sound effects by string name. (G integration: the car,
     traffic, player and police modules call audio.play(name) or
     audio.sfx(name); this maps each name onto the named functions
     above so a steal, a door slam or a hurt cry actually sounds.) */
  function sfx(name) {
    try {
      switch (name) {
        case 'crash': crash(0.6); break;
        case 'whoosh': case 'melee': whoosh(); break;
        case 'honk': case 'horn': honk(); break;
        case 'pickup': case 'steal': pickup(); break;
        case 'jingle': jingle(); break;
        case 'failSting': case 'busted': case 'wasted': failSting(); break;
        case 'siren': siren(true); break;
        case 'door': blip(220, 170, 0.12, 'square', 0.2); break;
        case 'glass': noise(0.15, 4200, 0.25); break;
        case 'hurt': blip(170, 90, 0.22, 'sawtooth', 0.3); break;
        case 'heal': blip(520, 780, 0.25, 'sine', 0.2); break;
        case 'engine': break;
        default: blip(440, 440, 0.08, 'sine', 0.12); break;
      }
    } catch (e) { /* sound is never fatal */ }
  }

  CA.audio = {
    ensureContext: ensureContext,
    resume: resume,
    setVolume: setVolume,
    getVolume: volume,
    setMuted: setMuted,
    toggleMute: toggleMute,
    isMuted: function () { return !!CA.state.settings.muted; },
    sfx: sfx,
    play: sfx,
    blip: blip,
    noise: noise,
    engine: engine,
    stopEngine: stopEngine,
    crash: crash,
    whoosh: whoosh,
    honk: honk,
    pickup: pickup,
    radioClick: radioClick,
    splashSound: splashSound,
    jingle: jingle,
    failSting: failSting,
    siren: siren,
    update: update,
    isEngineOn: function () { return engineOn; },
    isEngineIdle: function () { return engineIdle; },
    isSirenOn: function () { return sirenOn; }
  };
})();
