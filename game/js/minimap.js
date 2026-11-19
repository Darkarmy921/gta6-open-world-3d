// minimap.js — Cayo Azul minimap.
// A small 2D canvas at the bottom right of the screen. It draws the
// roads, the player arrow, the mission marker, police dots, garage
// icons and the north direction. Road and garage geometry come from
// CA.city when it is loaded; until then a fixed ring-and-grid sketch
// stands in so the minimap never draws blank.
// The canvas element is found by id 'minimap'; main.js may also hand
// one in with setCanvas(). All drawing is plain 2D canvas.
// Revision notes: a mission marker outside the drawn area is now
// clamped to the map edge with an arrow so the player always sees
// which way to drive; the current district name is printed under
// the map; setWorldSize() lets the city module correct the world
// bounds if they ever differ from the spec's 3600 by 3000.
(function () {
  'use strict';
  var CA = window.CA || (window.CA = {});

  var WORLD_W = 3600;
  var WORLD_H = 3000;
  var canvas = null;
  var ctx = null;

  function setCanvas(el) {
    canvas = el || null;
    ctx = canvas ? canvas.getContext('2d') : null;
  }

  function setWorldSize(w, h) {
    if (typeof w === 'number' && w > 0) WORLD_W = w;
    if (typeof h === 'number' && h > 0) WORLD_H = h;
  }

  function findCanvas() {
    if (!canvas && typeof document !== 'undefined') {
      var el = document.getElementById('minimap');
      if (el) setCanvas(el);
    }
    return canvas;
  }

  function toMap(x, z, size) {
    return [
      (x / WORLD_W + 0.5) * size,
      (z / WORLD_H + 0.5) * size
    ];
  }

  function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  function drawFallbackRoads(size) {
    ctx.strokeStyle = '#8a8f96';
    ctx.lineWidth = 2;
    // Ring road.
    ctx.strokeRect(size * 0.08, size * 0.08, size * 0.84, size * 0.84);
    // Centre grid.
    ctx.beginPath();
    for (var i = 1; i < 5; i++) {
      var p = size * (0.15 + i * 0.14);
      ctx.moveTo(p, size * 0.15);
      ctx.lineTo(p, size * 0.85);
      ctx.moveTo(size * 0.15, p);
      ctx.lineTo(size * 0.85, p);
    }
    ctx.stroke();
    // Coastal avenue along the south shore.
    ctx.beginPath();
    ctx.moveTo(size * 0.08, size * 0.88);
    ctx.lineTo(size * 0.92, size * 0.88);
    ctx.stroke();
  }

  function drawRoads(size) {
    if (CA.city && CA.city.roads && CA.city.roads.length) {
      ctx.strokeStyle = '#8a8f96';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (var i = 0; i < CA.city.roads.length; i++) {
        var r = CA.city.roads[i];
        /* City roads carry ax/az/bx/bz, not x1/z1/x2/z2. */
        var a = toMap(r.ax, r.az, size);
        var b = toMap(r.bx, r.bz, size);
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();
    } else {
      drawFallbackRoads(size);
    }
  }

  function drawDot(x, z, size, r, colour) {
    var p = toMap(x, z, size);
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPlayerArrow(size) {
    var st = CA.state || {};
    var p = st.player || { x: 0, z: 0, facing: 0 };
    var pos = toMap(p.x || 0, p.z || 0, size);
    var a = p.facing || 0;
    ctx.save();
    ctx.translate(clamp(pos[0], 6, size - 6), clamp(pos[1], 6, size - 6));
    ctx.rotate(-a);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Mission marker: a gold diamond on the map, or clamped to the
  // edge with a small arrow when the target is off the drawn area.
  function drawMissionMarker(size) {
    var st = CA.state || {};
    var m = null;
    /* (G integration: missions.current() carries no x/z. The
       target comes from currentTarget(), or from the current
       objective's target point.) */
    if (CA.missions && typeof CA.missions.currentTarget === 'function') {
      try { m = CA.missions.currentTarget(); } catch (e) { m = null; }
    }
    if (!m && CA.missions && typeof CA.missions.currentObjective === 'function') {
      try {
        var obj = CA.missions.currentObjective();
        if (obj && obj.target) m = obj.target;
      } catch (e) { m = null; }
    }
    if (!m && st.activeMission && typeof st.activeMission.x === 'number') m = st.activeMission;
    if (!m || typeof m.x !== 'number' || typeof m.z !== 'number') return;
    var raw = toMap(m.x, m.z, size);
    var edge = raw[0] < 8 || raw[0] > size - 8 || raw[1] < 8 || raw[1] > size - 8;
    var mx = clamp(raw[0], 8, size - 8);
    var my = clamp(raw[1], 8, size - 8);
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.moveTo(mx, my - 6);
    ctx.lineTo(mx + 5, my);
    ctx.lineTo(mx, my + 6);
    ctx.lineTo(mx - 5, my);
    ctx.closePath();
    ctx.fill();
    if (edge) {
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx, my, 9, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function draw(size) {
    findCanvas();
    if (!ctx || !canvas) return false;
    var w = canvas.width || 180;
    var h = canvas.height || 150;
    size = Math.min(w, h);
    ctx.clearRect(0, 0, w, h);
    // Sea-tinted background with a dark rim.
    ctx.fillStyle = 'rgba(16, 42, 54, 0.85)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    drawRoads(size);
    var st = CA.state || {};
    // Garage icons: small yellow squares.
    var garages = (CA.garages && CA.garages.defs) ? CA.garages.defs() : [];
    for (var i = 0; i < garages.length; i++) {
      var g = garages[i];
      var gp = toMap(g.x, g.z, size);
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(gp[0] - 3, gp[1] - 3, 6, 6);
    }
    // Police dots: red. Foot officers live in CA.state.police.
    var police = (CA.state && CA.state.police) || [];
    for (var j = 0; j < police.length; j++) {
      var u = police[j];
      if (typeof u.x === 'number') drawDot(u.x, u.z, size, 2.5, '#ff4444');
    }
    drawMissionMarker(size);
    drawPlayerArrow(size);
    // North direction: N letter, top centre.
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', w / 2, 12);
    ctx.beginPath();
    ctx.moveTo(w / 2, 15);
    ctx.lineTo(w / 2, 24);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    // Current district, printed under the map when there is room.
    if (h > size + 14) {
      var p = (CA.state && CA.state.player) || {};
      var district = '';
      if (CA.city && CA.city.districtAt) {
        var d = CA.city.districtAt(p.x || 0, p.z || 0);
        if (d) district = (typeof d === 'string') ? d : (d.name || '');
      }
      if (district) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = '10px sans-serif';
        ctx.fillText(district, w / 2, h - 4);
      }
    }
    return true;
  }

  CA.minimap = {
    setCanvas: setCanvas,
    setWorldSize: setWorldSize,
    draw: draw,
    worldWidth: WORLD_W,
    worldHeight: WORLD_H
  };
})();
