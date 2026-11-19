/* Cayo Azul — police.js (Module C) — REVISION 2
 * Wanted level 0–5 stars, police officers and cruisers, pursuit,
 * roadblocks, busted / wasted respawns.
 * Owns CA.state.wanted, CA.state.police (foot officers) and
 * CA.state.policeCars (cruisers), plus CA.state.roadblocks.
 * Money fines go through CA.economy when it exists, else the state
 * balance directly. Deterministic: internal seeded generator only;
 * no Date, no clock reads, no network.
 *
 * Revision changes vs pass 1:
 * - Fixed the ram-damage arithmetic (pass 1 multiplied by dt twice
 *   through a stray factor; ramming now deals a clean 30 hp/s to the
 *   player's car and 6 hp/s to the cruiser, on-foot contact 10 hp/s).
 * - Added onGunshot(x, z): firing near police adds heat, so the
 *   "firing near police" rule from the spec is actually wired up.
 *   Added isBeingChased() for the HUD / missions.
 * - Officers now give up and despawn when the player gets far away
 *   (they respawn near the player while wanted), instead of walking
 *   across the whole island forever.
 * - Roadblock cruisers un-park and join the chase once the player
 *   passes the block, instead of sitting there for the rest of the
 *   pursuit.
 * - Busted while driving is now handled in update() via the wrecked
 *   car AND via an officer reaching a stopped player car; the
 *   cooldown guard prevents double-busts from both paths.
 * - Siren state: cruisers carry siren: true and a sirenPhase that
 *   the renderer can use for flashing lights.
 */
