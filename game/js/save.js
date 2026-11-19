// save.js — Cayo Azul saving and loading.
// One key in browser local storage holds the whole game: the player,
// the money, the mission progress, the story flags, the owned cars
// and their garages, the achievements, the play time, and the
// settings (radio station, volume). Saving happens at mission
// checkpoints, at garages, and from the pause menu. A corrupt or
// missing save starts a new game without error — load() never throws.
// Revision notes: load validates the garage and settings shapes, not
// just the top level; inspect() lets the title screen show a Continue
// summary without applying anything; saveIfDue() throttles autosaves
// to one per thirty seconds of play, counted in play seconds, never
// in wall-clock time.
(function () {
  'use strict';
  var CA = window.CA || (window.CA = {});
  if (!CA.state) CA.state = {};

  var KEY = 'cayo-azul-save-v1';
  var VERSION = 1;
  var AUTOSAVE_EVERY = 30;
  var lastAutosaveAt = -AUTOSAVE_EVERY;

  function defaults() {
    return {
      version: VERSION,
      player: { x: 0, y: 0, z: 0, facing: 0, health: 100, money: 500, onFoot: true, carId: null, killStreak: 0 },
      totalEarned: 0,
      ledger: [],
      missionsDone: [],
      activeMission: null,
      flags: {},
      ownedCars: [],
      garages: {},
      achievements: [],
      achievementProgress: {},
      listenedStations: [],
      playSeconds: 0,
      playTimeSeconds: 0,
      day: 1,
      hour: 9,
      minute: 0,
      settings: { volume: 0.8, radioStation: 0, muted: false }
    };
  }

  function snapshot() {
    var s = CA.state;
    var p = s.player || {};
    return {
      version: VERSION,
      player: {
        x: p.x || 0, y: p.y || 0, z: p.z || 0,
        facing: p.facing || 0,
        health: (typeof p.health === 'number') ? p.health : 100,
        money: (typeof p.money === 'number') ? p.money : 500,
        onFoot: p.onFoot !== false,
        carId: p.carId || null,
        killStreak: p.killStreak || 0
      },
      totalEarned: s.totalEarned || 0,
      ledger: (s.ledger || []).slice(-60),
      /* Mission progress lives in storyFlags.missionsDone (the
         missions module's shape); fall back to a top-level list. */
      missionsDone: ((s.storyFlags && s.storyFlags.missionsDone) || s.missionsDone || []).slice(),
      activeMission: s.activeMission || null,
      flags: s.flags || {},
      ownedCars: (s.ownedCars || []).slice(),
      garages: s.garages || {},
      achievements: (s.achievements || []).slice(),
      achievementProgress: s.achievementProgress || {},
      listenedStations: (s.listenedStations || []).slice(),
      /* Canonical play-time field is playTimeSeconds (the events
         module's name); playSeconds is kept as a mirror so older
         saves and the autosave throttle keep working. */
      playSeconds: (typeof s.playSeconds === 'number' ? s.playSeconds : s.playTimeSeconds) || 0,
      playTimeSeconds: (typeof s.playTimeSeconds === 'number' ? s.playTimeSeconds : s.playSeconds) || 0,
      day: s.day || 1,
      hour: (typeof s.hour === 'number') ? s.hour : 9,
      minute: (typeof s.minute === 'number') ? s.minute : 0,
      settings: {
        volume: (s.settings && typeof s.settings.volume === 'number') ? s.settings.volume : 0.8,
        radioStation: (s.settings && typeof s.settings.radioStation === 'number') ? s.settings.radioStation : 0,
        muted: !!(s.settings && s.settings.muted)
      }
    };
  }

  function save(reason) {
    try {
      if (typeof localStorage === 'undefined') return { ok: false, reason: 'no-storage' };
      var data = snapshot();
      localStorage.setItem(KEY, JSON.stringify(data));
      lastAutosaveAt = data.playSeconds;
      if (CA.achievements) CA.achievements.check('first-save');
      if (CA.hud) CA.hud.toast('Game saved' + (reason ? ' — ' + reason : ''));
      return { ok: true, reason: reason || '' };
    } catch (e) {
      return { ok: false, reason: 'write-failed' };
    }
  }

  // Autosave, throttled: at most once per AUTOSAVE_EVERY seconds of
  // play. Call every frame; it saves only when due.
  function saveIfDue(reason) {
    var now = CA.state.playSeconds || 0;
    if (now - lastAutosaveAt < AUTOSAVE_EVERY) return { ok: false, reason: 'not-due' };
    return save(reason || 'autosave');
  }

  function saveCheckpoint(missionId, stage) {
    if (CA.state.activeMission) {
      CA.state.activeMission.stage = stage;
      /* The checkpoint is the stage index the retry resumes from;
         the old code wrote `true` here, which broke retry's clamp. */
      CA.state.activeMission.checkpoint = stage;
    }
    return save('checkpoint' + (missionId ? ' ' + missionId : ''));
  }

  function validShape(data) {
    if (!data || typeof data !== 'object') return false;
    if (data.version !== VERSION) return false;
    if (!data.player || typeof data.player.money !== 'number') return false;
    if (typeof data.player.health !== 'number') return false;
    if (!Array.isArray(data.achievements)) return false;
    if (!Array.isArray(data.missionsDone)) return false;
    if (!Array.isArray(data.ownedCars)) return false;
    if (!data.garages || typeof data.garages !== 'object' || Array.isArray(data.garages)) return false;
    if (!data.settings || typeof data.settings.volume !== 'number') return false;
    if (typeof data.playSeconds !== 'number') return false;
    return true;
  }

  function load() {
    try {
      if (typeof localStorage === 'undefined') return null;
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!validShape(data)) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  // Read-only peek for the title screen: exists / valid / summary,
  // without touching live state.
  function inspect() {
    var data = load();
    if (!data) {
      var exists = hasSave();
      return { exists: exists, valid: false, summary: null };
    }
    return {
      exists: true,
      valid: true,
      summary: {
        money: data.player.money,
        missionsDone: data.missionsDone.length,
        achievements: data.achievements.length,
        cars: data.ownedCars.length,
        playSeconds: data.playSeconds,
        day: data.day
      }
    };
  }

  function apply(data) {
    if (!data || !validShape(data)) return false;
    var d = defaults();
    var out = {};
    var keys = Object.keys(d);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      out[k] = (data[k] !== undefined) ? data[k] : d[k];
    }
    // Merge into the live state object so modules holding a
    // reference to CA.state keep seeing the same object.
    var live = CA.state;
    var liveKeys = Object.keys(out);
    for (var j = 0; j < liveKeys.length; j++) live[liveKeys[j]] = out[liveKeys[j]];
    if (!live.player) live.player = d.player;
    if (!live.settings) live.settings = d.settings;
    /* Keep the two play-time spellings in step, and hand the
       restored mission list back to the missions module's shape. */
    live.playTimeSeconds = live.playSeconds || 0;
    if (!live.storyFlags) live.storyFlags = {};
    live.storyFlags.missionsDone = (live.missionsDone || []).slice();
    lastAutosaveAt = live.playSeconds || 0;
    return true;
  }

  function hasSave() {
    try {
      if (typeof localStorage === 'undefined') return false;
      return localStorage.getItem(KEY) !== null;
    } catch (e) {
      return false;
    }
  }

  function clear() {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.removeItem(KEY);
      lastAutosaveAt = -AUTOSAVE_EVERY;
      return true;
    } catch (e) {
      return false;
    }
  }

  function newGame() {
    var d = defaults();
    var live = CA.state;
    var keys = Object.keys(d);
    for (var i = 0; i < keys.length; i++) live[keys[i]] = d[keys[i]];
    if (CA.particles) CA.particles.clear();
    if (CA.achievements) CA.achievements.reset();
    if (CA.economy) CA.economy.reset();
    lastAutosaveAt = -AUTOSAVE_EVERY;
    return d;
  }

  CA.save = {
    key: KEY,
    version: VERSION,
    autosaveEvery: AUTOSAVE_EVERY,
    save: save,
    saveIfDue: saveIfDue,
    saveCheckpoint: saveCheckpoint,
    load: load,
    inspect: inspect,
    apply: apply,
    hasSave: hasSave,
    clear: clear,
    newGame: newGame,
    defaults: defaults,
    snapshot: snapshot
  };
})();
