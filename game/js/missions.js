(function () {
  'use strict';

  var CA = window.CA || (window.CA = {});

  function state() {
    if (!CA.state) { CA.state = {}; }
    if (!CA.state.activeMission) { CA.state.activeMission = null; }
    if (!CA.state.storyFlags) { CA.state.storyFlags = {}; }
    if (!CA.state.storyFlags.missionsDone) { CA.state.storyFlags.missionsDone = []; }
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

  function addHeat(level, reason) {
    if (CA.police && typeof CA.police.addHeat === 'function') { CA.police.addHeat(level, reason); }
  }

  function dist2(ax, az, bx, bz) {
    var dx = ax - bx;
    var dz = az - bz;
    return dx * dx + dz * dz;
  }

  function clamp(v, lo, hi) {
    if (v < lo) { return lo; }
    if (v > hi) { return hi; }
    return v;
  }

  // Island is about 3600 by 3000, centred on 0,0. x east, z north, y up.
  // Target positions are hand-placed road-side points in named districts.
  var P = {
    cafe: { x: -240, z: -1080, district: 'Harbour', label: 'Harbour Cafe' },
    market: { x: -620, z: -420, district: 'Old Town', label: 'Old Town market stall' },
    ringNorth: { x: 0, z: 1180, district: 'North Hill', label: 'Ring road, north bend' },
    ringEast: { x: 1420, z: 300, district: 'Coral Beach', label: 'Ring road, east straight' },
    university: { x: 480, z: 620, district: 'University', label: 'University gate' },
    marina: { x: 1180, z: -980, district: 'Marina', label: 'Marina ferry dock' },
    palmRow: { x: 760, z: -120, district: 'Palm Row', label: 'Palm Row' },
    vanYard: { x: 700, z: -260, district: 'Palm Row', label: 'Palm Row van yard' },
    docks: { x: -1180, z: -760, district: 'Docks', label: 'Docks warehouse' },
    harbourPier: { x: -420, z: -1320, district: 'Harbour', label: 'Harbour pier getaway' },
    stadium: { x: -980, z: 720, district: 'Stadium', label: 'Stadium corner' },
    airport: { x: 1380, z: 1080, district: 'Airport Road', label: 'Airport Road straight' },
    gardens: { x: -180, z: 980, district: 'Gardens', label: 'Gardens avenue' },
    fort: { x: -1420, z: 420, district: 'Old Fort', label: 'Old Fort gate' },
    wharf: { x: -1280, z: -240, district: "Fisherman's Wharf", label: "Fisherman's Wharf" },
    sunset: { x: 1080, z: 720, district: 'Sunset Terrace', label: 'Sunset Terrace overlook' }
  };

  function go(label, target, radius) {
    return { type: 'go', label: label, target: target, radius: radius || 28 };
  }
  function pickup(label, target, radius) {
    return { type: 'pickup', label: label, target: target, radius: radius || 24 };
  }
  function deliver(label, target, radius) {
    return { type: 'deliver', label: label, target: target, radius: radius || 28 };
  }
  function chase(label, targetCar) {
    return { type: 'chase', label: label, targetCar: targetCar, radius: 14 };
  }
  function lose(label, seconds) {
    return { type: 'lose', label: label, seconds: seconds || 20 };
  }
  function survive(label, seconds) {
    return { type: 'survive', label: label, seconds: seconds };
  }
  function collect(label, target, radius) {
    return { type: 'collect', label: label, target: target, radius: radius || 24 };
  }

  var MISSIONS = [
    {
      id: 1, reward: 750, heat: 0,
      objectives: [
        go('Drive to the Harbour Cafe', P.cafe),
        pickup('Pick up the crate', P.cafe),
        deliver('Deliver the crate to the Old Town market stall', P.market)
      ]
    },
    {
      id: 2, reward: 1500, heat: 1,
      objectives: [
        go('Drive to the ring road, north bend', P.ringNorth),
        chase('Chase the Breakers driver until his car stops', 'breakers-sedan'),
        lose('Lose the police', 20),
        deliver('Return to the Harbour Cafe', P.cafe)
      ]
    },
    {
      id: 3, reward: 2500, heat: 0, timeLimit: 150,
      objectives: [
        pickup('Pick up the parcel at the University gate', P.university),
        deliver('Deliver the parcel to the Marina ferry dock before the ferry leaves', P.marina)
      ]
    },
    {
      id: 4, reward: 3750, heat: 2,
      objectives: [
        go('Go to Palm Row', P.palmRow),
        survive('Survive the ambush at Palm Row', 60),
        go('Reach the van yard and check the van', P.vanYard)
      ]
    },
    {
      id: 5, reward: 5000, heat: 2,
      objectives: [
        collect('Collect from the Market stall', P.market),
        collect('Collect from the Gardens avenue shop', P.gardens),
        collect('Collect from the Stadium corner shop', P.stadium),
        collect('Collect from the Wharf shop', P.wharf),
        collect('Collect from the Sunset Terrace shop', P.sunset),
        deliver('Bring everything back to the Harbour Cafe', P.cafe)
      ]
    },
    {
      id: 6, reward: 7000, heat: 2,
      objectives: [
        go('Reach the Docks warehouse', P.docks),
        pickup('Steal the ledger from the back office', P.docks),
        deliver('Escape to the harbour pier getaway', P.harbourPier)
      ]
    },
    {
      id: 7, reward: 9000, heat: 1, timeLimit: 240,
      objectives: [
        go('Reach the start line on the ring road', P.ringEast),
        go('Checkpoint: Stadium corner', P.stadium),
        go('Checkpoint: Airport Road straight', P.airport),
        go('Checkpoint: Old Fort gate', P.fort),
        deliver('Finish at the Marina ferry dock', P.marina)
      ]
    },
    {
      id: 8, reward: 12000, heat: 3,
      objectives: [
        go('Intercept the convoy on the ring road', P.ringEast),
        chase('Chase the convoy lead car until it stops', 'convoy-lead'),
        chase('Stop Silas Vane', 'silas-car'),
        go('Return to the Harbour Cafe for the choice', P.cafe)
      ]
    }
  ];

  // Revision: validate the campaign table once at load. A bad objective
  // (unknown type, missing target, non-positive timer) is a bug in this
  // file, so fail loudly in the console instead of failing mid-mission.
  (function validateMissions() {
    var valid = { go: 1, pickup: 1, deliver: 1, chase: 1, lose: 1, survive: 1, collect: 1 };
    var i, j, m, o;
    for (i = 0; i < MISSIONS.length; i++) {
      m = MISSIONS[i];
      if (m.reward <= 0) { console.warn('CA.missions: mission ' + m.id + ' has no positive reward'); }
      for (j = 0; j < m.objectives.length; j++) {
        o = m.objectives[j];
        if (!valid[o.type]) { console.warn('CA.missions: mission ' + m.id + ' objective ' + j + ' bad type ' + o.type); }
        if ((o.type === 'go' || o.type === 'pickup' || o.type === 'deliver' || o.type === 'collect') && !o.target) {
          console.warn('CA.missions: mission ' + m.id + ' objective ' + j + ' missing target');
        }
        if ((o.type === 'survive' || o.type === 'lose') && !(o.seconds > 0)) {
          console.warn('CA.missions: mission ' + m.id + ' objective ' + j + ' bad seconds');
        }
      }
      if (m.timeLimit !== undefined && !(m.timeLimit > 0)) {
        console.warn('CA.missions: mission ' + m.id + ' bad timeLimit');
      }
    }
  })();

  function findMission(id) {
    var i;
    for (i = 0; i < MISSIONS.length; i++) {
      if (MISSIONS[i].id === id) { return MISSIONS[i]; }
    }
    return null;
  }

  function nextMissionId() {
    var done = state().storyFlags.missionsDone;
    var i;
    for (i = 1; i <= 8; i++) {
      if (done.indexOf(i) === -1) { return i; }
    }
    return null;
  }

  function currentObjective(active) {
    if (!active) { return null; }
    var m = findMission(active.id);
    if (!m) { return null; }
    return m.objectives[active.stage] || null;
  }

  function objectiveText(active) {
    var o = currentObjective(active);
    return o ? o.label : '';
  }

  function setObjectiveHud() {
    var active = state().activeMission;
    hudObjective(objectiveText(active));
  }

  function startMission(id) {
    var m = findMission(id);
    if (!m) { return false; }
    var s = state();
    if (s.activeMission) { return false; }
    s.activeMission = {
      id: m.id, stage: 0, checkpoint: 0, elapsed: 0,
      timer: m.timeLimit || null, timeLeft: m.timeLimit || null,
      objective: m.objectives[0].label, failed: false, failReason: null
    };
    if (m.heat > 0) { addHeat(m.heat, 'mission ' + m.id); }
    if (CA.story && typeof CA.story.briefing === 'function') { CA.story.briefing(m.id); }
    hudBanner('Mission ' + m.id + ': ' + (CA.story ? CA.story.title(m.id) : ''));
    setObjectiveHud();
    return true;
  }

  function startNext() {
    var id = nextMissionId();
    if (id === null) { return false; }
    return startMission(id);
  }

  function completeObjective() {
    var s = state();
    var active = s.activeMission;
    if (!active || active.failed) { return false; }
    var m = findMission(active.id);
    if (!m) { return false; }
    active.stage += 1;
    active.checkpoint = active.stage;
    active.elapsed = 0;
    if (active.stage >= m.objectives.length) {
      return finishMission(m);
    }
    active.objective = m.objectives[active.stage].label;
    // Mission 5: each collection raises heat a little, as the briefing warns.
    if (m.id === 5 && m.objectives[active.stage - 1].type === 'collect') {
      addHeat(1, 'mission 5 collection');
    }
    if (CA.story && typeof CA.story.dialogueLine === 'function') {
      var line = CA.story.dialogueLine(m.id, active.stage);
      if (line) { hudBanner(line.speaker + ': ' + line.line); }
    }
    setObjectiveHud();
    return true;
  }

  function finishMission(m) {
    var s = state();
    s.activeMission = null;
    if (s.storyFlags.missionsDone.indexOf(m.id) === -1) {
      s.storyFlags.missionsDone.push(m.id);
    }
    grant(m.reward, 'mission ' + m.id + ' complete');
    if (CA.story && typeof CA.story.markMissionDone === 'function') { CA.story.markMissionDone(m.id); }
    hudBanner('Mission complete. Paid $' + m.reward + '.');
    hudObjective('');
    if (CA.story && typeof CA.story.phoneCall === 'function') {
      var call = CA.story.phoneCall(m.id);
      if (call) { hudBanner(call.caller + ' (phone): ' + call.text); }
    }
    return true;
  }

  // Mission 8 ends in a choice, not a plain payout screen. The caller
  // (main.js) shows the two endings from CA.story.endingChoices() and
  // passes the player's pick here; the mission is already finished and
  // paid by then, this only records the ending.
  function finishWithChoice(choice) {
    if (!isDone(8)) { return null; }
    if (CA.story && typeof CA.story.ending === 'function') {
      return CA.story.ending(choice);
    }
    return null;
  }

  function failMission(reason) {
    var s = state();
    var active = s.activeMission;
    if (!active || active.failed) { return false; }
    active.failed = true;
    active.failReason = reason || 'Mission failed';
    hudBanner(active.failReason + ' — retry from the last checkpoint.');
    return true;
  }

  function retry() {
    var s = state();
    var active = s.activeMission;
    if (!active || !active.failed) { return false; }
    var m = findMission(active.id);
    if (!m) { return false; }
    active.stage = clamp(active.checkpoint || 0, 0, m.objectives.length - 1);
    active.failed = false;
    active.failReason = null;
    active.elapsed = 0;
    // Timed missions restart the whole clock on retry: resuming mid-mission
    // with a nearly dead timer would fail the player on arrival.
    active.timeLeft = m.timeLimit || null;
    active.objective = m.objectives[active.stage].label;
    hudBanner('Retrying from checkpoint: ' + active.objective);
    setObjectiveHud();
    return true;
  }

  function abandon() {
    var s = state();
    if (!s.activeMission) { return false; }
    s.activeMission = null;
    hudObjective('');
    return true;
  }

  function update(dt, playerPos) {
    var s = state();
    var active = s.activeMission;
    if (!active || active.failed) { return; }
    if (!(dt > 0)) { return; }
    var m = findMission(active.id);
    if (!m) { return; }
    var obj = m.objectives[active.stage];
    if (!obj) { return; }
    if (active.timeLeft !== null && active.timeLeft !== undefined) {
      active.timeLeft -= dt;
      if (active.timeLeft <= 0) {
        active.timeLeft = 0;
        failMission('Out of time');
        return;
      }
    }
    if (obj.type === 'survive' || obj.type === 'lose') {
      active.elapsed = (active.elapsed || 0) + dt;
      if (active.elapsed >= obj.seconds) {
        active.elapsed = 0;
        completeObjective();
      }
      return;
    }
    if (obj.type === 'chase') { return; }
    if (!playerPos || typeof playerPos.x !== 'number' || typeof playerPos.z !== 'number') { return; }
    if (obj.target) {
      var r = obj.radius || 28;
      if (dist2(playerPos.x, playerPos.z, obj.target.x, obj.target.z) <= r * r) {
        completeObjective();
      }
    }
  }

  function chaseTargetStopped(targetCar) {
    var s = state();
    var active = s.activeMission;
    if (!active || active.failed) { return false; }
    var obj = currentObjective(active);
    if (!obj || obj.type !== 'chase') { return false; }
    if (targetCar && obj.targetCar && targetCar !== obj.targetCar) { return false; }
    return completeObjective();
  }

  function progress() {
    var active = state().activeMission;
    if (!active) { return null; }
    var m = findMission(active.id);
    if (!m) { return null; }
    return {
      id: active.id, stage: active.stage, stages: m.objectives.length,
      percent: Math.round((active.stage / m.objectives.length) * 100),
      objective: active.objective, timeLeft: active.timeLeft,
      failed: !!active.failed, checkpoint: active.checkpoint
    };
  }

  function isDone(id) { return state().storyFlags.missionsDone.indexOf(id) !== -1; }

  function totalReward() {
    var sum = 0;
    var i;
    for (i = 0; i < MISSIONS.length; i++) { sum += MISSIONS[i].reward; }
    return sum;
  }

  /* Position of the current objective's target, for the minimap
     marker and for main.js staging. Chase objectives have no fixed
     point, so the target car's live position is returned instead. */
  function currentTarget() {
    var active = state().activeMission;
    if (!active) { return null; }
    var obj = currentObjective(active);
    if (!obj) { return null; }
    if (obj.target) { return { x: obj.target.x, z: obj.target.z }; }
    if (obj.type === 'chase' && obj.targetCar && CA.state && CA.state.cars) {
      for (var i = 0; i < CA.state.cars.length; i++) {
        if (CA.state.cars[i].id === obj.targetCar) {
          return { x: CA.state.cars[i].x, z: CA.state.cars[i].z };
        }
      }
    }
    return null;
  }

  CA.missions = {
    list: MISSIONS,
    places: P,
    find: findMission,
    nextId: nextMissionId,
    currentTarget: currentTarget,
    current: function () {
      var a = state().activeMission;
      if (!a) { return null; }
      return { id: a.id, stage: a.stage, objective: a.objective, timer: a.timeLeft, timeLeft: a.timeLeft, failed: !!a.failed, checkpoint: a.checkpoint };
    },
    progress: progress,
    objectiveText: function () { return objectiveText(state().activeMission); },
    currentObjective: function () { return currentObjective(state().activeMission); },
    startMission: startMission,
    startNext: startNext,
    completeObjective: completeObjective,
    chaseTargetStopped: chaseTargetStopped,
    failMission: failMission,
    retry: retry,
    abandon: abandon,
    update: update,
    finishWithChoice: finishWithChoice,
    isDone: isDone,
    isCampaignComplete: function () { return state().storyFlags.missionsDone.length >= 8; },
    doneCount: function () { return state().storyFlags.missionsDone.length; },
    totalReward: totalReward
  };
})();
