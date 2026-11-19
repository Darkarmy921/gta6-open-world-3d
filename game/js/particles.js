// particles.js — Cayo Azul visual effects.
// Smoke from wrecked cars, sparks from collisions, muzzle flashes on
// melee hits, rain splashes, dust behind fast cars. Every effect is a
// small billboard quad in 3D: the list holds plain data (position,
// velocity, size, life, colour) and the renderer draws it; this module
// never touches WebGL directly, it only answers spawn / update / draw.
// Deterministic: variation comes from a counter-fed generator, never
// from the clock or from Math.random.
// Revision notes: wind now drifts smoke and dust sideways; a per-kind
// cap keeps one effect from starving the rest; burst() and rainField()
// give callers composite effects in one call; emitCrash() bundles the
// sparks-plus-smoke of a hard impact.
(function () {
  'use strict';
  var CA = window.CA || (window.CA = {});

  var MAX = 400;
  var KIND_MAX = 150;
  var list = [];
  var spawnCount = 0;
  var windX = 0;
  var windZ = 0;

  // Small deterministic generator: same spawn sequence, same spread.
  function varied(seed, n) {
    var s = (seed * 2654435761 + n * 40503 + 12345) & 0x7fffffff;
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s / 0x7fffffff) * 2 - 1;
  }

  var KINDS = {
    smoke:  { life: 2.2, size: 1.6, vy: 1.4, grav: 0.4,  r: 0.35, g: 0.35, b: 0.35, a: 0.55, grow: 1.6, wind: 1.0 },
    sparks: { life: 0.5, size: 0.22, vy: 2.0, grav: -9, r: 1.0, g: 0.75, b: 0.2, a: 1.0, grow: 0, wind: 0 },
    flash:  { life: 0.12, size: 0.9, vy: 0, grav: 0,   r: 1.0, g: 0.95, b: 0.5, a: 1.0, grow: 0, wind: 0 },
    splash: { life: 0.4, size: 0.3, vy: 2.6, grav: -12, r: 0.75, g: 0.85, b: 1.0, a: 0.8, grow: 0, wind: 0 },
    dust:   { life: 0.9, size: 0.9, vy: 0.5, grav: 0.3, r: 0.72, g: 0.62, b: 0.45, a: 0.4, grow: 1.2, wind: 0.7 },
    rain:   { life: 0.7, size: 0.08, vy: -14, grav: 0,  r: 0.7, g: 0.8, b: 1.0, a: 0.6, grow: 0, wind: 0.2 }
  };

  function countKind(kind) {
    var n = 0;
    for (var i = 0; i < list.length; i++) if (list[i].kind === kind) n++;
    return n;
  }

  function spawn(kind, x, y, z, opts) {
    var def = KINDS[kind];
    if (!def) return null;
    opts = opts || {};
    var count = opts.count || 1;
    var made = null;
    for (var i = 0; i < count; i++) {
      if (list.length >= MAX) list.shift();
      if (countKind(kind) >= KIND_MAX) break;
      spawnCount++;
      var n = spawnCount;
      var spread = opts.spread == null ? 1 : opts.spread;
      var p = {
        kind: kind,
        x: x + varied(n, 1) * 0.4 * spread,
        y: y + (opts.up || 0) + varied(n, 2) * 0.2,
        z: z + varied(n, 3) * 0.4 * spread,
        vx: varied(n, 4) * (opts.vx || 1.6) * spread + (opts.dirX || 0),
        vy: def.vy * (0.7 + varied(n, 5) * 0.3 + 0.3) + (opts.vy || 0),
        vz: varied(n, 6) * (opts.vz || 1.6) * spread + (opts.dirZ || 0),
        size: def.size * (opts.size || 1) * (0.8 + varied(n, 7) * 0.2 + 0.2),
        life: def.life * (opts.life || 1),
        maxLife: def.life * (opts.life || 1),
        r: def.r, g: def.g, b: def.b, a: def.a,
        grow: def.grow,
        grav: def.grav,
        wind: def.wind
      };
      list.push(p);
      if (!made) made = p;
    }
    return made;
  }

  function burst(kind, x, y, z, count, opts) {
    var o = opts || {};
    o.count = count;
    return spawn(kind, x, y, z, o);
  }

  function smoke(x, y, z, count) { return spawn('smoke', x, y, z, { count: count || 3 }); }
  function sparks(x, y, z, count) { return spawn('sparks', x, y, z, { count: count || 10, spread: 1.4 }); }
  function flash(x, y, z) { return spawn('flash', x, y, z, { count: 1 }); }
  function splash(x, y, z, count) { return spawn('splash', x, y, z, { count: count || 4 }); }
  function dust(x, y, z, count) { return spawn('dust', x, y, z, { count: count || 2 }); }
  function rainStreak(x, y, z) { return spawn('rain', x, y, z, { count: 1 }); }

  // One call for a hard impact: sparks first, smoke lingering after.
  function emitCrash(x, y, z, strength) {
    var s = strength == null ? 0.6 : strength;
    sparks(x, y + 0.5, z, Math.floor(6 + s * 10));
    smoke(x, y + 0.8, z, Math.floor(2 + s * 5));
  }

  // Rain over an area: streaks falling plus splashes where they land.
  function rainField(cx, cz, radius, count) {
    var n = count || 12;
    for (var i = 0; i < n; i++) {
      spawnCount++;
      var rx = cx + varied(spawnCount, 11) * radius;
      var rz = cz + varied(spawnCount, 12) * radius;
      rainStreak(rx, 12 + varied(spawnCount, 13) * 4, rz);
      if (i % 3 === 0) splash(rx, 0.1, rz, 1);
    }
  }

  function setWind(x, z) {
    windX = x || 0;
    windZ = z || 0;
  }

  function update(dt) {
    if (dt <= 0) return;
    if (dt > 0.1) dt = 0.1;
    for (var i = list.length - 1; i >= 0; i--) {
      var p = list[i];
      p.life -= dt;
      if (p.life <= 0) { list.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      p.x += (p.vx + windX * p.wind) * dt;
      p.y += p.vy * dt;
      p.z += (p.vz + windZ * p.wind) * dt;
      if (p.y < 0.05) { p.y = 0.05; p.vy = 0; }
      if (p.grow) p.size += p.grow * dt;
      var t = p.life / p.maxLife;
      if (p.kind === 'smoke' || p.kind === 'dust') p.a = (1 - t) * 0.55;
      else if (p.kind === 'flash') p.a = t * t;
      else p.a = t;
    }
  }

  // Draw hook: the render module passes a quad drawer, or CA.gl's
  // billboard helper when it exists. With no drawer, update still runs
  // and the list stays readable for tests and for the minimap.
  function draw(drawQuad) {
    var fn = drawQuad || (CA.gl && CA.gl.drawBillboard) || null;
    if (!fn) return 0;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      fn(p.x, p.y, p.z, p.size, p.r, p.g, p.b, p.a);
    }
    return list.length;
  }

  function clear() { list.length = 0; }
  function count() { return list.length; }

  CA.particles = {
    list: list,
    kinds: KINDS,
    spawn: spawn,
    burst: burst,
    smoke: smoke,
    sparks: sparks,
    flash: flash,
    splash: splash,
    dust: dust,
    rainStreak: rainStreak,
    emitCrash: emitCrash,
    rainField: rainField,
    setWind: setWind,
    getWind: function () { return { x: windX, z: windZ }; },
    countKind: countKind,
    update: update,
    draw: draw,
    clear: clear,
    count: count
  };
})();
