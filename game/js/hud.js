// hud.js — Cayo Azul HUD.
// Health bar, money number, wanted stars, clock (hour/minute),
// district name, current objective in one short line, radio station,
// speed while driving, kill streak when above one. Long objective
// text is cut with an ellipsis so it never overflows its box. The
// district banner sits bottom left, the clock top right, so they
// never overlap. Elements are found by id; if an element is missing
// it is created once and appended to the body, so the HUD works
// even before index.html grows its full set.
// Revision notes: low health now adds a 'low-health' class the page
// can pulse red; setSpeed() lets the car module report speed
// directly instead of the HUD guessing at state fields; flash()
// drives a full-screen damage vignette; showFine() writes the
// busted / wasted fine line for the end screens.
(function () {
  'use strict';
  var CA = window.CA || (window.CA = {});
  if (!CA.state) CA.state = {};

  var MAX_OBJECTIVE = 64;
  var LOW_HEALTH = 30;
  var els = {};
  var toastQueue = [];
  var toastTimer = 0;
  var currentDistrict = '';
  var bannerTimer = 0;
  var lastObjective = '';
  var lastSpeedKmh = null;
  var flashTimer = 0;

  var SPECS = {
    'hud-health': { tag: 'div', cls: 'hud-health', pos: 'top-left' },
    'hud-money': { tag: 'div', cls: 'hud-money', pos: 'top-left' },
    'hud-stars': { tag: 'div', cls: 'hud-stars', pos: 'top-centre' },
    'hud-clock': { tag: 'div', cls: 'hud-clock', pos: 'top-right' },
    'hud-district': { tag: 'div', cls: 'hud-district', pos: 'bottom-left' },
    'hud-objective': { tag: 'div', cls: 'hud-objective', pos: 'top-centre' },
    'hud-radio': { tag: 'div', cls: 'hud-radio', pos: 'bottom-right' },
    'hud-speed': { tag: 'div', cls: 'hud-speed', pos: 'bottom-right' },
    'hud-streak': { tag: 'div', cls: 'hud-streak', pos: 'top-left' },
    'hud-toast': { tag: 'div', cls: 'hud-toast', pos: 'centre' },
    'hud-flash': { tag: 'div', cls: 'hud-flash', pos: 'full' },
    'hud-fine': { tag: 'div', cls: 'hud-fine', pos: 'centre' }
  };

  /* Element ids: index.html names them health, money, stars,
     clock, district, radio, objective, speed, streak, toast,
     banner and damage-flash. (G integration: the old code looked
     for hud-* ids that do not exist on the page, so it created
     invisible duplicate divs and the real HUD never updated.) */
  var ID_MAP = {
    'hud-health': 'health',
    'hud-money': 'money',
    'hud-stars': 'stars',
    'hud-clock': 'clock',
    'hud-district': 'district',
    'hud-objective': 'objective',
    'hud-radio': 'radio',
    'hud-speed': 'speed',
    'hud-streak': 'streak',
    'hud-toast': 'toast',
    'hud-flash': 'damage-flash',
    'hud-banner': 'banner'
  };

  function el(id) {
    if (els[id]) return els[id];
    var node = null;
    var realId = ID_MAP[id] || id;
    if (typeof document !== 'undefined') node = document.getElementById(realId);
    if (!node && typeof document !== 'undefined') {
      var spec = SPECS[id];
      node = document.createElement(spec ? spec.tag : 'div');
      node.id = realId;
      if (spec) node.className = spec.cls;
      document.body.appendChild(node);
    }
    els[id] = node;
    return node;
  }

  function truncate(text, max) {
    if (text == null) return '';
    var s = String(text);
    if (s.length <= max) return s;
    if (max <= 3) return s.slice(0, max);
    return s.slice(0, max - 3) + '...';
  }

  function formatMoney(n) {
    var v = Math.floor(n || 0);
    var s = String(Math.abs(v));
    var out = '';
    while (s.length > 3) {
      out = ',' + s.slice(-3) + out;
      s = s.slice(0, -3);
    }
    out = s + out;
    return (v < 0 ? '-$' : '$') + out;
  }

  function formatClock(hour, minute) {
    var h = ((Math.floor(hour) % 24) + 24) % 24;
    var m = ((Math.floor(minute) % 60) + 60) % 60;
    return (h < 10 ? '0' + h : '' + h) + ':' + (m < 10 ? '0' + m : '' + m);
  }

  function starsText(level) {
    var out = '';
    for (var i = 0; i < 5; i++) out += (i < level) ? '\u2605' : '\u2606';
    return out;
  }

  function districtAt(x, z) {
    if (CA.city && CA.city.districtAt) {
      var d = CA.city.districtAt(x, z);
      if (d) return (typeof d === 'string') ? d : (d.name || '');
    }
    return '';
  }

  function toast(text) {
    if (!text) return;
    toastQueue.push(String(text));
    if (toastQueue.length > 5) toastQueue.shift();
  }

  function banner(district) {
    if (!district || district === currentDistrict) return;
    currentDistrict = district;
    bannerTimer = 4;
    var node = el('hud-district');
    if (node) {
      node.textContent = district;
      node.style.opacity = '1';
    }
    if (CA.achievements) CA.achievements.visitDistrict(district);
  }

  function setObjective(text) {
    lastObjective = text || '';
  }

  function setSpeed(kmh) {
    lastSpeedKmh = (typeof kmh === 'number') ? Math.round(kmh) : null;
  }

  // Brief red vignette, e.g. on taking damage.
  function flash(strength) {
    flashTimer = strength == null ? 0.4 : strength;
    if (flashTimer > 1) flashTimer = 1;
    if (flashTimer < 0) flashTimer = 0;
  }

  // Fine line for the busted / wasted screens.
  function showFine(kind, amount) {
    var node = null;
    if (typeof document !== 'undefined') {
      node = document.getElementById(kind === 'wasted' ? 'wasted-fine' : 'busted-fine');
    }
    if (!node) return;
    var label = kind === 'busted' ? 'Fine: ' : 'Hospital fee: ';
    node.textContent = label + formatMoney(amount);
  }

  function hideFine() {
    if (typeof document === 'undefined') return;
    ['busted-fine', 'wasted-fine'].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.textContent = '';
    });
  }

  /* Bottom-left banner line (mission titles, dialogue, event
     announcements). The missions and events modules call
     showBanner; the old HUD had no such function, so every
     banner silently vanished. */
  var bannerTextTimer = 0;
  function showBanner(text) {
    var node = el('hud-banner');
    if (!node || !text) return;
    node.textContent = String(text);
    bannerTextTimer = 5;
  }

  /* Busted / wasted end screens. (G integration: the police module
     calls showScreen('busted'|'wasted', {fine|fee, garage}); the
     old HUD had no showScreen, so the run ended with no screen.) */
  function showScreen(kind, info) {
    if (typeof document === 'undefined') return;
    var bustedEl = document.getElementById('busted-screen');
    var wastedEl = document.getElementById('wasted-screen');
    if (bustedEl) bustedEl.hidden = kind !== 'busted';
    if (wastedEl) wastedEl.hidden = kind !== 'wasted';
    if (info) {
      if (kind === 'busted') showFine('busted', info.fine || 0);
      else if (kind === 'wasted') showFine('wasted', info.fee || 0);
    }
    if (CA.state) CA.state.screen = kind;
  }

  function hideScreens() {
    if (typeof document === 'undefined') return;
    ['busted-screen', 'wasted-screen', 'pause-screen'].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.hidden = true;
    });
    hideFine();
    if (CA.state) CA.state.screen = null;
  }

  function objectiveText() {
    if (lastObjective) return lastObjective;
    var st = CA.state || {};
    if (st.activeMission && st.activeMission.objective) return st.activeMission.objective;
    if (CA.missions && CA.missions.objectiveText) return CA.missions.objectiveText();
    return '';
  }

  function update(dt) {
    var st = CA.state || {};
    var p = st.player || {};
    var hour = (typeof st.hour === 'number') ? st.hour
      : ((st.clock && typeof st.clock.hour === 'number') ? st.clock.hour
      : ((CA.weather && CA.weather.hour) ? CA.weather.hour() : 9));
    var minute = (typeof st.minute === 'number') ? st.minute
      : ((st.clock && typeof st.clock.minute === 'number') ? st.clock.minute : 0);
    var step = dt || 0;

    var health = el('hud-health');
    if (health) {
      /* #health is the fill div inside #health-track: its width
         is the bar, and the page's CSS colours it red when it
         carries the 'low' class. No text inside the fill. */
      var hp = (typeof p.health === 'number') ? p.health : 100;
      if (hp < 0) hp = 0;
      if (hp > 100) hp = 100;
      health.style.width = hp + '%';
      health.className = hp <= LOW_HEALTH ? 'low' : '';
    }
    var money = el('hud-money');
    if (money) money.textContent = formatMoney(p.money);

    var level = 0;
    /* (G integration: CA.police.level is a function, not a number —
       the old typeof check never matched and the stars stayed 0.) */
    if (CA.police && typeof CA.police.level === 'function') {
      try { level = CA.police.level(); } catch (e) { level = 0; }
    } else if (CA.police && typeof CA.police.level === 'number') level = CA.police.level;
    else if (typeof st.wanted === 'number') level = Math.floor(st.wanted);
    var stars = el('hud-stars');
    if (stars) {
      stars.textContent = starsText(level);
      stars.style.display = level > 0 ? '' : 'none';
    }

    var clock = el('hud-clock');
    if (clock) clock.textContent = formatClock(hour, minute);

    var district = districtAt(p.x || 0, p.z || 0);
    if (district) banner(district);
    if (bannerTimer > 0) {
      bannerTimer -= step;
      var dNode = el('hud-district');
      if (dNode) dNode.style.opacity = bannerTimer < 1 ? String(Math.max(0, bannerTimer)) : '1';
    }

    var obj = el('hud-objective');
    if (obj) obj.textContent = truncate(objectiveText(), MAX_OBJECTIVE);

    var radio = el('hud-radio');
    if (radio) {
      var name = (CA.radio && CA.radio.currentName) ? CA.radio.currentName() : '';
      radio.textContent = name;
      radio.style.display = name ? '' : 'none';
    }

    var speed = el('hud-speed');
    if (speed) {
      var kmh = lastSpeedKmh;
      if (kmh == null && p.onFoot === false && CA.cars && CA.cars.currentSpeed) {
        kmh = Math.round(CA.cars.currentSpeed() * 3.6);
      } else if (kmh == null && p.onFoot === false && typeof p.speed === 'number') {
        kmh = Math.round(p.speed * 3.6);
      }
      if (p.onFoot === false && kmh != null) {
        speed.textContent = kmh + ' km/h';
        speed.style.display = '';
      } else {
        speed.style.display = 'none';
      }
    }

    var streak = el('hud-streak');
    if (streak) {
      var ks = p.killStreak || 0;
      if (ks > 1) {
        streak.textContent = 'Streak x' + ks;
        streak.style.display = '';
      } else {
        streak.style.display = 'none';
      }
    }

    // Damage flash fades out over its timer.
    var flashNode = el('hud-flash');
    if (flashNode) {
      if (flashTimer > 0) {
        flashTimer -= step;
        flashNode.style.opacity = String(Math.max(0, flashTimer));
        flashNode.style.display = '';
      } else {
        flashNode.style.display = 'none';
      }
    }

    // Toasts: one at a time, two and a half seconds each.
    if (toastTimer > 0) toastTimer -= step;
    var toastNode = el('hud-toast');
    if (toastNode) {
      if (toastTimer <= 0 && toastQueue.length) {
        toastNode.textContent = toastQueue.shift();
        toastNode.style.display = '';
        toastTimer = 2.5;
      } else if (toastTimer <= 0) {
        toastNode.style.display = 'none';
      }
    }

    // Banner line fades after its timer runs out.
    if (bannerTextTimer > 0) {
      bannerTextTimer -= step;
      if (bannerTextTimer <= 0) {
        var bNode = el('hud-banner');
        if (bNode) bNode.textContent = '';
      }
    }

    if (CA.minimap) CA.minimap.draw();
  }

  CA.hud = {
    update: update,
    toast: toast,
    banner: banner,
    setObjective: setObjective,
    setSpeed: setSpeed,
    flash: flash,
    showFine: showFine,
    hideFine: hideFine,
    showBanner: showBanner,
    showScreen: showScreen,
    hideScreens: hideScreens,
    truncate: truncate,
    formatMoney: formatMoney,
    formatClock: formatClock,
    starsText: starsText,
    maxObjective: MAX_OBJECTIVE,
    lowHealth: LOW_HEALTH,
    queuedToasts: function () { return toastQueue.length; }
  };
})();