(function () {
  'use strict';

  var CA = (typeof window !== 'undefined' ? window.CA : globalThis.CA) || {};
  if (typeof window !== 'undefined') { window.CA = CA; }
  if (typeof globalThis !== 'undefined') { globalThis.CA = CA; }

  var rngState = 7777;
  function rng() {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
  }
  function rngRange(a, b) { return a + rng() * (b - a); }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function wrapAngle(a) {
    while (a > Math.PI) { a -= Math.PI * 2; }
    while (a < -Math.PI) { a += Math.PI * 2; }
    return a;
  }
  function dist2(ax, az, bx, bz) {
    var dx = ax - bx, dz = az - bz;
    return dx * dx + dz * dz;
  }

  var BUST_FINE = 150;
  var HOSPITAL_FEE = 200;
  var DECAY_DELAY = 8; /* seconds crime-free before wanted starts falling */
  var DECAY_RATE = 0.12; /* stars per second once decaying */
  var SIGHT_RANGE = 120; /* units within which police can spot the player */
  var ARREST_RANGE = 2.2;
  var RAM_RANGE = 5;
  var GIVE_UP_RANGE = 260; /* officers despawn beyond this while wanted */
  var RAM_DPS_PLAYER_CAR = 30; /* damage per second to the player's car */
  var RAM_DPS_CRUISER = 6;
  var RAM_DPS_ON_FOOT = 10;

  function ensureState() {
    if (!CA.state) { CA.state = {}; }
    var s = CA.state;
    if (!s.player) {
      s.player = { x: 0, y: 0, z: 0, facing: 0, health: 100, maxHealth: 100,
        money: 0, onFoot: true, carId: null, killStreak: 0, streakTimer: 0,
        speed: 0, lastDamageTime: -999, sprinting: false };
    }
    if (typeof s.wanted !== 'number') { s.wanted = 0; }
    if (!Array.isArray(s.police)) { s.police = []; } /* foot officers */
    if (!Array.isArray(s.policeCars)) { s.policeCars = []; } /* cruisers */
    if (!Array.isArray(s.roadblocks)) { s.roadblocks = []; }
    if (typeof s.playTime !== 'number') { s.playTime = 0; }
    if (typeof s.lastCrimeTime !== 'number') { s.lastCrimeTime = -999; }
    if (typeof s.lastSeenTime !== 'number') { s.lastSeenTime = -999; }
    if (!s.clock) { s.clock = { hour: 10, minute: 0, day: 1 }; }
    if (typeof s.seed === 'number') { rngState = (s.seed >>> 0) + 7777 || 7777; }
    return s;
  }

  function playSound(name) {
    if (CA.audio && typeof CA.audio.play === 'function') {
      try { CA.audio.play(name); } catch (e) {}
    }
  }
  function spawnParticles(kind, x, y, z, n) {
    if (CA.particles && typeof CA.particles.spawn === 'function') {
      try { CA.particles.spawn(kind, x, y, z, n); } catch (e) {}
    }
  }
  function unlockAchievement(id) {
    if (CA.achievements && typeof CA.achievements.unlock === 'function') {
      try { CA.achievements.unlock(id); } catch (e) {}
    }
  }
  function worldBounds() {
    if (CA.city && CA.city.bounds && typeof CA.city.bounds.minX === 'number') {
      return CA.city.bounds;
    }
    return { minX: -1800, maxX: 1800, minZ: -1500, maxZ: 1500 };
  }
  function garageList() {
    /* (G integration: CA.city.garages is an array, not a function —
       the old call CA.city.garages() always threw and fell through
       to a fallback list at the wrong coordinates.) */
    if (CA.city && Array.isArray(CA.city.garages) && CA.city.garages.length) {
      return CA.city.garages;
    }
    if (CA.city && typeof CA.city.garageList === 'function') {
      try {
        var g = CA.city.garageList();
        if (Array.isArray(g) && g.length) { return g; }
      } catch (e) {}
    }
    if (CA.state && Array.isArray(CA.state.garages) && CA.state.garages.length) {
      return CA.state.garages;
    }
    /* Fallback garages, one per district named in the spec. */
    return [
      { name: 'Harbour Garage', district: 'Harbour', x: -200, z: -1200 },
      { name: 'Old Town Garage', district: 'Old Town', x: -600, z: -300 },
      { name: 'Market Garage', district: 'Market', x: 200, z: 100 },
      { name: 'Marina Garage', district: 'Marina', x: 900, z: -900 },
      { name: 'Palm Row Garage', district: 'Palm Row', x: 700, z: 600 },
      { name: 'North Hill Garage', district: 'North Hill', x: -300, z: 1100 }
    ];
  }
  function nearestGarage(x, z) {
    var list = garageList();
    var best = list[0], bestD = Infinity;
    for (var i = 0; i < list.length; i++) {
      var d = dist2(x, z, list[i].x, list[i].z);
      if (d < bestD) { bestD = d; best = list[i]; }
    }
    return best;
  }
  function charge(amount, reason) {
    var s = ensureState();
    var p = s.player;
    if (CA.economy && typeof CA.economy.pay === 'function') {
      /* (G integration: economy.pay returns a result object, not
         a number — the old code returned it straight into the
         fine display, which printed $NaN.) */
      try {
        var res = CA.economy.pay(amount, reason);
        return (res && res.ok) ? res.amount : 0;
      } catch (e) {}
    }
    var paid = Math.min(Math.max(0, p.money || 0), amount);
    p.money = Math.max(0, (p.money || 0) - amount);
    return paid;
  }

  /* ---------- wanted level ---------- */
  function level() {
    return Math.floor(clamp(ensureState().wanted || 0, 0, 5));
  }
  function rawWanted() { return ensureState().wanted || 0; }

  function addHeat(amount, reason) {
    var s = ensureState();
    if (typeof amount !== 'number' || amount === 0) { return level(); }
    var before = level();
    s.wanted = clamp(s.wanted + amount, 0, 5);
    s.lastCrimeTime = s.playTime;
    if (level() > before) {
      playSound('siren');
      if (level() >= 5) { unlockAchievement('five-star'); }
    }
    s.lastHeatReason = reason || 'crime';
    return level();
  }
  function addWanted(amount, reason) { return addHeat(amount, reason); }

  /* Firing a shot near police: heat scales with how close they are. */
  function onGunshot(x, z) {
    var s = ensureState();
    var nearest = Infinity;
    for (var i = 0; i < s.police.length; i++) {
      nearest = Math.min(nearest, dist2(x, z, s.police[i].x, s.police[i].z));
    }
    for (var j = 0; j < s.policeCars.length; j++) {
      nearest = Math.min(nearest, dist2(x, z, s.policeCars[j].x, s.policeCars[j].z));
    }
    if (nearest < 60 * 60) {
      addHeat(1, 'firing near police');
      return true;
    }
    if (nearest < 120 * 120) {
      addHeat(0.5, 'gunfire heard');
      return true;
    }
    /* Nobody close enough to hear it: also publish it for pedestrians. */
    s.lastGunshotAt = s.playTime;
    s.lastGunshotX = x;
    s.lastGunshotZ = z;
    return false;
  }

  function setWanted(n) {
    var s = ensureState();
    s.wanted = clamp(typeof n === 'number' ? n : 0, 0, 5);
    if (s.wanted > 0) { s.lastCrimeTime = s.playTime; }
    return level();
  }
  function clearWanted() {
    var s = ensureState();
    s.wanted = 0;
    return 0;
  }

  function canSeePlayer() {
    var s = ensureState();
    if (level() === 0) { return false; }
    var p = s.player;
    for (var i = 0; i < s.police.length; i++) {
      var o = s.police[i];
      if (o.state !== 'down' &&
          dist2(p.x, p.z, o.x, o.z) < SIGHT_RANGE * SIGHT_RANGE) { return true; }
    }
    for (var j = 0; j < s.policeCars.length; j++) {
      var c = s.policeCars[j];
      if (dist2(p.x, p.z, c.x, c.z) < SIGHT_RANGE * SIGHT_RANGE) { return true; }
    }
    if (level() >= 3) {
      for (var k = 0; k < s.roadblocks.length; k++) {
        var r = s.roadblocks[k];
        if (dist2(p.x, p.z, r.x, r.z) < SIGHT_RANGE * SIGHT_RANGE) { return true; }
      }
    }
    return false;
  }

  function isBeingChased() {
    var s = ensureState();
    if (level() === 0) { return false; }
    return s.police.length > 0 || s.policeCars.length > 0;
  }

  /* ---------- spawning ---------- */
  var nextOfficerId = 1;
  var nextBlockId = 1;
  var spawnTimer = 0;
  var blockTimer = 0;

  function spawnOfficer(x, z) {
    var s = ensureState();
    var p = s.player;
    var ox = (typeof x === 'number') ? x : p.x + rngRange(-60, 60);
    var oz = (typeof z === 'number') ? z : p.z + rngRange(-60, 60);
    var officer = {
      id: 'officer-' + (nextOfficerId++),
      x: ox, y: 0, z: oz,
      facing: 0, speed: 0,
      state: 'approach', /* approach | arrest | patrol | down */
      walkPhase: rngRange(0, Math.PI * 2),
      colour: '#1a2a6b',
      arrestTimer: 0,
      downTimer: 0
    };
    s.police.push(officer);
    return officer;
  }

  function spawnCruiser(x, z) {
    var s = ensureState();
    if (!CA.cars || typeof CA.cars.spawnCar !== 'function') { return null; }
    var p = s.player;
    var cx = (typeof x === 'number') ? x : p.x + rngRange(-90, 90);
    var cz = (typeof z === 'number') ? z : p.z + rngRange(-90, 90);
    var car = CA.cars.spawnCar('police', cx, cz, rngRange(0, Math.PI * 2),
      { driver: 'police' });
    car.cruiseSpeed = 0;
    car.siren = true;
    car.sirenPhase = rngRange(0, Math.PI * 2);
    s.policeCars.push(car);
    return car;
  }

  function spawnRoadblockAhead() {
    var s = ensureState();
    var p = s.player;
    var ahead = 90;
    var bx = p.x + Math.sin(p.facing) * ahead;
    var bz = p.z + Math.cos(p.facing) * ahead;
    var block = {
      id: 'block-' + (nextBlockId++),
      x: bx, z: bz,
      facing: p.facing,
      cruisers: 0,
      life: 45
    };
    /* Two cruisers parked across the road at the block. */
    for (var i = 0; i < 2; i++) {
      var side = (i === 0 ? -6 : 6);
      var cx = bx + Math.cos(p.facing) * side;
      var cz = bz - Math.sin(p.facing) * side;
      var car = spawnCruiser(cx, cz);
      if (car) {
        car.facing = p.facing + Math.PI / 2;
        car.speed = 0;
        car.parked = true;
        car.roadblockId = block.id;
        block.cruisers++;
      }
    }
    s.roadblocks.push(block);
    return block;
  }

  function desiredCounts(stars) {
    if (stars <= 0) { return { officers: 0, cruisers: 0 }; }
    if (stars === 1) { return { officers: 2, cruisers: 0 }; }
    if (stars === 2) { return { officers: 3, cruisers: 2 }; }
    if (stars === 3) { return { officers: 4, cruisers: 4 }; }
    if (stars === 4) { return { officers: 5, cruisers: 6 }; }
    return { officers: 6, cruisers: 9 }; /* 5 stars: the whole island hunts */
  }

  /* ---------- pursuit ---------- */
  function stepOfficer(officer, dt) {
    var s = ensureState();
    var p = s.player;
    if (officer.state === 'down') {
      officer.downTimer -= dt;
      if (officer.downTimer <= 0) {
        officer.state = 'approach';
        officer.arrestTimer = 0;
      }
      return;
    }
    var d2 = dist2(p.x, p.z, officer.x, officer.z);
    if (p.onFoot) {
      var dx = p.x - officer.x, dz = p.z - officer.z;
      var d = Math.sqrt(d2) || 1;
      officer.facing = Math.atan2(dx / d, dz / d);
      var speed = (level() >= 3 ? 5.2 : 4.2);
      if (d > ARREST_RANGE) {
        officer.speed = speed;
        officer.x += (dx / d) * speed * dt;
        officer.z += (dz / d) * speed * dt;
        officer.walkPhase += dt * 9;
        officer.state = 'approach';
        officer.arrestTimer = 0;
      } else {
        officer.speed = 0;
        officer.state = 'arrest';
        officer.arrestTimer += dt;
        if (officer.arrestTimer > 1.2) {
          busted('arrested on foot');
        }
      }
    } else {
      /* Player is driving: officers stand their ground and watch. */
      officer.speed = 0;
      officer.state = 'patrol';
      officer.arrestTimer = 0;
      /* An officer who reaches a stopped player car arrests the driver. */
      var pc = null;
      if (CA.cars && typeof CA.cars.playerCar === 'function') {
        try { pc = CA.cars.playerCar(); } catch (e) {}
      }
      if (pc && Math.abs(pc.speed) < 0.5 && d < ARREST_RANGE + 2) {
        officer.arrestTimer += dt;
        if (officer.arrestTimer > 2) { busted('pulled from the car'); }
      }
    }
  }

  function stepCruiser(car, dt) {
    var s = ensureState();
    var p = s.player;
    if (!car || car.wrecked) { return; }
    car.sirenPhase = (car.sirenPhase || 0) + dt * 6;
    if (car.parked) {
      /* Roadblock cruiser: hold place until the player passes the
       * block, then un-park and join the chase. */
      var bd = dist2(p.x, p.z, car.x, car.z);
      var passed = false;
      for (var bi = 0; bi < s.roadblocks.length; bi++) {
        var rb = s.roadblocks[bi];
        if (rb.id === car.roadblockId) {
          var along = (p.x - rb.x) * Math.sin(rb.facing) +
                      (p.z - rb.z) * Math.cos(rb.facing);
          if (along > 12) { passed = true; }
        }
      }
      if (passed || bd < 25) {
        car.parked = false;
      } else {
        return;
      }
    }
    var d2 = dist2(p.x, p.z, car.x, car.z);
    var d = Math.sqrt(d2) || 1;
    var stars = level();
    var topSpeed = 30 + stars * 2.5; /* faster and more numerous at 3+ */
    if (stars >= 5) { topSpeed = 44; }
    var playerCar = null;
    if (CA.cars && typeof CA.cars.playerCar === 'function') {
      try { playerCar = CA.cars.playerCar(); } catch (e) {}
    }
    var tx = p.x, tz = p.z;
    if (playerCar && !p.onFoot) {
      /* Aim slightly ahead of the player's car to cut it off. */
      tx = playerCar.x + Math.sin(playerCar.facing) * playerCar.speed * 0.4;
      tz = playerCar.z + Math.cos(playerCar.facing) * playerCar.speed * 0.4;
    }
    var wantFacing = Math.atan2(tx - car.x, tz - car.z);
    var diff = wrapAngle(wantFacing - car.facing);
    car.facing += clamp(diff * 2.2, -2.4 * dt, 2.4 * dt);
    if (d < 30) {
      car.speed = Math.min(topSpeed, car.speed + 16 * dt);
    } else {
      car.speed = Math.min(topSpeed * 0.85, car.speed + 10 * dt);
    }
    car.x += Math.sin(car.facing) * car.speed * dt;
    car.z += Math.cos(car.facing) * car.speed * dt;
    /* Ramming contact: clean per-second damage rates. */
    if (playerCar && !p.onFoot) {
      if (d < RAM_RANGE) {
        playerCar.damage = Math.min(100, (playerCar.damage || 0) + RAM_DPS_PLAYER_CAR * dt);
        car.damage = Math.min(100, (car.damage || 0) + RAM_DPS_CRUISER * dt);
        playerCar.speed *= 0.92;
        spawnParticles('sparks', car.x, 0.8, car.z, 2);
        playSound('crash');
        if (CA.camera && typeof CA.camera.shake === 'function') {
          try { CA.camera.shake(0.2); } catch (e) {}
        }
      }
    } else if (p.onFoot && d < RAM_RANGE) {
      if (CA.player && typeof CA.player.damage === 'function') {
        try { CA.player.damage(RAM_DPS_ON_FOOT * dt, 'police car', car.x, car.z); } catch (e) {}
      }
    }
    var b = worldBounds();
    car.x = clamp(car.x, b.minX + 2, b.maxX - 2);
    car.z = clamp(car.z, b.minZ + 2, b.maxZ - 2);
  }

  /* ---------- busted / wasted ---------- */
  function respawnAtGarage() {
    var s = ensureState();
    var p = s.player;
    var g = nearestGarage(p.x, p.z);
    /* Leave any car behind; the player respawns on foot. */
    if (p.carId && CA.cars && typeof CA.cars.getCar === 'function') {
      try {
        var car = CA.cars.getCar(p.carId);
        if (car) { car.driver = 'none'; car.speed = 0; }
      } catch (e) {}
    }
    p.carId = null;
    p.onFoot = true;
    p.x = g.x + 6;
    p.z = g.z + 6;
    p.y = 0;
    p.facing = 0;
    p.speed = 0;
    p.killStreak = 0;
    p.streakTimer = 0;
    return g;
  }

  function clearPursuit() {
    var s = ensureState();
    s.police = [];
    s.roadblocks = [];
    if (CA.cars) {
      for (var i = s.policeCars.length - 1; i >= 0; i--) {
        if (typeof CA.cars.removeCar === 'function') {
          try { CA.cars.removeCar(s.policeCars[i].id); } catch (e) {}
        }
      }
    }
    s.policeCars = [];
  }

  function busted(reason) {
    var s = ensureState();
    var p = s.player;
    if (s.bustedCooldown && s.playTime - s.bustedCooldown < 3) { return null; }
    s.bustedCooldown = s.playTime;
    var fine = charge(BUST_FINE, 'busted fine');
    var g = respawnAtGarage();
    p.health = Math.max(p.health, p.maxHealth * 0.5);
    clearWanted();
    clearPursuit();
    playSound('busted');
    if (CA.hud && typeof CA.hud.showScreen === 'function') {
      try { CA.hud.showScreen('busted', { fine: fine, garage: g.name }); } catch (e) {}
    }
    s.lastBusted = { reason: reason || 'busted', fine: fine, garage: g.name,
                     at: s.playTime };
    return s.lastBusted;
  }

  function wasted(source) {
    var s = ensureState();
    var p = s.player;
    if (s.wastedCooldown && s.playTime - s.wastedCooldown < 3) { return null; }
    s.wastedCooldown = s.playTime;
    var fee = charge(HOSPITAL_FEE, 'hospital fee');
    var g = respawnAtGarage();
    p.health = p.maxHealth;
    clearWanted();
    clearPursuit();
    playSound('wasted');
    if (CA.hud && typeof CA.hud.showScreen === 'function') {
      try { CA.hud.showScreen('wasted', { fee: fee, garage: g.name }); } catch (e) {}
    }
    s.lastWasted = { source: source || 'unknown', fee: fee, garage: g.name,
                     at: s.playTime };
    return s.lastWasted;
  }

  /* Called by CA.cars when the player's car is wrecked. */
  function onPlayerWrecked(car) {
    var s = ensureState();
    if (level() === 0) { return false; }
    var p = s.player;
    for (var i = 0; i < s.policeCars.length; i++) {
      if (dist2(p.x, p.z, s.policeCars[i].x, s.policeCars[i].z) < 40 * 40) {
        busted('wrecked while police close');
        return true;
      }
    }
    for (var j = 0; j < s.police.length; j++) {
      if (s.police[j].state !== 'down' &&
          dist2(p.x, p.z, s.police[j].x, s.police[j].z) < 25 * 25) {
        busted('wrecked while police close');
        return true;
      }
    }
    return false;
  }
  function onPlayerWasted(source) { return wasted(source); }

  /* ---------- update ---------- */
  function update(dt) {
    if (typeof dt !== 'number' || dt <= 0) { dt = 0.016; }
    dt = Math.min(dt, 0.05);
    var s = ensureState();
    var p = s.player;
    var stars = level();

    /* Wanted decay: only when out of sight and crime-free for a while. */
    if (stars > 0) {
      var seen = canSeePlayer();
      if (seen) { s.lastSeenTime = s.playTime; }
      var quietFor = s.playTime - Math.max(s.lastCrimeTime, s.lastSeenTime);
      if (!seen && quietFor > DECAY_DELAY) {
        s.wanted = Math.max(0, s.wanted - DECAY_RATE * dt);
        if (level() === 0 && stars > 0) {
          clearPursuit();
          if (stars >= 5) { unlockAchievement('escape-five-star'); }
        }
      }
    }

    /* Maintain pursuit numbers for the current level. */
    var want = desiredCounts(stars);
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = 1.2;
      if (stars > 0) {
        if (s.police.length < want.officers) { spawnOfficer(); }
        if (s.policeCars.length < want.cruisers) { spawnCruiser(); }
      }
    }
    /* Despawn surplus when the level falls, and officers who fell too
     * far behind (they respawn near the player while wanted). */
    while (s.police.length > want.officers) { s.police.pop(); }
    for (var oi = s.police.length - 1; oi >= 0; oi--) {
      if (dist2(p.x, p.z, s.police[oi].x, s.police[oi].z) > GIVE_UP_RANGE * GIVE_UP_RANGE) {
        s.police.splice(oi, 1);
      }
    }
    while (s.policeCars.length > want.cruisers) {
      var extra = s.policeCars.pop();
      if (CA.cars && typeof CA.cars.removeCar === 'function') {
        try { CA.cars.removeCar(extra.id); } catch (e) {}
      }
    }
    if (stars === 0 && (s.police.length || s.policeCars.length)) {
      clearPursuit();
    }

    /* Roadblocks at 3+ stars, ahead of the player, refreshed over time. */
    if (stars >= 3) {
      blockTimer -= dt;
      if (blockTimer <= 0) {
        blockTimer = 25;
        if (s.roadblocks.length < stars - 1) { spawnRoadblockAhead(); }
      }
    }
    for (var rb = s.roadblocks.length - 1; rb >= 0; rb--) {
      s.roadblocks[rb].life -= dt;
      if (s.roadblocks[rb].life <= 0 || stars < 3) {
        /* Free any parked cruisers of the expired block. */
        for (var ci = 0; ci < s.policeCars.length; ci++) {
          if (s.policeCars[ci].roadblockId === s.roadblocks[rb].id) {
            s.policeCars[ci].parked = false;
            s.policeCars[ci].roadblockId = null;
          }
        }
        s.roadblocks.splice(rb, 1);
      }
    }

    /* Step every unit. */
    for (var i = 0; i < s.police.length; i++) { stepOfficer(s.police[i], dt); }
    for (var j = 0; j < s.policeCars.length; j++) { stepCruiser(s.policeCars[j], dt); }

    /* Busted check: wrecked player car while wanted. */
    if (!p.onFoot && stars > 0) {
      var pc = null;
      if (CA.cars && typeof CA.cars.playerCar === 'function') {
        try { pc = CA.cars.playerCar(); } catch (e) {}
      }
      if (pc && pc.wrecked) { onPlayerWrecked(pc); }
    }
  }

  /* ---------- drawing ---------- */
  /* One cached GPU mesh for the officer figure. (G integration:
     CA.mesh.person returns raw mesh data — the old code passed
     world coordinates as its colour argument and nothing drew.) */
  var officerGpuMesh = null;
  function drawOfficer(officer) {
    if (!officer || !CA.mesh || typeof CA.mesh.person !== 'function') { return; }
    if (!CA.gl || typeof CA.gl.createMesh !== 'function' ||
        typeof CA.gl.drawMesh !== 'function') { return; }
    if (!officerGpuMesh) {
      officerGpuMesh = CA.gl.createMesh(CA.mesh.person('#1a2a6b', '#d9a066', '#1a1a22'));
      if (!officerGpuMesh) { return; }
    }
    var bob = Math.abs(Math.sin(officer.walkPhase || 0)) * 0.1;
    var model;
    if (CA.render && typeof CA.render.modelMatrix === 'function') {
      model = CA.render.modelMatrix(officer.x, (officer.y || 0) + bob, officer.z, officer.facing);
    } else {
      var c = Math.cos(officer.facing || 0), sn = Math.sin(officer.facing || 0);
      model = [c, 0, -sn, 0, 0, 1, 0, 0, sn, 0, c, 0, officer.x, (officer.y || 0) + bob, officer.z, 1];
    }
    CA.gl.drawMesh(officerGpuMesh, model);
  }
  function drawAll() {
    var s = ensureState();
    for (var i = 0; i < s.police.length; i++) { drawOfficer(s.police[i]); }
    /* Cruisers are drawn by CA.cars.drawAll from the shared car list. */
  }

  CA.police = {
    BUST_FINE: BUST_FINE,
    HOSPITAL_FEE: HOSPITAL_FEE,
    level: level,
    rawWanted: rawWanted,
    addHeat: addHeat,
    addWanted: addWanted,
    onGunshot: onGunshot,
    setWanted: setWanted,
    clearWanted: clearWanted,
    canSeePlayer: canSeePlayer,
    isBeingChased: isBeingChased,
    spawnOfficer: spawnOfficer,
    spawnCruiser: spawnCruiser,
    spawnRoadblockAhead: spawnRoadblockAhead,
    desiredCounts: desiredCounts,
    busted: busted,
    wasted: wasted,
    onPlayerWrecked: onPlayerWrecked,
    onPlayerWasted: onPlayerWasted,
    nearestGarage: nearestGarage,
    update: update,
    drawOfficer: drawOfficer,
    drawAll: drawAll
  };

  ensureState();
})();
