/* Cayo Azul — weather.js (Module B) — revision 2
   Time of day and rain. A full day lasts a few minutes of play.
   Dawn, midday, dusk and night each have their own sky tint, light
   level and window lights. Rain starts and stops on its own
   schedule and can be forced; it darkens the light and loosens car
   handling slightly. Owns the clock and the rain, and sets the
   sky/clear colour and sun uniforms each frame.
   Revision changes: window lights now ramp gradually through dusk
   (17:00–19:00) instead of snapping on at 19:00; the rain schedule
   is seeded by the day count so the same day always rains at the
   same times; added phase(), clockText() and reset() helpers and
   an advance(hours) staging helper for the screenshot scenes. */
(function () {
  'use strict';
  var CA = window.CA || (window.CA = {});

  var DAY_LENGTH = 240; /* seconds of play per full day */
  var START_HOUR = 8;   /* game opens at 08:00 */
  var NIGHT_START = 19;
  var NIGHT_END = 6;
  var DUSK_START = 17;  /* window lights start ramping up here */

  /* Sky tints and light levels keyed by phase of day. */
  var PHASES = [
    { hour: 0,  name: 'night', sky: [0.04, 0.05, 0.10], sun: [0.16, 0.16, 0.22], ambient: [0.26, 0.26, 0.32], sunDir: [0.2, -0.6, 0.4] },
    { hour: 5,  name: 'dawn',  sky: [0.85, 0.55, 0.40], sun: [0.90, 0.55, 0.35], ambient: [0.45, 0.38, 0.38], sunDir: [0.8, 0.25, 0.2] },
    { hour: 8,  name: 'day',   sky: [0.45, 0.70, 0.95], sun: [1.00, 0.95, 0.85], ambient: [0.55, 0.55, 0.55], sunDir: [0.4, 0.9, 0.3] },
    { hour: 12, name: 'day',   sky: [0.50, 0.75, 0.98], sun: [1.00, 0.98, 0.90], ambient: [0.60, 0.60, 0.60], sunDir: [0.1, 1.0, 0.1] },
    { hour: 16, name: 'day',   sky: [0.55, 0.70, 0.90], sun: [1.00, 0.90, 0.70], ambient: [0.55, 0.52, 0.50], sunDir: [-0.5, 0.7, 0.3] },
    { hour: 18, name: 'dusk',  sky: [0.95, 0.55, 0.35], sun: [0.95, 0.50, 0.30], ambient: [0.45, 0.35, 0.35], sunDir: [-0.9, 0.2, 0.2] },
    { hour: 20, name: 'night', sky: [0.05, 0.06, 0.12], sun: [0.18, 0.18, 0.26], ambient: [0.28, 0.28, 0.34], sunDir: [-0.2, -0.6, -0.4] },
    { hour: 24, name: 'night', sky: [0.04, 0.05, 0.10], sun: [0.16, 0.16, 0.22], ambient: [0.26, 0.26, 0.32], sunDir: [0.2, -0.6, 0.4] }
  ];

  var state = {
    dayTime: (START_HOUR / 24) * DAY_LENGTH,
    day: 1,
    raining: false,
    intensity: 0,        /* 0 = dry, 1 = heaviest */
    rainTimer: 90,       /* seconds until the next rain change */
    forced: false        /* rain forced on (screenshot scenes) */
  };

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

  function hour() { return (state.dayTime / DAY_LENGTH) * 24; }
  function minute() { return Math.floor((hour() % 1) * 60); }
  function isNight() { var h = hour(); return h >= NIGHT_START || h < NIGHT_END; }
  function isRaining() { return state.raining && state.intensity > 0.05; }
  function rainIntensity() { return state.raining ? state.intensity : 0; }

  /* 0 in full daylight, 1 at night, ramping through dusk and
     fading back out after dawn. Drives the lit-windows buffer. */
  function windowLightLevel() {
    var h = hour();
    if (h >= NIGHT_START || h < NIGHT_END) return 1;
    if (h >= DUSK_START && h < NIGHT_START) return (h - DUSK_START) / (NIGHT_START - DUSK_START);
    if (h >= NIGHT_END && h < NIGHT_END + 1) return 1 - (h - NIGHT_END);
    return 0;
  }

  function phaseAt(h) {
    var prev = PHASES[0], next = PHASES[PHASES.length - 1];
    for (var i = 0; i < PHASES.length; i++) {
      if (PHASES[i].hour <= h) prev = PHASES[i];
      if (PHASES[i].hour >= h) { next = PHASES[i]; break; }
    }
    var span = next.hour - prev.hour;
    var t = span > 0 ? (h - prev.hour) / span : 0;
    return {
      name: t < 0.5 ? prev.name : next.name,
      sky: lerp3(prev.sky, next.sky, t),
      sun: lerp3(prev.sun, next.sun, t),
      ambient: lerp3(prev.ambient, next.ambient, t),
      sunDir: lerp3(prev.sunDir, next.sunDir, t)
    };
  }
  function phase() { return phaseAt(hour()).name; }

  function clockText() {
    var h = Math.floor(hour());
    var m = minute();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  /* Rain runs on its own schedule, seeded by the day count: the
     same day always rains at the same times. Dry spells of a
     minute or two, then a shower that ramps up, holds, and fades.
     The schedule advances only with the dt the loop passes in,
     never with the wall clock. */
  function daySeed() {
    var s = (state.day * 2654435761) >>> 0;
    s ^= s >>> 13; s = Math.imul(s, 0x5bd1e995); s ^= s >>> 15;
    return (s >>> 0) / 4294967296;
  }
  function updateRain(dt) {
    if (state.forced) {
      state.raining = true;
      state.intensity = Math.min(1, state.intensity + dt * 0.5);
      return;
    }
    state.rainTimer -= dt;
    if (state.rainTimer > 0) return;
    var seed = daySeed();
    if (!state.raining) {
      state.raining = true;
      state.intensity = 0.15;
      state.rainTimer = 22 + seed * 26;
    } else {
      state.raining = false;
      state.intensity = 0;
      state.rainTimer = 65 + seed * 55;
    }
  }

  function update(dt) {
    if (!dt || dt <= 0) dt = 0;
    if (dt > 0.5) dt = 0.5; /* clamp large gaps (tab switch) */
    state.dayTime += dt;
    if (state.dayTime >= DAY_LENGTH) {
      state.dayTime -= DAY_LENGTH;
      state.day += 1;
    }
    updateRain(dt);
    if (state.raining) {
      var target = 0.55 + 0.35 * Math.sin(state.dayTime * 0.11 + state.day);
      state.intensity += (target - state.intensity) * Math.min(1, dt * 0.4);
      state.intensity = clamp(state.intensity, 0.15, 1);
    }
    if (CA.state) {
      CA.state.clock = CA.state.clock || {};
      CA.state.clock.hour = hour();
      CA.state.clock.minute = minute();
      CA.state.clock.day = state.day;
      CA.state.weather = CA.state.weather || {};
      CA.state.weather.raining = isRaining();
      CA.state.weather.intensity = rainIntensity();
    }
    return currentLighting();
  }

  function currentLighting() {
    var phase = phaseAt(hour());
    var sky = phase.sky.slice();
    var sun = phase.sun.slice();
    var ambient = phase.ambient.slice();
    if (isRaining()) {
      var damp = 1 - 0.35 * state.intensity;
      sky = [sky[0] * damp, sky[1] * damp, sky[2] * damp + 0.03 * state.intensity];
      sun = [sun[0] * damp, sun[1] * damp, sun[2] * damp];
      ambient = [ambient[0] * damp, ambient[1] * damp, ambient[2] * damp];
    }
    return {
      phase: phase.name,
      sky: sky, sun: sun, ambient: ambient, sunDir: phase.sunDir,
      night: isNight(),
      windowLights: windowLightLevel(),
      rain: rainIntensity(),
      gripFactor: 1 - 0.12 * rainIntensity() /* looser handling in rain */
    };
  }

  /* Push the current sky and sun into the renderer each frame.
     (G integration: the engine's real names are setSkyColor(r,g,b),
     setSun(dir,color) and setAmbient(color) — no setClearColor,
     and the ambient light is a separate call, not a setSun arg.) */
  function apply(gl) {
    var light = currentLighting();
    var renderer = gl || CA.gl;
    if (renderer) {
      if (typeof renderer.setSkyColor === 'function') {
        renderer.setSkyColor(light.sky[0], light.sky[1], light.sky[2]);
      }
      if (typeof renderer.setSun === 'function') renderer.setSun(light.sunDir, light.sun);
      if (typeof renderer.setAmbient === 'function') renderer.setAmbient(light.ambient);
      if (typeof renderer.setFog === 'function') renderer.setFog(light.sky, isNight() ? 900 : 1400);
    }
    return light;
  }

  /* Rain handling factor for car physics: 1 when dry, up to 1.25
     in heavy rain. (G integration: the car module asks for
     rainFactor(); gripFactor lives on lighting() instead.) */
  function rainFactor() { return 1 + 0.25 * rainIntensity(); }

  function setHour(h, m) {
    state.dayTime = ((h % 24) / 24) * DAY_LENGTH + ((m || 0) / 60 / 24) * DAY_LENGTH;
  }

  /* Move the clock forward by whole hours (screenshot staging);
     rain state is left alone so a forced shower survives. */
  function advance(hours) {
    state.dayTime += (hours / 24) * DAY_LENGTH;
    while (state.dayTime >= DAY_LENGTH) { state.dayTime -= DAY_LENGTH; state.day += 1; }
  }

  function forceRain(on, intensity) {
    state.forced = !!on;
    if (on) { state.raining = true; state.intensity = intensity || 0.7; }
    else { state.raining = false; state.intensity = 0; }
  }

  function reset() {
    state.dayTime = (START_HOUR / 24) * DAY_LENGTH;
    state.day = 1;
    state.raining = false;
    state.intensity = 0;
    state.rainTimer = 90;
    state.forced = false;
  }

  CA.weather = {
    update: update,
    apply: apply,
    hour: hour,
    minute: minute,
    clockText: clockText,
    phase: phase,
    isNight: isNight,
    isRaining: isRaining,
    rainIntensity: rainIntensity,
    rainFactor: rainFactor,
    windowLightLevel: windowLightLevel,
    lighting: currentLighting,
    setHour: setHour,
    advance: advance,
    forceRain: forceRain,
    reset: reset,
    dayLength: DAY_LENGTH,
    day: function () { return state.day; }
  };
})();
