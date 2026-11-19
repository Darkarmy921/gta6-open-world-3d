// main.js — Cayo Azul entry point, loop owner and screen owner.
//
// Owns the central CA.state object, the fixed-step loop, every screen
// (title, pause, busted, wasted, loading), the button wiring, the
// per-frame calls each module needs, save/load, the shot staging and
// the mission-8 ending choice. Written fresh from the design spec and
// the progress tracker. No network, no library, no clock randomness:
// the only time read is the animation-frame timestamp.
//
// Revision pass: wires the two remaining achievement hooks no module
// calls (wanted level changes, kill-streak changes), gives the player
// feedback when a mission fails and lets M retry it, and splits the
// audio and achievement-toast work out of the step function.

(function () {
  var CA = window.CA || (window.CA = {});

  var STEP = 1 / 60;
  var MAX_STEPS = 4;
  var DT_CLAMP = 0.1;
  var TOP_SPEED = 42;
  var EVENT_FIRST_AFTER = 40;
  var CHASE_STOP_TIME = 1.5;
  var JOB_STOP_TIME = 1.0;
  var GARAGE_HINT_RADIUS = 26;
  var LANDMARK_VISIT_RADIUS = 30;
  var DEFAULT_HINT = 'E enter car · F melee · R radio · M mission · G garage · Esc pause';

  var canvas = null;
  var currentScreen = 'title';
  var framesDrawn = 0;
  var firstFrameDone = false;
  var lastTime = 0;
  var accumulator = 0;
  var running = false;
  var interacted = false;
  var shotMode = false;
  var shotNumber = 0;
  var seedText = 'cayo-azul';
  var mainRng = null;
  var booted = false;

  var lastBustedAt = null;
  var lastWastedAt = null;
  var lastMissionId = 0;
  var lastMissionStage = -1;
  var lastMissionsDone = 0;
  var lastMissionStartHealth = 100;
  var lastMissionFailed = false;
  var lastWantedLevel = 0;
  var lastWasFive = false;
  var lastStreak = 0;
  var lastDistrict = '';
  var visitedLandmarks = {};
  var nextEventAt = EVENT_FIRST_AFTER;
  var chaseStopTimer = 0;
  var chaseStopReported = false;
  var jobStopTimer = 0;
  var endingPending = false;
  var hintText = '';
  var garageHintShown = false;

  function el(id) {
    if (typeof document === 'undefined') return null;
    return document.getElementById(id);
  }

  function has(obj, name) {
    return !!obj && typeof obj[name] === 'function';
  }

  function call(obj, name, a, b, c) {
    if (!has(obj, name)) return undefined;
    try {
      return obj[name](a, b, c);
    } catch (e) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('CA.main: ' + name + ' failed: ' + (e && e.message ? e.message : e));
      }
      return undefined;
    }
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function dist2(ax, az, bx, bz) {
    var dx = ax - bx;
    var dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function parseParams() {
    var out = { shot: 0, seed: '' };
    if (typeof window === 'undefined' || !window.location) return out;
    var q = window.location.search || '';
    if (q.charAt(0) === '?') q = q.slice(1);
    var parts = q.split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      var k = '';
      var v = '';
      try {
        k = decodeURIComponent(kv[0] || '');
        v = decodeURIComponent(kv[1] || '');
      } catch (e) {
        k = kv[0] || '';
        v = kv[1] || '';
      }
      if (k === 'shot') out.shot = parseInt(v, 10) || 0;
      if (k === 'seed') out.seed = v;
    }
    return out;
  }

  // ---- central state -------------------------------------------------

  function freshState() {
    return {
      seed: seedText,
      screen: 'title',
      player: {
        x: -240, y: 0, z: -1080, facing: 0, speed: 0,
        health: 100, money: 500, onFoot: true, carId: null,
        killStreak: 0, stamina: 100, walkPhase: 0,
        meleeCooldown: 0, meleeSwing: 0, totalKnockdowns: 0
      },
      cars: [],
      pedestrians: [],
      police: [],
      policeCars: [],
      roadblocks: [],
      wanted: 0,
      clock: { hour: 8, minute: 0, day: 1 },
      weather: { raining: false, intensity: 0 },
      activeMission: null,
      activeJob: null,
      activeEvent: null,
      storyFlags: {
        missionsDone: [], charactersMet: [], callsHeard: [],
        ending: null, finished: false
      },
      flags: {},
      missionsDone: [],
      achievements: [],
      achievementProgress: {},
      garages: {},
      ownedCars: [],
      totalEarned: 0,
      ledger: [],
      listenedStations: [],
      playSeconds: 0,
      playTimeSeconds: 0,
      day: 1,
      hour: 8,
      minute: 0,
      settings: { volume: 0.8, radioStation: 0, muted: false },
      jobStats: { taxi: 0, parcel: 0, vigilante: 0, race: 0, earned: 0 },
      jobHistory: [],
      jobPickCounter: 0,
      eventCooldowns: {},
      eventStats: {},
      eventPickCounter: 0,
      lastMeleeAt: 0,
      lastMeleeX: 0,
      lastMeleeZ: 0,
      lastGunshotAt: 0,
      lastGunshotX: 0,
      lastGunshotZ: 0,
      lastCrimeTime: 0,
      lastSeenTime: 0,
      lastBusted: null,
      lastWasted: null,
      districtsVisited: [],
      landmarksVisited: []
    };
  }

  function resetWorldLists() {
    var s = CA.state;
    s.cars = [];
    s.pedestrians = [];
    s.police = [];
    s.policeCars = [];
    s.roadblocks = [];
    s.wanted = 0;
    s.activeMission = null;
    s.activeJob = null;
    s.activeEvent = null;
  }

  function spawnStarterCars() {
    if (!has(CA.cars, 'spawnCar')) return;
    // The sedan the player walks to, parked by the Harbour Cafe.
    call(CA.cars, 'spawnCar', 'sedan', -214, -1064, 0, { driver: 'none', parked: true });
    call(CA.cars, 'spawnCar', 'hatchback', -196, -1096, Math.PI / 2, { driver: 'none', parked: true });
    call(CA.cars, 'spawnCar', 'taxi', -268, -1048, -Math.PI / 2, { driver: 'none', parked: true });
    call(CA.cars, 'spawnCar', 'pickup', -180, -1120, Math.PI, { driver: 'none', parked: true });
  }

  function placePlayerAtCafe() {
    var p = CA.state.player;
    p.x = -240;
    p.y = 0;
    p.z = -1080;
    p.facing = 0;
    p.speed = 0;
    p.health = 100;
    p.onFoot = true;
    p.carId = null;
    if (has(CA.player, 'setPosition')) call(CA.player, 'setPosition', -240, -1080, 0);
  }

  function resetRunTrackers() {
    lastBustedAt = null;
    lastWastedAt = null;
    lastMissionId = 0;
    lastMissionStage = -1;
    lastMissionsDone = 0;
    lastMissionStartHealth = 100;
    lastMissionFailed = false;
    lastWantedLevel = 0;
    lastWasFive = false;
    lastStreak = 0;
    lastDistrict = '';
    visitedLandmarks = {};
    nextEventAt = EVENT_FIRST_AFTER;
    chaseStopTimer = 0;
    chaseStopReported = false;
    jobStopTimer = 0;
    endingPending = false;
  }

  // ---- screens --------------------------------------------------------

  var SCREEN_IDS = {
    title: 'title-screen',
    paused: 'pause-screen',
    busted: 'busted-screen',
    wasted: 'wasted-screen'
  };

  function showScreen(name) {
    currentScreen = name;
    if (CA.state) CA.state.screen = name;
    var keys = Object.keys(SCREEN_IDS);
    for (var i = 0; i < keys.length; i++) {
      var node = el(SCREEN_IDS[keys[i]]);
      if (node) node.hidden = (keys[i] !== name);
    }
    if (name === 'playing') {
      if (has(CA.hud, 'hideScreens')) call(CA.hud, 'hideScreens');
      if (has(CA.hud, 'hideFine')) call(CA.hud, 'hideFine');
    }
    if (has(CA.input, 'reset')) call(CA.input, 'reset');
  }

  function refreshTitleButtons() {
    var cont = el('btn-continue');
    if (!cont) return;
    var info = null;
    if (has(CA.save, 'inspect')) {
      try { info = CA.save.inspect(); } catch (e) { info = null; }
    }
    cont.disabled = !(info && info.valid);
    if (info && info.valid && info.summary) {
      cont.textContent = 'Continue — Day ' + info.summary.day +
        ' · $' + info.summary.money +
        ' · ' + info.summary.missionsDone + ' mission' +
        (info.summary.missionsDone === 1 ? '' : 's') + ' done';
    } else {
      cont.textContent = 'Continue';
    }
  }

  function quitToTitle() {
    call(CA.save, 'save', 'quit-to-title');
    if (has(CA.audio, 'siren')) call(CA.audio, 'siren', false);
    if (has(CA.audio, 'stopEngine')) call(CA.audio, 'stopEngine');
    if (has(CA.radio, 'stop')) call(CA.radio, 'stop');
    refreshTitleButtons();
    showScreen('title');
  }

  function pauseGame() {
    if (currentScreen !== 'playing') return;
    showScreen('paused');
    if (has(CA.audio, 'siren')) call(CA.audio, 'siren', false);
    if (has(CA.audio, 'stopEngine')) call(CA.audio, 'stopEngine');
  }

  function resumeGame() {
    if (currentScreen !== 'paused' && currentScreen !== 'busted' && currentScreen !== 'wasted') return;
    showScreen('playing');
  }

  // ---- game start / load ----------------------------------------------

  function applyLoadedTime() {
    var s = CA.state;
    var h = (typeof s.hour === 'number') ? s.hour : 8;
    var m = (typeof s.minute === 'number') ? s.minute : 0;
    if (has(CA.weather, 'setHour')) call(CA.weather, 'setHour', h, m);
  }

  function afterLoadSync() {
    var s = CA.state;
    if (!s.player) s.player = freshState().player;
    var p = s.player;
    if (typeof p.x !== 'number') p.x = -240;
    if (typeof p.z !== 'number') p.z = -1080;
    if (typeof p.facing !== 'number') p.facing = 0;
    if (typeof p.health !== 'number' || p.health <= 0) p.health = 100;
    if (typeof p.money !== 'number') p.money = 500;
    if (p.carId) {
      var found = false;
      for (var i = 0; i < (s.cars || []).length; i++) {
        if (s.cars[i] && s.cars[i].id === p.carId) { found = true; break; }
      }
      if (!found) { p.carId = null; p.onFoot = true; }
    }
    if (!s.storyFlags) s.storyFlags = { missionsDone: [], charactersMet: [], callsHeard: [], ending: null, finished: false };
    if (!s.storyFlags.missionsDone) s.storyFlags.missionsDone = (s.missionsDone || []).slice();
    s.missionsDone = s.storyFlags.missionsDone.slice();
    lastMissionsDone = s.storyFlags.missionsDone.length;
    lastMissionId = s.activeMission ? s.activeMission.id : 0;
    lastMissionStage = s.activeMission ? s.activeMission.stage : -1;
    lastMissionStartHealth = p.health;
    lastMissionFailed = !!(s.activeMission && s.activeMission.failed);
    lastWantedLevel = has(CA.police, 'level') ? (call(CA.police, 'level') || 0) : 0;
    lastWasFive = lastWantedLevel >= 5;
    lastStreak = p.killStreak || 0;
    applyLoadedTime();
    if (has(CA.camera, 'snapTo')) call(CA.camera, 'snapTo', p);
    if (has(CA.player, 'setPosition')) call(CA.player, 'setPosition', p.x, p.z, p.facing);
    nextEventAt = (s.playTimeSeconds || 0) + EVENT_FIRST_AFTER;
    endingPending = false;
  }

  function newGame() {
    if (has(CA.save, 'newGame')) call(CA.save, 'newGame');
    var keepSeed = CA.state ? CA.state.seed : seedText;
    CA.state = freshState();
    CA.state.seed = keepSeed;
    resetWorldLists();
    if (has(CA.weather, 'reset')) call(CA.weather, 'reset');
    if (has(CA.camera, 'reset')) call(CA.camera, 'reset');
    if (has(CA.particles, 'clear')) call(CA.particles, 'clear');
    placePlayerAtCafe();
    spawnStarterCars();
    resetRunTrackers();
    if (has(CA.camera, 'snapTo')) call(CA.camera, 'snapTo', CA.state.player);
    startPlaying();
    if (has(CA.hud, 'toast')) call(CA.hud, 'toast', 'Welcome to Cayo Azul — press M for your first job');
    if (has(CA.story, 'intro')) {
      var intro = null;
      try { intro = CA.story.intro(); } catch (e) { intro = null; }
      if (intro && has(CA.hud, 'showBanner')) call(CA.hud, 'showBanner', intro);
    }
  }

  function continueGame() {
    if (!has(CA.save, 'load') || !has(CA.save, 'apply')) return false;
    var data = null;
    try { data = CA.save.load(); } catch (e) { data = null; }
    if (!data) return false;
    var ok = false;
    try { ok = CA.save.apply(data); } catch (e) { ok = false; }
    if (!ok) return false;
    afterLoadSync();
    startPlaying();
    if (has(CA.hud, 'toast')) call(CA.hud, 'toast', 'Welcome back to Cayo Azul');
    return true;
  }

  function startPlaying() {
    showScreen('playing');
    ensureAudioStarted();
  }

  // ---- audio / radio ---------------------------------------------------

  function ensureAudioStarted() {
    if (!interacted) {
      interacted = true;
      if (has(CA.audio, 'resume')) call(CA.audio, 'resume');
      if (has(CA.audio, 'ensureContext')) call(CA.audio, 'ensureContext');
      if (has(CA.radio, 'start')) call(CA.radio, 'start');
    }
  }

  function bindFirstInteraction() {
    if (typeof document === 'undefined') return;
    function once() { ensureAudioStarted(); }
    document.addEventListener('pointerdown', once, { once: true });
    document.addEventListener('keydown', once, { once: true });
  }

  function updateAudio(dt) {
    var p = CA.state.player;
    var speed01 = clamp(Math.abs(p.speed || 0) / TOP_SPEED, 0, 1);
    if (has(CA.audio, 'engine')) call(CA.audio, 'engine', speed01, dt, !p.onFoot);
    var wanted = has(CA.police, 'level') ? call(CA.police, 'level') : 0;
    if (has(CA.audio, 'siren')) call(CA.audio, 'siren', wanted >= 2);
    call(CA.audio, 'update', dt);
    call(CA.radio, 'update', dt);
  }

  function drainAchievementToasts() {
    if (!has(CA.achievements, 'pendingToasts') || !has(CA.achievements, 'nextToast')) return;
    var guard = 0;
    while (call(CA.achievements, 'pendingToasts') > 0 && guard < 8) {
      guard++;
      var toast = call(CA.achievements, 'nextToast');
      if (toast && has(CA.hud, 'toast')) call(CA.hud, 'toast', toast);
    }
  }

  // ---- global keys (handled once per fixed step) ------------------------

  function handleGlobalKeys() {
    if (!CA.input) return;
    if (call(CA.input, 'wasPressed', 'Escape') || call(CA.input, 'wasPressed', 'KeyP')) {
      if (currentScreen === 'playing' && !shotMode) pauseGame();
      else if (currentScreen === 'paused') resumeGame();
      return;
    }
    if (currentScreen !== 'playing') return;
    if (call(CA.input, 'wasPressed', 'KeyM')) {
      if (CA.state.activeMission && CA.state.activeMission.failed) {
        if (has(CA.missions, 'retry')) call(CA.missions, 'retry');
      } else if (CA.state.activeMission) {
        var text = '';
        if (has(CA.missions, 'objectiveText')) text = call(CA.missions, 'objectiveText') || '';
        if (text && has(CA.hud, 'toast')) call(CA.hud, 'toast', text);
      } else if (has(CA.missions, 'startNext')) {
        call(CA.missions, 'startNext');
      }
    }
    if (call(CA.input, 'wasPressed', 'KeyR')) {
      if (has(CA.radio, 'next')) call(CA.radio, 'next');
      if (has(CA.audio, 'radioClick')) call(CA.audio, 'radioClick');
      if (has(CA.achievements, 'stationsChanged')) call(CA.achievements, 'stationsChanged');
    }
    if (call(CA.input, 'wasPressed', 'KeyG')) garageAction();
    if (call(CA.input, 'wasPressed', 'KeyJ')) toggleJobsPanel();
    if (endingPending) {
      if (call(CA.input, 'wasPressed', 'Digit1') || call(CA.input, 'wasPressed', 'Numpad1')) {
        chooseEnding('harbour');
      } else if (call(CA.input, 'wasPressed', 'Digit2') || call(CA.input, 'wasPressed', 'Numpad2')) {
        chooseEnding('crown');
      }
    }
  }

  function chooseEnding(choice) {
    if (!endingPending) return;
    endingPending = false;
    if (has(CA.missions, 'finishWithChoice')) call(CA.missions, 'finishWithChoice', choice);
    if (has(CA.save, 'save')) call(CA.save, 'save', 'ending-' + choice);
  }

  function garageAction() {
    var p = CA.state.player;
    if (!has(CA.garages, 'isNearGarage')) return;
    var near = false;
    try { near = CA.garages.isNearGarage(p.x, p.z, GARAGE_HINT_RADIUS); } catch (e) { near = false; }
    if (!near) return;
    var garage = null;
    if (has(CA.garages, 'currentGarageFor')) {
      try { garage = CA.garages.currentGarageFor(p.x, p.z); } catch (e) { garage = null; }
    }
    if (!garage && has(CA.garages, 'nearest')) {
      try { garage = CA.garages.nearest(p.x, p.z); } catch (e) { garage = null; }
    }
    if (!garage) return;
    if (!p.onFoot) {
      var car = null;
      if (has(CA.cars, 'playerCar')) car = call(CA.cars, 'playerCar');
      if (car && has(CA.garages, 'store')) {
        var res = null;
        try { res = CA.garages.store(car, garage.id); } catch (e) { res = null; }
        if (res && res.ok) {
          if (has(CA.cars, 'exitCar')) call(CA.cars, 'exitCar');
          if (has(CA.player, 'refillHealth')) call(CA.player, 'refillHealth', 'garage');
          if (has(CA.hud, 'toast')) call(CA.hud, 'toast', 'Car stored in ' + garage.name);
          if (has(CA.save, 'save')) call(CA.save, 'save', 'garage-store');
          return;
        }
        if (has(CA.hud, 'toast')) call(CA.hud, 'toast', 'Garage is full');
        return;
      }
    } else {
      if (has(CA.garages, 'list')) {
        var stored = null;
        try { stored = CA.garages.list(garage.id); } catch (e) { stored = null; }
        if (stored && stored.length > 0 && has(CA.garages, 'takeOut')) {
          var out = null;
          try { out = CA.garages.takeOut(garage.id, 0); } catch (e) { out = null; }
          if (out && out.ok) {
            if (has(CA.player, 'refillHealth')) call(CA.player, 'refillHealth', 'garage');
            if (has(CA.hud, 'toast')) call(CA.hud, 'toast', 'Took out your car — press E to get in');
            return;
          }
        }
      }
      if (has(CA.player, 'refillHealth')) call(CA.player, 'refillHealth', 'garage');
      if (has(CA.hud, 'toast')) call(CA.hud, 'toast', garage.name + ' — no cars stored here yet');
    }
  }

  // ---- chase / vigilante targets ----------------------------------------

  function roadPointAhead(distance) {
    var p = CA.state.player;
    var fx = Math.sin(p.facing || 0);
    var fz = Math.cos(p.facing || 0);
    var x = p.x + fx * distance;
    var z = p.z + fz * distance;
    if (has(CA.city, 'nearestRoadPoint')) {
      var near = null;
      try { near = CA.city.nearestRoadPoint(x, z); } catch (e) { near = null; }
      if (near && typeof near.x === 'number') return { x: near.x, z: near.z, facing: p.facing || 0 };
    }
    return { x: x, z: z, facing: p.facing || 0 };
  }

  function findCarById(id) {
    var cars = CA.state.cars || [];
    for (var i = 0; i < cars.length; i++) {
      if (cars[i] && cars[i].id === id) return cars[i];
    }
    return null;
  }

  function ensureChaseTarget() {
    var active = CA.state.activeMission;
    if (!active || !has(CA.missions, 'currentObjective')) return;
    var obj = null;
    try { obj = CA.missions.currentObjective(); } catch (e) { obj = null; }
    if (!obj || obj.type !== 'chase' || !obj.targetCar) {
      chaseStopTimer = 0;
      chaseStopReported = false;
      return;
    }
    var target = findCarById(obj.targetCar);
    if (!target) {
      var spot = roadPointAhead(70);
      call(CA.cars, 'spawnCar', 'sedan', spot.x, spot.z, spot.facing,
        { id: obj.targetCar, driver: 'npc' });
      chaseStopTimer = 0;
      chaseStopReported = false;
      return;
    }
    var speed = Math.abs(target.speed || 0);
    if (speed < 0.5) {
      chaseStopTimer += STEP;
      if (chaseStopTimer >= CHASE_STOP_TIME && !chaseStopReported) {
        chaseStopReported = true;
        call(CA.missions, 'chaseTargetStopped', obj.targetCar);
      }
    } else {
      chaseStopTimer = 0;
    }
  }

  function vigilanteStopped() {
    var job = CA.state.activeJob;
    if (!job || job.kind !== 'vigilante' || !job.targetCar) {
      jobStopTimer = 0;
      return false;
    }
    var target = findCarById(job.targetCar);
    if (!target) {
      var spot = roadPointAhead(60);
      call(CA.cars, 'spawnCar', 'sedan', spot.x, spot.z, spot.facing,
        { id: job.targetCar, driver: 'npc' });
      jobStopTimer = 0;
      return false;
    }
    var speed = Math.abs(target.speed || 0);
    if (speed < 0.5) {
      jobStopTimer += STEP;
      return jobStopTimer >= JOB_STOP_TIME;
    }
    jobStopTimer = 0;
    return false;
  }

  // ---- roaming events ----------------------------------------------------

  function maybeSpawnEvent() {
    if (CA.state.activeMission || CA.state.activeJob || CA.state.activeEvent) return;
    var now = CA.state.playTimeSeconds || 0;
    if (now < nextEventAt) return;
    nextEventAt = now + 45 + (mainRng ? mainRng.range(0, 30) : 15);
    if (has(CA.events, 'spawnRandom')) {
      var p = CA.state.player;
      call(CA.events, 'spawnRandom', now, { x: p.x, z: p.z });
    }
  }

  // ---- visits, checkpoints, endings --------------------------------------

  function trackVisits() {
    var p = CA.state.player;
    var district = '';
    if (has(CA.city, 'districtNameAt')) {
      try { district = CA.city.districtNameAt(p.x, p.z) || ''; } catch (e) { district = ''; }
    }
    if (district && district !== lastDistrict) {
      lastDistrict = district;
      if (has(CA.achievements, 'visitDistrict')) call(CA.achievements, 'visitDistrict', district);
    }
    if (has(CA.city, 'landmarkList')) {
      var marks = null;
      try { marks = CA.city.landmarkList(); } catch (e) { marks = null; }
      if (marks) {
        for (var i = 0; i < marks.length; i++) {
          var lm = marks[i];
          if (!lm || visitedLandmarks[lm.name]) continue;
          if (dist2(p.x, p.z, lm.x, lm.z) < LANDMARK_VISIT_RADIUS) {
            visitedLandmarks[lm.name] = true;
            if (has(CA.achievements, 'visitLandmark')) call(CA.achievements, 'visitLandmark', lm.name);
            if (has(CA.hud, 'showBanner') && lm.name) {
              call(CA.hud, 'showBanner', lm.name + (lm.desc ? ' — ' + lm.desc : ''));
            }
          }
        }
      }
    }
  }

  function trackWantedAndStreak() {
    // Neither the police nor the player module calls these hooks;
    // the integrator polls the level and the streak once per step.
    var level = has(CA.police, 'level') ? (call(CA.police, 'level') || 0) : 0;
    if (level !== lastWantedLevel) {
      var wasFive = lastWantedLevel >= 5;
      lastWantedLevel = level;
      if (has(CA.achievements, 'wantedChanged')) {
        call(CA.achievements, 'wantedChanged', level, wasFive);
      }
      lastWasFive = level >= 5;
    }
    var streak = CA.state.player.killStreak || 0;
    if (streak !== lastStreak) {
      lastStreak = streak;
      if (has(CA.achievements, 'streakChanged')) call(CA.achievements, 'streakChanged', streak);
    }
  }

  function trackMissionProgress() {
    var active = CA.state.activeMission;
    var id = active ? active.id : 0;
    var stage = active ? active.stage : -1;
    if (active && id !== lastMissionId) {
      lastMissionId = id;
      lastMissionStage = stage;
      lastMissionStartHealth = CA.state.player.health;
      lastMissionFailed = false;
      if (has(CA.story, 'briefing')) {
        var b = null;
        try { b = CA.story.briefing(id); } catch (e) { b = null; }
        if (b && has(CA.hud, 'toast')) {
          call(CA.hud, 'toast', b.title + ' — ' + b.giver + ' · $' + b.reward);
        }
      }
      if (has(CA.hud, 'toast')) {
        var obj = '';
        if (has(CA.missions, 'objectiveText')) obj = call(CA.missions, 'objectiveText') || '';
        if (obj) call(CA.hud, 'toast', obj);
      }
    } else if (active && stage !== lastMissionStage) {
      lastMissionStage = stage;
      if (has(CA.save, 'saveCheckpoint')) call(CA.save, 'saveCheckpoint', id, stage);
    }
    if (active && active.failed && !lastMissionFailed) {
      lastMissionFailed = true;
      if (has(CA.audio, 'failSting')) call(CA.audio, 'failSting');
      if (has(CA.hud, 'toast')) {
        call(CA.hud, 'toast', 'Mission failed — ' + (active.failReason || 'try again') + ' · press M to retry');
      }
    }
    if (active && !active.failed) lastMissionFailed = false;
    if (!active) {
      lastMissionId = 0;
      lastMissionStage = -1;
      lastMissionFailed = false;
    }
    var done = (CA.state.storyFlags && CA.state.storyFlags.missionsDone) || [];
    if (done.length > lastMissionsDone) {
      var finishedId = done[done.length - 1];
      lastMissionsDone = done.length;
      // No module calls this hook: the integrator wires mission
      // completion to the achievement list. A clean run keeps full
      // health from briefing to payout.
      var noDamage = CA.state.player.health >= lastMissionStartHealth;
      if (has(CA.achievements, 'missionDone')) {
        call(CA.achievements, 'missionDone', done.length, noDamage);
      }
      if (has(CA.audio, 'jingle')) call(CA.audio, 'jingle');
      if (has(CA.save, 'save')) call(CA.save, 'save', 'mission-' + finishedId + '-complete');
      if (has(CA.story, 'phoneCall')) {
        var c = null;
        try { c = CA.story.phoneCall(finishedId); } catch (e) { c = null; }
        if (c && c.text && has(CA.hud, 'toast')) {
          call(CA.hud, 'toast', (c.caller || 'Phone') + ': ' + c.text);
        }
      }
      if (finishedId === 8 && !CA.state.storyFlags.ending && !endingPending) {
        endingPending = true;
        if (has(CA.hud, 'toast')) {
          call(CA.hud, 'toast', 'The harbour is yours to decide — press 1 for Harbour, 2 for Crown');
        }
      }
    }
  }

  function pollBustedWasted() {
    var s = CA.state;
    var bustedChanged = s.lastBusted && s.lastBusted !== lastBustedAt;
    var wastedChanged = s.lastWasted && s.lastWasted !== lastWastedAt;
    if (bustedChanged) {
      lastBustedAt = s.lastBusted;
      if (has(CA.audio, 'siren')) call(CA.audio, 'siren', false);
      if (has(CA.audio, 'stopEngine')) call(CA.audio, 'stopEngine');
      showScreen('busted');
    } else if (wastedChanged) {
      lastWastedAt = s.lastWasted;
      if (has(CA.audio, 'siren')) call(CA.audio, 'siren', false);
      if (has(CA.audio, 'stopEngine')) call(CA.audio, 'stopEngine');
      showScreen('wasted');
    }
    // A module may have set the screen directly through the HUD.
    if (s.screen === 'busted' && currentScreen !== 'busted') showScreen('busted');
    if (s.screen === 'wasted' && currentScreen !== 'wasted') showScreen('wasted');
  }

  // ---- garage hint ---------------------------------------------------------

  function setHint(text) {
    if (text === hintText) return;
    hintText = text;
    var node = el('hint');
    if (node) node.textContent = text;
  }

  function updateGarageHint() {
    if (shotMode) return;
    var p = CA.state.player;
    var near = false;
    if (has(CA.garages, 'isNearGarage')) {
      try { near = CA.garages.isNearGarage(p.x, p.z, GARAGE_HINT_RADIUS); } catch (e) { near = false; }
    }
    if (near) {
      garageHintShown = true;
      setHint(p.onFoot ? 'Press G to take out a stored car' : 'Press G to store this car in the garage');
    } else if (garageHintShown) {
      garageHintShown = false;
      setHint(DEFAULT_HINT);
    }
  }

  // ---- fixed step ------------------------------------------------------------

  function stepLogic(dt) {
    if (currentScreen !== 'playing') return;
    handleGlobalKeys();
    var s = CA.state;
    var p = s.player;

    s.playSeconds = (s.playSeconds || 0) + dt;
    s.playTimeSeconds = s.playSeconds;
    call(CA.weather, 'update', dt);
    s.hour = has(CA.weather, 'hour') ? call(CA.weather, 'hour') : s.hour;
    s.minute = has(CA.weather, 'minute') ? call(CA.weather, 'minute') : s.minute;
    s.day = has(CA.weather, 'day') ? call(CA.weather, 'day') : s.day;

    call(CA.camera, 'update', dt, p);
    call(CA.cars, 'update', dt);
    call(CA.traffic, 'update', dt);
    call(CA.player, 'update', dt);
    call(CA.police, 'update', dt);

    var playerPos = { x: p.x, z: p.z };
    call(CA.missions, 'update', dt, playerPos);
    ensureChaseTarget();
    var stopped = vigilanteStopped();
    call(CA.jobs, 'update', dt, playerPos, stopped);
    call(CA.events, 'update', dt);
    maybeSpawnEvent();

    trackVisits();
    trackWantedAndStreak();
    trackMissionProgress();
    updateGarageHint();
    pollBustedWasted();
    if (currentScreen !== 'playing') return;

    var raining = has(CA.weather, 'isRaining') ? !!call(CA.weather, 'isRaining') : false;
    if (raining && has(CA.particles, 'rainField')) {
      call(CA.particles, 'rainField', p.x, p.z, 40, 3);
    }
    call(CA.particles, 'update', dt);
    updateAudio(dt);

    var isNight = has(CA.weather, 'isNight') ? !!call(CA.weather, 'isNight') : false;
    call(CA.achievements, 'update', s.playSeconds, isNight, raining, dt);
    drainAchievementToasts();
    call(CA.hud, 'update', dt);
    call(CA.save, 'saveIfDue', 'autosave');
  }

  // ---- frame -------------------------------------------------------------------

  function renderFrame(dt, timeSec) {
    if (has(CA.weather, 'apply')) call(CA.weather, 'apply', CA.gl);
    if (has(CA.render, 'draw')) call(CA.render, 'draw', CA.state, dt, timeSec);
    framesDrawn++;
    if (!firstFrameDone) {
      firstFrameDone = true;
      var loading = el('loading');
      if (loading) loading.hidden = true;
    }
  }

  function loop(time) {
    if (!running) return;
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(loop);
    }
    var now = (typeof time === 'number') ? time : 0;
    var dtRaw = 0;
    if (lastTime > 0) dtRaw = (now - lastTime) / 1000;
    lastTime = now;
    if (!(dtRaw >= 0)) dtRaw = 0;
    if (dtRaw > DT_CLAMP) dtRaw = DT_CLAMP;

    if (currentScreen === 'playing') {
      accumulator += dtRaw;
      var steps = 0;
      while (accumulator >= STEP && steps < MAX_STEPS) {
        stepLogic(STEP);
        if (has(CA.input, 'update')) call(CA.input, 'update');
        accumulator -= STEP;
        steps++;
        if (currentScreen !== 'playing') {
          accumulator = 0;
          break;
        }
      }
      if (steps >= MAX_STEPS) accumulator = 0;
    } else {
      // Title, pause, busted and wasted: keep the world visible and
      // the camera settled, but run no game logic. Still drain input
      // edges once per frame so a stale press cannot leak into play.
      if (currentScreen === 'title') {
        call(CA.weather, 'update', dtRaw);
        if (CA.state && CA.state.player) call(CA.camera, 'update', dtRaw, CA.state.player);
      }
      if (call(CA.input, 'wasPressed', 'Escape') && currentScreen === 'paused') resumeGame();
      if (has(CA.input, 'update')) call(CA.input, 'update');
    }

    renderFrame(dtRaw, now / 1000);
  }

  // ---- shot staging --------------------------------------------------------------

  function stageShot(n) {
    shotMode = true;
    shotNumber = n;
    newGame();
    var p = CA.state.player;
    if (n === 1) {
      // Daytime chase: sports coupe on a straight road, two cruisers
      // closing in ahead of it, two stars lit. Cruisers staged ahead
      // and flanking so the chase camera can actually see them: a
      // pursuer directly behind the coupe sits behind the camera.
      if (has(CA.weather, 'setHour')) call(CA.weather, 'setHour', 10, 30);
      if (has(CA.weather, 'forceRain')) call(CA.weather, 'forceRain', false, 0);
      var mx = -600;
      var mz = -1250;
      var mf = Math.PI / 2;
      var fx1 = Math.sin(mf);
      var fz1 = Math.cos(mf);
      var lx1 = -fz1;
      var lz1 = fx1;
      var car = call(CA.cars, 'spawnCar', 'sports', mx, mz, mf,
        { driver: 'none', parked: false });
      if (car) {
        if (has(CA.player, 'setPosition')) call(CA.player, 'setPosition', mx - fx1 * 2, mz - fz1 * 2, mf);
        call(CA.cars, 'tryEnter');
      }
      if (has(CA.missions, 'startMission')) call(CA.missions, 'startMission', 1);
      if (has(CA.police, 'setWanted')) call(CA.police, 'setWanted', 2);
      if (has(CA.police, 'spawnCruiser')) {
        call(CA.police, 'spawnCruiser', mx + fx1 * 30 + lx1 * 10, mz + fz1 * 30 + lz1 * 10);
        call(CA.police, 'spawnCruiser', mx + fx1 * 48 - lx1 * 10, mz + fz1 * 48 - lz1 * 10);
      }
      if (has(CA.camera, 'setZoom')) call(CA.camera, 'setZoom', 2);
      if (has(CA.camera, 'snapTo')) call(CA.camera, 'snapTo', CA.state.player);
    } else if (n === 2) {
      // Night rain on foot near the harbour landmark.
      if (has(CA.weather, 'setHour')) call(CA.weather, 'setHour', 22, 10);
      if (has(CA.weather, 'forceRain')) call(CA.weather, 'forceRain', true, 0.8);
      if (has(CA.player, 'setPosition')) call(CA.player, 'setPosition', -60, -1080, Math.PI);
      p.facing = Math.PI;
      // The player faces south (toward -z): put the taxi and the
      // pedestrians ahead of the camera, not behind it.
      call(CA.cars, 'spawnCar', 'taxi', -75, -1110, 0, { driver: 'none', parked: true });
      if (has(CA.traffic, 'spawnPedestrian')) {
        call(CA.traffic, 'spawnPedestrian', -50, -1110, {});
        call(CA.traffic, 'spawnPedestrian', -85, -1120, {});
        call(CA.traffic, 'spawnPedestrian', -40, -1105, {});
      }
      if (has(CA.hud, 'showBanner')) call(CA.hud, 'showBanner', 'Crane Cafe — Harbour');
      if (has(CA.camera, 'snapTo')) call(CA.camera, 'snapTo', p);
    } else if (n === 3) {
      // Mission at sunset: Dario on foot at the pickup point.
      if (has(CA.weather, 'setHour')) call(CA.weather, 'setHour', 18, 5);
      if (has(CA.weather, 'forceRain')) call(CA.weather, 'forceRain', false, 0);
      if (has(CA.missions, 'startMission')) call(CA.missions, 'startMission', 3);
      var target = null;
      if (has(CA.missions, 'currentTarget')) {
        try { target = CA.missions.currentTarget(); } catch (e) { target = null; }
      }
      if (target && typeof target.x === 'number') {
        if (has(CA.player, 'setPosition')) call(CA.player, 'setPosition', target.x, target.z, 0);
      } else if (has(CA.player, 'setPosition')) {
        call(CA.player, 'setPosition', -240, -1080, 0);
      }
      // Traffic passing: stage it on the road ahead of the player,
      // wherever the mission put them, not at fixed coordinates.
      var ahead1 = roadPointAhead(14);
      var ahead2 = roadPointAhead(22);
      call(CA.cars, 'spawnCar', 'taxi', ahead1.x, ahead1.z, ahead1.facing, { driver: 'traffic' });
      call(CA.cars, 'spawnCar', 'sedan', ahead2.x, ahead2.z, ahead2.facing, { driver: 'traffic' });
      if (has(CA.camera, 'snapTo')) call(CA.camera, 'snapTo', CA.state.player);
    } else if (n === 4) {
      // Marina garage at golden hour, player beside an owned car.
      if (has(CA.weather, 'setHour')) call(CA.weather, 'setHour', 17, 20);
      if (has(CA.weather, 'forceRain')) call(CA.weather, 'forceRain', false, 0);
      var garage = null;
      if (has(CA.city, 'garageList')) {
        var list = null;
        try { list = CA.city.garageList(); } catch (e) { list = null; }
        if (list) {
          for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].id === 'marina') { garage = list[i]; break; }
          }
        }
      }
      var gx = garage ? garage.doorX : 1050;
      var gz = garage ? garage.doorZ : -1316;
      call(CA.cars, 'spawnCar', 'sports', gx, gz, 0, { driver: 'none', parked: true, owned: true });
      // Face east along the marina front, car beside the player,
      // golden-hour sky and open ground ahead of the camera.
      if (has(CA.player, 'setPosition')) call(CA.player, 'setPosition', gx - 6, gz + 2, Math.PI / 2);
      CA.state.player.facing = Math.PI / 2;
      call(CA.cars, 'spawnCar', 'sedan', gx + 18, gz - 22, Math.PI / 2, { driver: 'traffic' });
      if (has(CA.traffic, 'spawnPedestrian')) {
        call(CA.traffic, 'spawnPedestrian', gx + 8, gz - 14, {});
        call(CA.traffic, 'spawnPedestrian', gx - 14, gz - 18, {});
      }
      setHint('Press G to open the garage');
      if (has(CA.hud, 'showBanner')) call(CA.hud, 'showBanner', 'Marina Garage — Golden Hour');
      if (has(CA.camera, 'snapTo')) call(CA.camera, 'snapTo', CA.state.player);
    }
    showScreen('playing');
  }

  // ---- pause panels -----------------------------------------------------------

  function togglePanel(id, fill) {
    var node = el(id);
    if (!node) return;
    var willShow = node.hidden;
    var panels = ['jobs-list', 'achievements-list', 'settings-panel'];
    for (var i = 0; i < panels.length; i++) {
      var other = el(panels[i]);
      if (other) other.hidden = true;
    }
    if (willShow) {
      if (typeof fill === 'function') fill(node);
      node.hidden = false;
    }
  }

  function toggleJobsPanel() {
    togglePanel('jobs-list', function (node) {
      var html = '';
      var current = CA.state.activeJob;
      if (current) {
        var obj = '';
        if (has(CA.jobs, 'objectiveText')) obj = call(CA.jobs, 'objectiveText') || '';
        html += '<h3>Current job: ' + (current.name || current.kind || '') + '</h3>';
        html += '<p>' + obj + '</p>';
      } else {
        html += '<h3>Side jobs</h3><p>No job running. Drive to a job marker to start one.</p>';
      }
      var defs = null;
      if (has(CA.jobs, 'listJobs')) {
        try { defs = CA.jobs.listJobs(); } catch (e) { defs = null; }
      }
      if (defs && defs.length) {
        html += '<p>';
        for (var i = 0; i < defs.length; i++) {
          var d = defs[i];
          html += (d.name || d.kind || d) + (d.desc ? ' — ' + d.desc : '') + '<br>';
        }
        html += '</p>';
      }
      node.innerHTML = html;
    });
  }

  function toggleAchievementsPanel() {
    togglePanel('achievements-list', function (node) {
      var html = '<h3>Achievements</h3>';
      var list = null;
      if (has(CA.achievements, 'listForPause')) {
        try { list = CA.achievements.listForPause(); } catch (e) { list = null; }
      }
      if (list && list.length) {
        html += '<p>';
        for (var i = 0; i < list.length; i++) {
          var a = list[i];
          html += (a.earned ? '[x] ' : '[ ] ') + (a.name || a.id) +
            (a.desc ? ' — ' + a.desc : '') + '<br>';
        }
        html += '</p>';
      } else {
        html += '<p>No achievements earned yet.</p>';
      }
      node.innerHTML = html;
    });
  }

  function toggleSettingsPanel() {
    togglePanel('settings-panel', function () {
      var vol = el('volume');
      if (vol) vol.value = String(Math.round((CA.state.settings.volume || 0.8) * 100));
      var sel = el('station');
      if (sel && CA.radio && CA.radio.stations && CA.radio.stations.length) {
        sel.innerHTML = '';
        for (var i = 0; i < CA.radio.stations.length; i++) {
          var st = CA.radio.stations[i];
          var opt = document.createElement('option');
          opt.value = st.id;
          opt.textContent = st.name;
          sel.appendChild(opt);
        }
        var cur = null;
        if (has(CA.radio, 'currentName')) cur = call(CA.radio, 'currentName');
        for (var j = 0; j < sel.options.length; j++) {
          if (sel.options[j].textContent === cur) { sel.selectedIndex = j; break; }
        }
      }
    });
  }

  function bindButtons() {
    function on(id, fn) {
      var node = el(id);
      if (node) node.addEventListener('click', fn);
    }
    on('btn-new-game', function () { ensureAudioStarted(); newGame(); });
    on('btn-continue', function () { ensureAudioStarted(); continueGame(); });
    on('btn-resume', function () { resumeGame(); });
    on('btn-save', function () {
      var r = call(CA.save, 'save', 'manual');
      if (has(CA.hud, 'toast')) {
        call(CA.hud, 'toast', (r && r.ok) ? 'Game saved' : 'Save failed');
      }
    });
    on('btn-jobs', function () { toggleJobsPanel(); });
    on('btn-achievements', function () { toggleAchievementsPanel(); });
    on('btn-settings', function () { toggleSettingsPanel(); });
    on('btn-quit', function () { quitToTitle(); });
    on('btn-respawn-busted', function () { resumeGame(); });
    on('btn-respawn-wasted', function () { resumeGame(); });
    var vol = el('volume');
    if (vol) {
      vol.addEventListener('input', function () {
        var v = clamp(parseInt(vol.value, 10) / 100 || 0, 0, 1);
        CA.state.settings.volume = v;
        if (has(CA.audio, 'setVolume')) call(CA.audio, 'setVolume', v);
      });
    }
    var sel = el('station');
    if (sel) {
      sel.addEventListener('change', function () {
        if (has(CA.radio, 'setStationById')) call(CA.radio, 'setStationById', sel.value);
        if (has(CA.achievements, 'stationsChanged')) call(CA.achievements, 'stationsChanged');
      });
    }
  }

  function bindAutoPause() {
    if (typeof window === 'undefined') return;
    function maybePause() {
      if (shotMode) return;
      if (currentScreen === 'playing') pauseGame();
    }
    window.addEventListener('blur', maybePause);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) maybePause();
      });
    }
  }

  // ---- boot ------------------------------------------------------------------

  function boot() {
    if (booted) return;
    booted = true;
    var params = parseParams();
    shotNumber = params.shot || 0;
    shotMode = shotNumber > 0;
    seedText = params.seed ? ('seed-' + params.seed) : 'cayo-azul';
    if (has(CA.rng, 'createFromString')) {
      try { mainRng = CA.rng.createFromString(seedText); } catch (e) { mainRng = null; }
    }
    CA.state = freshState();
    canvas = el('game');
    if (canvas && has(CA.gl, 'init')) {
      var ok = false;
      try { ok = CA.gl.init(canvas); } catch (e) { ok = false; }
      if (!ok && typeof console !== 'undefined' && console.error) {
        console.error('CA.main: WebGL init failed');
      }
    }
    if (canvas && has(CA.input, 'attach')) call(CA.input, 'attach', canvas);
    if (has(CA.world, 'build')) call(CA.world, 'build');
    if (has(CA.weather, 'reset')) call(CA.weather, 'reset');
    if (CA.state.settings && has(CA.audio, 'setVolume')) {
      call(CA.audio, 'setVolume', CA.state.settings.volume);
    }
    if (CA.state.settings && has(CA.radio, 'setStation')) {
      call(CA.radio, 'setStation', CA.state.settings.radioStation || 0);
    }
    if (has(CA.minimap, 'setCanvas')) {
      var mm = el('minimap');
      if (mm) call(CA.minimap, 'setCanvas', mm);
    }
    placePlayerAtCafe();
    spawnStarterCars();
    if (has(CA.camera, 'snapTo')) call(CA.camera, 'snapTo', CA.state.player);
    bindButtons();
    bindFirstInteraction();
    bindAutoPause();
    refreshTitleButtons();
    setHint(DEFAULT_HINT);
    if (shotMode) {
      stageShot(shotNumber);
    } else {
      showScreen('title');
    }
    running = true;
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(loop);
    }
  }

  CA.main = {
    screen: function () { return currentScreen; },
    framesDrawn: function () { return framesDrawn; },
    isShotMode: function () { return shotMode; },
    shot: function () { return shotNumber; },
    newGame: newGame,
    continueGame: continueGame,
    quitToTitle: quitToTitle,
    pauseGame: pauseGame,
    resumeGame: resumeGame,
    startPlaying: startPlaying,
    stageShot: stageShot,
    boot: boot
  };

  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
