// achievements.js — Cayo Azul achievements.
// Twenty-four achievements, each with a name, a short description and
// a trigger id. Other modules report events by calling check(id) or
// the named event helpers; this module owns the earned set, the toast
// queue the HUD shows, and the pause-screen list. Play-time progress
// is fed in seconds by main's update, never read from a clock.
// The 24th achievement, first car bought, is this module's own
// addition to the spec's twenty-three so the count matches the brief.
// Revision notes: update() now takes the real frame delta, so a
// rainy night accumulates true seconds instead of one per call; the
// pause screen gets live progress counts (districts, landmarks,
// stations, play time); reset() added for new games.
(function () {
  'use strict';
  var CA = window.CA || (window.CA = {});
  if (!CA.state) CA.state = {};
  if (!CA.state.achievements) CA.state.achievements = [];
  if (!CA.state.achievementProgress) CA.state.achievementProgress = {};
  if (!CA.state.flags) CA.state.flags = {};

  var DEFS = [
    { id: 'first-mission', name: 'First Job Done', desc: 'Complete your first mission.' },
    { id: 'all-missions', name: 'Harbour Legend', desc: 'Complete all eight missions.' },
    { id: 'first-steal', name: 'Borrowed Wheels', desc: 'Steal your first car.' },
    { id: 'first-taxi', name: 'Cabbie', desc: 'Complete your first taxi fare.' },
    { id: 'first-delivery', name: 'Parcel Runner', desc: 'Complete your first delivery.' },
    { id: 'first-race', name: 'Street King', desc: 'Win your first street race.' },
    { id: 'first-vigilante', name: 'Neighbourhood Watch', desc: 'Stop your first getaway car.' },
    { id: 'five-star', name: 'Most Wanted', desc: 'Reach a five-star wanted level.' },
    { id: 'escape-five-star', name: 'Ghost', desc: 'Escape from a five-star wanted level.' },
    { id: 'streak-five', name: 'On a Roll', desc: 'Build a kill streak of five.' },
    { id: 'earned-10k', name: 'Ten Grand', desc: 'Earn ten thousand in total.' },
    { id: 'own-three-cars', name: 'Collector', desc: 'Own three cars at once.' },
    { id: 'own-all-models', name: 'Full Garage', desc: 'Own all six car models.' },
    { id: 'all-districts', name: 'Island Tour', desc: 'Visit all fifteen districts.' },
    { id: 'all-landmarks', name: 'Sightseer', desc: 'Visit all twenty landmarks.' },
    { id: 'rainy-night', name: 'Storm Rider', desc: 'Survive a night of rain.' },
    { id: 'all-stations', name: 'Channel Surfer', desc: 'Listen to every radio station.' },
    { id: 'flawless-mission', name: 'Untouched', desc: 'Complete a mission with no damage.' },
    { id: 'clean-job', name: 'Clean Hands', desc: 'Complete a job cleanly.' },
    { id: 'stray-dog', name: 'New Best Friend', desc: 'Find the stray dog.' },
    { id: 'finale', name: 'Cayo Azul Finale', desc: 'Finish the island finale.' },
    { id: 'first-save', name: 'Saved and Sound', desc: 'Save the game.' },
    { id: 'hour-played', name: 'Island Regular', desc: 'Play for one hour in total.' },
    { id: 'first-car-bought', name: 'Showroom Visit', desc: 'Buy your first car.' }
  ];

  var toasts = [];
  /* Canonical car model ids (the car module's ids); the old
     'sports-coupe' / 'police-cruiser' spellings never match a car
     the player can own, so 'own-all-models' could never fire. */
  var ALL_MODELS = ['hatchback', 'sedan', 'taxi', 'pickup', 'sports', 'police'];

  function def(id) {
    for (var i = 0; i < DEFS.length; i++) if (DEFS[i].id === id) return DEFS[i];
    return null;
  }

  function earned() { return CA.state.achievements.slice(); }
  function has(id) { return CA.state.achievements.indexOf(id) >= 0; }

  function check(id) {
    if (has(id)) return false;
    var d = def(id);
    if (!d) return false;
    CA.state.achievements.push(id);
    toasts.push({ id: id, name: d.name, desc: d.desc });
    if (CA.hud) CA.hud.toast('Achievement: ' + d.name);
    if (CA.audio) CA.audio.pickup();
    return true;
  }

  // Conditional checks: call these with the current count and the
  // module decides whether the threshold is met.
  function checkCount(id, count, need) {
    if (count >= need) return check(id);
    return false;
  }

  function noteProgress(key, value) {
    CA.state.achievementProgress[key] = value;
  }

  function districtCount() {
    var seen = CA.state.achievementProgress.districts || {};
    return Object.keys(seen).length;
  }

  function landmarkCount() {
    var seen = CA.state.achievementProgress.landmarks || {};
    return Object.keys(seen).length;
  }

  function visitDistrict(name) {
    if (!name) return;
    var seen = CA.state.achievementProgress.districts || {};
    if (!seen[name]) {
      seen[name] = true;
      CA.state.achievementProgress.districts = seen;
      if (districtCount() >= 15) check('all-districts');
    }
  }

  function visitLandmark(name) {
    if (!name) return;
    var seen = CA.state.achievementProgress.landmarks || {};
    if (!seen[name]) {
      seen[name] = true;
      CA.state.achievementProgress.landmarks = seen;
      if (landmarkCount() >= 20) check('all-landmarks');
    }
  }

  function missionDone(count, noDamage) {
    check('first-mission');
    if (noDamage) check('flawless-mission');
    if (count >= 8) {
      check('all-missions');
      check('finale');
    }
  }

  function wantedChanged(level, wasFive) {
    if (level >= 5) check('five-star');
    if (wasFive && level === 0) check('escape-five-star');
  }

  function streakChanged(streak) {
    if (streak >= 5) check('streak-five');
  }

  function carsChanged() {
    var owned = (CA.garages && CA.garages.totalOwned) ? CA.garages.totalOwned() : 0;
    if (owned >= 3) check('own-three-cars');
    var models = (CA.garages && CA.garages.ownedModels) ? CA.garages.ownedModels() : [];
    var have = 0;
    for (var i = 0; i < ALL_MODELS.length; i++) {
      if (models.indexOf(ALL_MODELS[i]) >= 0) have++;
    }
    if (have >= ALL_MODELS.length) check('own-all-models');
  }

  function moneyChanged() {
    var total = (CA.economy && CA.economy.totalEarned) ? CA.economy.totalEarned() : (CA.state.totalEarned || 0);
    if (total >= 10000) check('earned-10k');
  }

  function stationsChanged() {
    var n = (CA.radio && CA.radio.listenedCount) ? CA.radio.listenedCount() : (CA.state.listenedStations || []).length;
    if (n >= 6) check('all-stations');
  }

  // Called every frame. playSeconds is the accumulated total; dt is
  // this frame's step in seconds, used for the rainy-night timer so
  // it measures real seconds, not update calls.
  function update(playSeconds, isNight, isRaining, dt) {
    if (playSeconds >= 3600) check('hour-played');
    if (isNight && isRaining) {
      var step = (typeof dt === 'number' && dt > 0) ? dt : 0;
      if (step > 0.25) step = 0.25;
      var t = (CA.state.achievementProgress.rainyNightSeconds || 0) + step;
      CA.state.achievementProgress.rainyNightSeconds = t;
      if (t >= 60) check('rainy-night');
    } else {
      // A dry spell or daylight resets the streak: the night must be
      // survived in one rainy stretch.
      CA.state.achievementProgress.rainyNightSeconds = 0;
    }
  }

  // Live progress for the pause screen, so locked achievements can
  // show how close the player is.
  function progressForPause() {
    return {
      districts: districtCount(),
      districtsNeed: 15,
      landmarks: landmarkCount(),
      landmarksNeed: 20,
      stations: (CA.state.listenedStations || []).length,
      stationsNeed: 6,
      cars: (CA.garages && CA.garages.totalOwned) ? CA.garages.totalOwned() : 0,
      carsNeed: 3,
      earned: (CA.economy && CA.economy.totalEarned) ? CA.economy.totalEarned() : (CA.state.totalEarned || 0),
      earnedNeed: 10000,
      playSeconds: CA.state.playSeconds || 0,
      playNeed: 3600
    };
  }

  function nextToast() { return toasts.shift() || null; }
  function pendingToasts() { return toasts.length; }
  function count() { return CA.state.achievements.length; }

  function listForPause() {
    var out = [];
    for (var i = 0; i < DEFS.length; i++) {
      out.push({ id: DEFS[i].id, name: DEFS[i].name, desc: DEFS[i].desc, earned: has(DEFS[i].id) });
    }
    return out;
  }

  function reset() {
    CA.state.achievements = [];
    CA.state.achievementProgress = {};
    toasts.length = 0;
  }

  CA.achievements = {
    defs: DEFS,
    check: check,
    /* Alias the gameplay modules ask for: unlocking is checking. */
    unlock: check,
    checkCount: checkCount,
    has: has,
    earned: earned,
    count: count,
    noteProgress: noteProgress,
    visitDistrict: visitDistrict,
    visitLandmark: visitLandmark,
    districtCount: districtCount,
    landmarkCount: landmarkCount,
    missionDone: missionDone,
    wantedChanged: wantedChanged,
    streakChanged: streakChanged,
    carsChanged: carsChanged,
    moneyChanged: moneyChanged,
    stationsChanged: stationsChanged,
    update: update,
    progressForPause: progressForPause,
    nextToast: nextToast,
    pendingToasts: pendingToasts,
    listForPause: listForPause,
    reset: reset
  };
})();
