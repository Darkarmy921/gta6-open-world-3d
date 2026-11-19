(function () {
  'use strict';

  var CA = window.CA || (window.CA = {});

  function state() {
    if (!CA.state) { CA.state = {}; }
    if (!CA.state.activeEvent) { CA.state.activeEvent = null; }
    if (!CA.state.eventCooldowns) { CA.state.eventCooldowns = {}; }
    if (!CA.state.eventStats) { CA.state.eventStats = { seen: 0, done: 0, dogFound: false, dogTime: 0 }; }
    if (typeof CA.state.eventPickCounter !== 'number') { CA.state.eventPickCounter = 0; }
    return CA.state;
  }

  function hudBanner(text) {
    if (CA.hud && typeof CA.hud.showBanner === 'function') { CA.hud.showBanner(text); }
  }

  function grant(amount, reason) {
    if (amount <= 0) { return; }
    if (CA.economy && typeof CA.economy.grant === 'function') { CA.economy.grant(amount, reason); }
    else if (CA.state && CA.state.player) { CA.state.player.money = (CA.state.player.money || 0) + amount; }
  }

  function addHeat(level, reason) {
    if (CA.police && typeof CA.police.addHeat === 'function') { CA.police.addHeat(level, reason); }
  }

  function isNight() {
    if (CA.weather && typeof CA.weather.isNight === 'function') { return CA.weather.isNight(); }
    return false;
  }

  // Twelve street-event kinds. Each is small, optional, and pays a
  // little cash or reputation where that fits. `nightOnly` and
  // `autoResolve` are honoured by trigger/update below.
  var KINDS = [
    { id: 'street-race', name: 'Street Race Forming', banner: 'A street race is forming nearby. Join in or drive on.', pay: 0, duration: 90, autoResolve: false },
    { id: 'mugging', name: 'Mugging', banner: 'A mugging in progress. Stop it and the victim will thank you.', pay: 80, duration: 60, autoResolve: false },
    { id: 'unlocked-car', name: 'Car Left Unlocked', banner: 'A car was left unlocked with the keys in it. Take it or leave it.', pay: 0, duration: 45, autoResolve: false },
    { id: 'roadblock', name: 'Police Roadblock Ahead', banner: 'Police roadblock ahead. Find another route.', pay: 0, duration: 60, autoResolve: true },
    { id: 'parade', name: 'Parade Blocking a Road', banner: 'A parade is blocking the road ahead. Wait it out or go around.', pay: 0, duration: 75, autoResolve: true },
    { id: 'vendor', name: 'Street Vendor Discount', banner: 'A street vendor is selling cheap snacks today. A small discount, a small boost.', pay: 10, duration: 60, autoResolve: false },
    { id: 'lost-wallet', name: 'Lost Wallet', banner: 'A lost wallet on the pavement. Return it to its owner for a reward.', pay: 60, duration: 90, autoResolve: false },
    { id: 'rival-driver', name: 'Rival Driver Challenge', banner: 'A rival driver wants a quick sprint. Beat him to the next corner.', pay: 150, duration: 90, autoResolve: false },
    { id: 'broken-car', name: 'Broken-Down Car', banner: 'A broken-down car needs a push. Lend a hand.', pay: 40, duration: 60, autoResolve: false },
    { id: 'fireworks', name: 'Fireworks at the Marina', banner: 'Fireworks over the Marina tonight. Worth a look.', pay: 0, duration: 120, nightOnly: true, autoResolve: true },
    { id: 'festival', name: 'Harbour Festival Crowd', banner: 'The harbour festival crowd is out. The cafe is doing good trade.', pay: 25, duration: 120, autoResolve: true },
    { id: 'stray-dog', name: 'Stray Dog', banner: 'A stray dog is following you. It seems to like you.', pay: 0, duration: 180, autoResolve: true }
  ];

  function findKind(id) {
    var i;
    for (i = 0; i < KINDS.length; i++) {
      if (KINDS[i].id === id) { return KINDS[i]; }
    }
    return null;
  }

  function onCooldown(id, now) {
    var s = state();
    var until = s.eventCooldowns[id] || 0;
    return now < until;
  }

  function cooldownLeft(id, now) {
    var s = state();
    var t = (typeof now === 'number') ? now : (s.playTimeSeconds || 0);
    var until = s.eventCooldowns[id] || 0;
    return until > t ? Math.ceil(until - t) : 0;
  }

  function trigger(id, now, pos) {
    var kind = findKind(id);
    if (!kind) { return null; }
    var s = state();
    var t = (typeof now === 'number') ? now : (s.playTimeSeconds || 0);
    if (onCooldown(id, t)) { return null; }
    if (s.activeEvent) { return null; }
    if (kind.nightOnly && !isNight()) { return null; }
    // No events while a story mission is running: roaming only.
    if (CA.state && CA.state.activeMission) { return null; }
    var ev = {
      id: kind.id, name: kind.name, startedAt: t,
      timeLeft: kind.duration, pay: kind.pay, done: false,
      pos: pos || null
    };
    s.activeEvent = ev;
    s.eventStats.seen += 1;
    s.eventCooldowns[id] = t + kind.duration + 300;
    if (id === 'stray-dog') {
      s.eventStats.dogFound = true;
      s.eventStats.dogTime += kind.duration;
    }
    if (id === 'roadblock') { addHeat(1, 'roadblock event'); }
    if (id === 'unlocked-car') { addHeat(1, 'unlocked car taken'); }
    hudBanner(kind.banner);
    return ev;
  }

  function spawnRandom(now, pos) {
    var s = state();
    if (s.activeEvent) { return null; }
    var t = (typeof now === 'number') ? now : (s.playTimeSeconds || 0);
    var start = s.eventPickCounter % KINDS.length;
    var i, kind;
    for (i = 0; i < KINDS.length; i++) {
      kind = KINDS[(start + i) % KINDS.length];
      if (kind.nightOnly && !isNight()) { continue; }
      if (!onCooldown(kind.id, t)) {
        s.eventPickCounter = (start + i + 1) % KINDS.length;
        return trigger(kind.id, t, pos);
      }
    }
    return null;
  }

  function resolve(success) {
    var s = state();
    var ev = s.activeEvent;
    if (!ev) { return 0; }
    s.activeEvent = null;
    if (!success) {
      hudBanner(ev.name + ' passed you by.');
      return 0;
    }
    ev.done = true;
    s.eventStats.done += 1;
    var pay = ev.pay;
    grant(pay, 'street event ' + ev.id);
    if (pay > 0) {
      hudBanner(ev.name + ' done. Paid $' + pay + '.');
    } else {
      hudBanner(ev.name + ' done.');
    }
    return pay;
  }

  function dismiss() {
    var s = state();
    if (!s.activeEvent) { return false; }
    s.activeEvent = null;
    return true;
  }

  function update(dt) {
    var s = state();
    var ev = s.activeEvent;
    if (!ev) { return; }
    if (!(dt > 0)) { return; }
    ev.timeLeft -= dt;
    if (ev.timeLeft <= 0) {
      ev.timeLeft = 0;
      var kind = findKind(ev.id);
      resolve(kind ? !!kind.autoResolve : false);
    }
  }

  CA.events = {
    kinds: KINDS,
    findKind: findKind,
    trigger: trigger,
    spawnRandom: spawnRandom,
    resolve: resolve,
    dismiss: dismiss,
    update: update,
    current: function () { return state().activeEvent; },
    isActive: function () { return !!state().activeEvent; },
    stats: function () { return state().eventStats; },
    cooldownLeft: cooldownLeft,
    listKinds: function () { return KINDS.slice(); }
  };
})();
