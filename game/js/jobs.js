(function () {
  'use strict';

  var CA = window.CA || (window.CA = {});

  function state() {
    if (!CA.state) { CA.state = {}; }
    if (!CA.state.activeJob) { CA.state.activeJob = null; }
    if (!CA.state.jobStats) { CA.state.jobStats = { taxi: 0, parcel: 0, vigilante: 0, race: 0, earned: 0, clean: 0 }; }
    if (!CA.state.jobHistory) { CA.state.jobHistory = []; }
    return CA.state;
  }

  function hudObjective(text) {
    if (CA.hud && typeof CA.hud.setObjective === 'function') { CA.hud.setObjective(text); }
  }

  function hudBanner(text) {
    if (CA.hud && typeof CA.hud.showBanner === 'function') { CA.hud.showBanner(text); }
  }

  function grant(amount, reason) {
    if (CA.economy && typeof CA.economy.grant === 'function') { CA.economy.grant(amount, reason); }
    else if (CA.state && CA.state.player) { CA.state.player.money = (CA.state.player.money || 0) + amount; }
  }

  function dist2(ax, az, bx, bz) {
    var dx = ax - bx;
    var dz = az - bz;
    return dx * dx + dz * dz;
  }

  function dist(ax, az, bx, bz) {
    return Math.sqrt(dist2(ax, az, bx, bz));
  }

  // Deterministic pick: a counter in state, no clock, no randomness.
  function pickIndex(list) {
    var s = state();
    if (typeof s.jobPickCounter !== 'number') { s.jobPickCounter = 0; }
    var i = s.jobPickCounter % list.length;
    s.jobPickCounter += 1;
    return i;
  }

  var DESTINATIONS = [
    { x: -620, z: -420, district: 'Old Town', label: 'Old Town market' },
    { x: 1180, z: -980, district: 'Marina', label: 'Marina ferry dock' },
    { x: 480, z: 620, district: 'University', label: 'University gate' },
    { x: -980, z: 720, district: 'Stadium', label: 'Stadium corner' },
    { x: 760, z: -120, district: 'Palm Row', label: 'Palm Row' },
    { x: -1280, z: -240, district: "Fisherman's Wharf", label: "Fisherman's Wharf" },
    { x: 1080, z: 720, district: 'Sunset Terrace', label: 'Sunset Terrace overlook' },
    { x: -240, z: -1080, district: 'Harbour', label: 'Harbour Cafe' }
  ];

  var JOB_DEFS = {
    taxi: {
      id: 'taxi', name: 'Taxi Fare', basePay: 120, timeLimit: 120,
      blurb: 'Pick up a pedestrian and drive them to a marked place before the timer runs out.'
    },
    parcel: {
      id: 'parcel', name: 'Parcel Delivery', basePay: 150, timeLimit: 180,
      blurb: 'Carry a parcel across districts and deliver it to the marked door.'
    },
    vigilante: {
      id: 'vigilante', name: 'Vigilante Work', basePay: 200, timeLimit: 150,
      blurb: 'Chase the marked getaway car until it stops. Do not let it escape the island.'
    },
    race: {
      id: 'race', name: 'Street Race', basePay: 300, timeLimit: 180,
      blurb: 'Reach every checkpoint before the rival driver does.'
    }
  };

  var RACE_CHECKPOINTS = [
    { x: 1420, z: 300, label: 'East straight' },
    { x: 0, z: 1180, label: 'North bend' },
    { x: -980, z: 720, label: 'Stadium corner' },
    { x: -240, z: -1080, label: 'Harbour Cafe' }
  ];

  // Job markers in the world: fixed road-side points where a job can be
  // picked up. The pause menu offers the same four jobs without a marker.
  var MARKERS = [
    { kind: 'taxi', x: -240, z: -1080, label: 'Taxi stand, Harbour Cafe' },
    { kind: 'parcel', x: -620, z: -420, label: 'Parcel office, Old Town market' },
    { kind: 'vigilante', x: -1180, z: -760, label: 'Watch post, Docks' },
    { kind: 'race', x: 1420, z: 300, label: 'Race start, east straight' }
  ];

  function cleanBonus(job) {
    return job.clean ? 50 : 0;
  }

  // Revision: pay scales a little with distance, so a cross-island fare
  // pays more than a trip next door. Distance is measured from the pickup
  // point to the destination, capped so the bonus stays small.
  function distanceBonus(job) {
    if (!job.startPos || !job.dest) { return 0; }
    var d = dist(job.startPos.x, job.startPos.z, job.dest.x, job.dest.z);
    if (d < 600) { return 0; }
    if (d < 1400) { return 25; }
    return 50;
  }

  function startJob(kind, startPos) {
    var def = JOB_DEFS[kind];
    if (!def) { return null; }
    var s = state();
    if (s.activeJob) { return null; }
    if (CA.state && CA.state.activeMission) { return null; }
    var dest = DESTINATIONS[pickIndex(DESTINATIONS)];
    var origin = startPos || { x: 0, z: 0 };
    // Never send the player to the place they are already standing.
    if (dest.x === origin.x && dest.z === origin.z) {
      dest = DESTINATIONS[pickIndex(DESTINATIONS)];
    }
    var job = {
      kind: kind, name: def.name, stage: 0, timeLeft: def.timeLimit,
      clean: true, dest: dest, startPos: origin,
      pickup: origin,
      checkpoints: kind === 'race' ? RACE_CHECKPOINTS.slice() : null,
      checkpointIndex: 0, targetCar: kind === 'vigilante' ? 'getaway-car' : null,
      pickedUp: kind === 'vigilante' || kind === 'race'
    };
    s.activeJob = job;
    hudObjective(jobObjectiveText(job));
    hudBanner(def.name + ': ' + def.blurb);
    return job;
  }

  function startJobAtMarker(markerIndex, playerPos) {
    var marker = MARKERS[markerIndex];
    if (!marker) { return null; }
    return startJob(marker.kind, playerPos || { x: marker.x, z: marker.z });
  }

  function jobObjectiveText(job) {
    if (!job) { return ''; }
    if (job.kind === 'taxi') {
      return job.pickedUp ? ('Drive the fare to ' + job.dest.label) : 'Pick up the fare at the marker';
    }
    if (job.kind === 'parcel') {
      return job.pickedUp ? ('Deliver the parcel to ' + job.dest.label) : 'Pick up the parcel';
    }
    if (job.kind === 'vigilante') {
      return 'Chase the getaway car until it stops';
    }
    if (job.kind === 'race') {
      var cp = job.checkpoints[job.checkpointIndex];
      return cp ? ('Race checkpoint ' + (job.checkpointIndex + 1) + ' of ' + job.checkpoints.length + ': ' + cp.label) : 'Race to the finish';
    }
    return job.name;
  }

  function markNotClean() {
    var job = state().activeJob;
    if (job) { job.clean = false; }
  }

  function restoreObjectiveAfterJob() {
    if (CA.missions && typeof CA.missions.objectiveText === 'function') {
      hudObjective(CA.missions.objectiveText());
    } else {
      hudObjective('');
    }
  }

  function completeJob() {
    var s = state();
    var job = s.activeJob;
    if (!job) { return 0; }
    var def = JOB_DEFS[job.kind];
    var pay = def.basePay + cleanBonus(job) + distanceBonus(job);
    if (CA.state && CA.state.player && (CA.state.player.killStreak || 0) >= 3) {
      pay += 25;
    }
    grant(pay, 'job ' + job.kind + ' complete');
    s.jobStats[job.kind] = (s.jobStats[job.kind] || 0) + 1;
    s.jobStats.earned += pay;
    if (job.clean) { s.jobStats.clean += 1; }
    s.jobHistory.push({ kind: job.kind, pay: pay, clean: job.clean });
    if (s.jobHistory.length > 20) { s.jobHistory.shift(); }
    s.activeJob = null;
    hudBanner(job.name + ' complete. Paid $' + pay + (job.clean ? ' (clean run bonus included).' : '.'));
    restoreObjectiveAfterJob();
    return pay;
  }

  function cancelJob(reason) {
    var s = state();
    if (!s.activeJob) { return false; }
    s.activeJob = null;
    hudBanner('Job cancelled' + (reason ? ': ' + reason : '.'));
    restoreObjectiveAfterJob();
    return true;
  }

  function failJob(reason) {
    var s = state();
    if (!s.activeJob) { return false; }
    s.activeJob = null;
    hudBanner('Job failed: ' + (reason || 'out of time'));
    restoreObjectiveAfterJob();
    return true;
  }

  function update(dt, playerPos, targetCarStopped) {
    var s = state();
    var job = s.activeJob;
    if (!job) { return; }
    if (!(dt > 0)) { return; }
    job.timeLeft -= dt;
    if (job.timeLeft <= 0) {
      job.timeLeft = 0;
      failJob('out of time');
      return;
    }
    if (job.kind === 'vigilante') {
      if (targetCarStopped) { completeJob(); }
      return;
    }
    if (job.kind === 'race') {
      var cp = job.checkpoints[job.checkpointIndex];
      if (cp && playerPos && typeof playerPos.x === 'number' &&
          dist2(playerPos.x, playerPos.z, cp.x, cp.z) <= 30 * 30) {
        job.checkpointIndex += 1;
        if (job.checkpointIndex >= job.checkpoints.length) { completeJob(); return; }
        hudObjective(jobObjectiveText(job));
        hudBanner('Checkpoint ' + job.checkpointIndex + ' of ' + job.checkpoints.length + ' reached.');
      }
      return;
    }
    if (!job.pickedUp) {
      if (playerPos && job.pickup && dist2(playerPos.x, playerPos.z, job.pickup.x, job.pickup.z) <= 24 * 24) {
        job.pickedUp = true;
        hudObjective(jobObjectiveText(job));
        hudBanner(job.kind === 'taxi' ? 'Fare picked up. Drive carefully.' : 'Parcel collected. Deliver it across the districts.');
      }
      return;
    }
    if (playerPos && job.dest && dist2(playerPos.x, playerPos.z, job.dest.x, job.dest.z) <= 28 * 28) {
      completeJob();
    }
  }

  function pickupDone() {
    var job = state().activeJob;
    if (!job || job.pickedUp) { return false; }
    job.pickedUp = true;
    hudObjective(jobObjectiveText(job));
    return true;
  }

  function rivalFinished() {
    var job = state().activeJob;
    if (!job || job.kind !== 'race') { return false; }
    failJob('the rival finished first');
    return true;
  }

  CA.jobs = {
    defs: JOB_DEFS,
    destinations: DESTINATIONS,
    raceCheckpoints: RACE_CHECKPOINTS,
    markers: MARKERS,
    startJob: startJob,
    startJobAtMarker: startJobAtMarker,
    current: function () { return state().activeJob; },
    objectiveText: function () { return jobObjectiveText(state().activeJob); },
    pickupDone: pickupDone,
    rivalFinished: rivalFinished,
    markNotClean: markNotClean,
    completeJob: completeJob,
    cancelJob: cancelJob,
    failJob: failJob,
    update: update,
    isActive: function () { return !!state().activeJob; },
    stats: function () { return state().jobStats; },
    history: function () { return state().jobHistory.slice(); },
    listJobs: function () {
      return [JOB_DEFS.taxi, JOB_DEFS.parcel, JOB_DEFS.vigilante, JOB_DEFS.race];
    }
  };
})();
