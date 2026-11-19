// Cayo Azul — mesh.js
// Procedural mesh builders. Every builder returns plain data:
// {positions, normals, colors, indices} — flat number arrays, no
// WebGL objects. The renderer (CA.gl) turns data into buffers.
// Colours are [r, g, b] triples in 0..1. All faces are wound
// counter-clockwise seen from outside, for back-face culling.
// The spec's fake shadows are flat dark discs (see disc()), never
// real shadow maps.

(function () {
  'use strict';

  window.CA = window.CA || {};
  var CA = window.CA;

  function empty() {
    return { positions: [], normals: [], colors: [], indices: [] };
  }

  function hexToRgb(hex) {
    // '#rrggbb' or 'rrggbb' -> [r, g, b] in 0..1.
    var h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    var n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function colorOf(c) {
    if (typeof c === 'string') { return hexToRgb(c); }
    return c;
  }

  // A colour darkened toward black by factor f (0 keeps it, 1 is
  // black). Used for shaded faces and shadow discs.
  function shade(color, f) {
    var c = colorOf(color);
    return [c[0] * (1 - f), c[1] * (1 - f), c[2] * (1 - f)];
  }

  // Push one quad (two triangles) into mesh m. a, b, c, d are
  // [x, y, z] corners in CCW order seen from outside; n is the
  // outward normal; col is the [r, g, b] colour for all four verts.
  function quad(m, a, b, c, d, n, col) {
    var base = m.positions.length / 3;
    var pts = [a, b, c, d];
    for (var i = 0; i < 4; i++) {
      m.positions.push(pts[i][0], pts[i][1], pts[i][2]);
      m.normals.push(n[0], n[1], n[2]);
      m.colors.push(col[0], col[1], col[2]);
    }
    m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  function tri(m, a, b, c, n, col) {
    var base = m.positions.length / 3;
    var pts = [a, b, c];
    for (var i = 0; i < 3; i++) {
      m.positions.push(pts[i][0], pts[i][1], pts[i][2]);
      m.normals.push(n[0], n[1], n[2]);
      m.colors.push(col[0], col[1], col[2]);
    }
    m.indices.push(base, base + 1, base + 2);
  }

  // Append a box centred at (cx, cy, cz). faceColors may give a
  // colour per face in order [top, bottom, front, back, right, left];
  // otherwise the single colour is used everywhere.
  function addBox(m, cx, cy, cz, w, h, d, color, faceColors) {
    var col = colorOf(color);
    var hx = w / 2, hy = h / 2, hz = d / 2;
    function faceColor(i) {
      return faceColors && faceColors[i] ? colorOf(faceColors[i]) : col;
    }
    var x0 = cx - hx, x1 = cx + hx;
    var y0 = cy - hy, y1 = cy + hy;
    var z0 = cz - hz, z1 = cz + hz;
    // Front +z
    quad(m, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
      [0, 0, 1], faceColor(2));
    // Back -z
    quad(m, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0],
      [0, 0, -1], faceColor(3));
    // Right +x
    quad(m, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1],
      [1, 0, 0], faceColor(4));
    // Left -x
    quad(m, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0],
      [-1, 0, 0], faceColor(5));
    // Top +y
    quad(m, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0],
      [0, 1, 0], faceColor(0));
    // Bottom -y
    quad(m, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
      [0, -1, 0], faceColor(1));
  }

  function box(w, h, d, color, faceColors) {
    var m = empty();
    addBox(m, 0, 0, 0, w, h, d, color, faceColors);
    return m;
  }

  // Flat ground plane centred at the origin, y = 0, facing up.
  // segments splits it into a grid (useful for gentle height
  // variation by later modules); 1 gives a single quad.
  function groundPlane(sizeX, sizeZ, color, segments) {
    var m = empty();
    var col = colorOf(color);
    var seg = Math.max(1, segments || 1);
    var dx = sizeX / seg;
    var dz = sizeZ / seg;
    for (var i = 0; i < seg; i++) {
      for (var j = 0; j < seg; j++) {
        var x0 = -sizeX / 2 + i * dx;
        var x1 = x0 + dx;
        var z0 = -sizeZ / 2 + j * dz;
        var z1 = z0 + dz;
        quad(m, [x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0],
          [0, 1, 0], col);
      }
    }
    return m;
  }

  // A road quad: a flat coloured rectangle at height y, centred at
  // (cx, cz), width w along x and depth d along z.
  function roadQuad(cx, cz, w, d, color, y) {
    var m = empty();
    var col = colorOf(color);
    var yy = y === undefined ? 0.05 : y;
    var hx = w / 2, hz = d / 2;
    quad(m, [cx - hx, yy, cz + hz], [cx + hx, yy, cz + hz],
      [cx + hx, yy, cz - hz], [cx - hx, yy, cz - hz],
      [0, 1, 0], col);
    return m;
  }

  // Flat disc facing up, centred at (cx, y, cz). The fake shadow
  // under cars and people: draw one in near-black just above the
  // ground, slightly smaller than the thing casting it.
  function disc(cx, y, cz, radius, color, segments) {
    var m = empty();
    var col = colorOf(color || [0, 0, 0]);
    var seg = Math.max(6, segments || 16);
    var centre = m.positions.length / 3;
    m.positions.push(cx, y, cz);
    m.normals.push(0, 1, 0);
    m.colors.push(col[0], col[1], col[2]);
    var ring = [];
    for (var i = 0; i <= seg; i++) {
      var a = (i / seg) * Math.PI * 2;
      ring.push([cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius]);
    }
    for (var k = 0; k < seg; k++) {
      var base = m.positions.length / 3;
      var p0 = ring[k], p1 = ring[k + 1];
      m.positions.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]);
      m.normals.push(0, 1, 0, 0, 1, 0);
      m.colors.push(col[0], col[1], col[2], col[0], col[1], col[2]);
      // Wound (centre, next, current) so the face points +y.
      m.indices.push(centre, base + 1, base);
    }
    return m;
  }

  // Cylinder centred at (cx, cy, cz), axis along Y, from y - h/2
  // to y + h/2. segments is the side count (8 is chunky, 12 smooth).
  // Side quads and both cap fans are wound outward.
  function addCylinder(m, cx, cy, cz, rTop, rBottom, h, segments, color) {
    var col = colorOf(color);
    var seg = Math.max(3, segments || 8);
    var y0 = cy - h / 2, y1 = cy + h / 2;
    var ringTop = [];
    var ringBottom = [];
    for (var i = 0; i <= seg; i++) {
      var a = (i / seg) * Math.PI * 2;
      var ca = Math.cos(a), sa = Math.sin(a);
      ringTop.push([cx + ca * rTop, y1, cz + sa * rTop]);
      ringBottom.push([cx + ca * rBottom, y0, cz + sa * rBottom]);
    }
    for (var j = 0; j < seg; j++) {
      var n = [Math.cos((j + 0.5) / seg * Math.PI * 2), 0,
        Math.sin((j + 0.5) / seg * Math.PI * 2)];
      quad(m, ringBottom[j + 1], ringBottom[j], ringTop[j], ringTop[j + 1], n, col);
    }
    // Top cap fan: (centre, next, current) faces +y.
    var topBase = m.positions.length / 3;
    m.positions.push(cx, y1, cz);
    m.normals.push(0, 1, 0);
    m.colors.push(col[0], col[1], col[2]);
    for (var k = 0; k < seg; k++) {
      var base = m.positions.length / 3;
      var p0 = ringTop[k], p1 = ringTop[k + 1];
      m.positions.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]);
      m.normals.push(0, 1, 0, 0, 1, 0);
      m.colors.push(col[0], col[1], col[2], col[0], col[1], col[2]);
      m.indices.push(topBase, base + 1, base);
    }
    // Bottom cap fan: (centre, current, next) faces -y.
    var botBase = m.positions.length / 3;
    m.positions.push(cx, y0, cz);
    m.normals.push(0, -1, 0);
    m.colors.push(col[0], col[1], col[2]);
    for (var l = 0; l < seg; l++) {
      var b2 = m.positions.length / 3;
      var q0 = ringBottom[l], q1 = ringBottom[l + 1];
      m.positions.push(q0[0], q0[1], q0[2], q1[0], q1[1], q1[2]);
      m.normals.push(0, -1, 0, 0, -1, 0);
      m.colors.push(col[0], col[1], col[2], col[0], col[1], col[2]);
      m.indices.push(botBase, b2, b2 + 1);
    }
  }

  function cylinder(rTop, rBottom, h, segments, color) {
    var m = empty();
    addCylinder(m, 0, 0, 0, rTop, rBottom, h, segments, color);
    return m;
  }

  // Cone: a cylinder with a near-zero top radius, plus a bottom cap.
  function cone(r, h, segments, color) {
    var m = empty();
    addCylinder(m, 0, 0, 0, 0.001, r, h, segments, color);
    return m;
  }

  // Triangular prism (a roof): cross-section is a triangle in the
  // x-y plane (base width w, peak height h), extruded depth d
  // along z, centred at the origin.
  function prism(w, h, d, color) {
    var m = empty();
    var col = colorOf(color);
    var hx = w / 2, hz = d / 2;
    var apex = [0, h / 2, 0];
    var bl = [-hx, -h / 2, 0], br = [hx, -h / 2, 0];
    // Two triangular ends (z = +hz faces +z, z = -hz faces -z).
    function endTri(z, flip) {
      var a = [bl[0], bl[1], z], b = [br[0], br[1], z], c = [apex[0], apex[1], z];
      var n = flip ? [0, 0, -1] : [0, 0, 1];
      if (flip) { tri(m, b, a, c, n, col); }
      else { tri(m, a, b, c, n, col); }
    }
    endTri(hz, false);
    endTri(-hz, true);
    // Bottom face.
    quad(m, [-hx, -h / 2, -hz], [hx, -h / 2, -hz], [hx, -h / 2, hz],
      [-hx, -h / 2, hz], [0, -1, 0], col);
    // Left slope (from base-left up to apex).
    var slopeLen = Math.sqrt(hx * hx + h * h);
    var nl = [-h / slopeLen, hx / slopeLen, 0];
    quad(m, [-hx, -h / 2, hz], [0, h / 2, hz], [0, h / 2, -hz],
      [-hx, -h / 2, -hz], nl, col);
    // Right slope.
    var nr = [h / slopeLen, hx / slopeLen, 0];
    quad(m, [hx, -h / 2, -hz], [0, h / 2, -hz], [0, h / 2, hz],
      [hx, -h / 2, hz], nr, col);
    return m;
  }

  // Rotate a mesh's vertices around the Y axis by angle radians,
  // in place. Used to re-orient parts built axis-aligned.
  function rotateYInPlace(m, angle) {
    var c = Math.cos(angle), s = Math.sin(angle);
    for (var i = 0; i < m.positions.length; i += 3) {
      var x = m.positions[i], z = m.positions[i + 2];
      m.positions[i] = x * c + z * s;
      m.positions[i + 2] = -x * s + z * c;
      var nx = m.normals[i], nz = m.normals[i + 2];
      m.normals[i] = nx * c + nz * s;
      m.normals[i + 2] = -nx * s + nz * c;
    }
  }

  function rotateZInPlace(m, angle) {
    var c = Math.cos(angle), s = Math.sin(angle);
    for (var i = 0; i < m.positions.length; i += 3) {
      var x = m.positions[i], y = m.positions[i + 1];
      m.positions[i] = x * c - y * s;
      m.positions[i + 1] = x * s + y * c;
      var nx = m.normals[i], ny = m.normals[i + 1];
      m.normals[i] = nx * c - ny * s;
      m.normals[i + 1] = nx * s + ny * c;
    }
  }

  function translateInPlace(m, dx, dy, dz) {
    for (var i = 0; i < m.positions.length; i += 3) {
      m.positions[i] += dx;
      m.positions[i + 1] += dy;
      m.positions[i + 2] += dz;
    }
  }

  // Scale a mesh in place about the origin. Normals are left as
  // they were: callers should use uniform scale for lit geometry.
  function scaleInPlace(m, sx, sy, sz) {
    for (var i = 0; i < m.positions.length; i += 3) {
      m.positions[i] *= sx;
      m.positions[i + 1] *= sy;
      m.positions[i + 2] *= sz;
    }
  }

  // Append source mesh into target, with an offset and an optional
  // Y rotation applied to the copy.
  function appendMesh(target, source, dx, dy, dz, rotY) {
    var base = target.positions.length / 3;
    var c = Math.cos(rotY || 0), s = Math.sin(rotY || 0);
    for (var i = 0; i < source.positions.length; i += 3) {
      var x = source.positions[i], y = source.positions[i + 1];
      var z = source.positions[i + 2];
      var nx = source.normals[i], ny = source.normals[i + 1];
      var nz = source.normals[i + 2];
      target.positions.push(x * c + z * s + (dx || 0), y + (dy || 0),
        -x * s + z * c + (dz || 0));
      target.normals.push(nx * c + nz * s, ny, -nx * s + nz * c);
      target.colors.push(source.colors[i], source.colors[i + 1],
        source.colors[i + 2]);
    }
    for (var j = 0; j < source.indices.length; j++) {
      target.indices.push(source.indices[j] + base);
    }
  }

  // Car assembly, facing +z (north). Origin at ground centre.
  // bodyColor is the paint; glassColor tints the cabin.
  // opts.roofLight adds a light bar (police cruiser).
  function car(bodyColor, glassColor, opts) {
    var m = empty();
    var o = opts || {};
    var paint = colorOf(bodyColor);
    var glass = colorOf(glassColor || '#1a2a3a');
    var dark = [0.08, 0.08, 0.09];
    // Body: 1.9 wide, 0.55 tall, 4.2 long, sitting on the wheels.
    addBox(m, 0, 0.55, 0, 1.9, 0.55, 4.2, paint);
    // Cabin: 1.6 wide, 0.5 tall, 2.0 long, set back slightly.
    addBox(m, 0, 1.05, -0.2, 1.6, 0.5, 2.0, glass);
    // Wheels: cylinders with axis along X (rotate a Y-cylinder
    // by 90 degrees around Z), four corners.
    var wheelPos = [
      [-0.85, 0.32, 1.35], [0.85, 0.32, 1.35],
      [-0.85, 0.32, -1.35], [0.85, 0.32, -1.35]
    ];
    for (var i = 0; i < 4; i++) {
      var wheel = cylinder(0.32, 0.32, 0.24, 10, dark);
      rotateZInPlace(wheel, Math.PI / 2);
      appendMesh(m, wheel, wheelPos[i][0], wheelPos[i][1], wheelPos[i][2], 0);
    }
    // Headlights: two bright quads on the front face.
    var lamp = [1.0, 0.95, 0.7];
    quad(m, [-0.65, 0.62, 2.11], [-0.25, 0.62, 2.11],
      [-0.25, 0.78, 2.11], [-0.65, 0.78, 2.11], [0, 0, 1], lamp);
    quad(m, [0.25, 0.62, 2.11], [0.65, 0.62, 2.11],
      [0.65, 0.78, 2.11], [0.25, 0.78, 2.11], [0, 0, 1], lamp);
    // Taillights.
    var tail = [0.9, 0.1, 0.1];
    quad(m, [0.65, 0.62, -2.11], [0.25, 0.62, -2.11],
      [0.25, 0.78, -2.11], [0.65, 0.78, -2.11], [0, 0, -1], tail);
    quad(m, [-0.25, 0.62, -2.11], [-0.65, 0.62, -2.11],
      [-0.65, 0.78, -2.11], [-0.25, 0.78, -2.11], [0, 0, -1], tail);
    if (o.roofLight) {
      addBox(m, 0, 1.38, -0.2, 0.9, 0.12, 0.5, o.roofLight);
    }
    return m;
  }

  // Person assembly, facing +z. Origin at the feet.
  function person(shirtColor, skinColor, pantsColor) {
    var m = empty();
    var shirt = colorOf(shirtColor || '#c0392b');
    var skin = colorOf(skinColor || '#d9a066');
    var pants = colorOf(pantsColor || '#2c3e50');
    // Legs.
    addBox(m, -0.14, 0.4, 0, 0.24, 0.8, 0.28, pants);
    addBox(m, 0.14, 0.4, 0, 0.24, 0.8, 0.28, pants);
    // Torso.
    addBox(m, 0, 1.1, 0, 0.62, 0.6, 0.34, shirt);
    // Arms.
    addBox(m, -0.4, 1.1, 0, 0.18, 0.6, 0.22, shirt);
    addBox(m, 0.4, 1.1, 0, 0.18, 0.6, 0.22, shirt);
    // Head.
    addBox(m, 0, 1.62, 0, 0.34, 0.34, 0.32, skin);
    return m;
  }

  // Tree: trunk cylinder plus two stacked foliage cones.
  function tree(trunkColor, leafColor) {
    var m = empty();
    var trunk = colorOf(trunkColor || '#6b4a2f');
    var leaf = colorOf(leafColor || '#2e8b57');
    addCylinder(m, 0, 0.9, 0, 0.18, 0.26, 1.8, 7, trunk);
    var c1 = cone(1.15, 1.8, 8, leaf);
    appendMesh(m, c1, 0, 2.5, 0, 0);
    var c2 = cone(0.8, 1.4, 8, leaf);
    appendMesh(m, c2, 0, 3.5, 0, 0);
    return m;
  }

  // Streetlight: pole, horizontal arm, lamp box. Faces +z.
  function streetlight(poleColor, lampColor) {
    var m = empty();
    var pole = colorOf(poleColor || '#3a3f44');
    var lamp = colorOf(lampColor || '#fff2b0');
    addCylinder(m, 0, 2.6, 0, 0.09, 0.11, 5.2, 7, pole);
    addBox(m, 0, 5.15, 0.7, 0.12, 0.12, 1.5, pole);
    addBox(m, 0, 5.05, 1.35, 0.5, 0.14, 0.3, lamp);
    return m;
  }

  // Building: box plus window quads on the four side faces.
  // windows: {color, litColor, litFraction, rng} — lit windows use
  // litColor; rng, when given, decides which windows are lit.
  // Without rng the lit pattern is a fixed deterministic grid.
  function building(w, h, d, color, windows) {
    var m = empty();
    var col = colorOf(color);
    addBox(m, 0, h / 2, 0, w, h, d, col);
    var win = windows || {};
    var winColor = colorOf(win.color || '#202830');
    var litColor = colorOf(win.litColor || '#ffd76a');
    var litFrac = win.litFraction === undefined ? 0.25 : win.litFraction;
    var rng = win.rng;
    var cols = Math.max(1, Math.floor(w / 3));
    var floors = Math.max(1, Math.floor(h / 3.2));
    var marginX = 0.8, marginY = 0.9;
    var ww = 1.4, wh = 1.6;
    var stepX = cols > 1 ? (w - 2 * marginX - ww) / (cols - 1) : 0;
    var stepY = floors > 1 ? (h - 2 * marginY - wh) / (floors - 1) : 0;
    var eps = 0.06;
    for (var f = 0; f < floors; f++) {
      for (var c = 0; c < cols; c++) {
        var cx = -w / 2 + marginX + ww / 2 + c * stepX;
        var cy = marginY + wh / 2 + f * stepY;
        var lit = rng ? rng() < litFrac : (litFrac > 0 && ((f * cols + c) % 4 === 0));
        var wc = lit ? litColor : winColor;
        // Front +z.
        quad(m, [cx - ww / 2, cy - wh / 2, d / 2 + eps],
          [cx + ww / 2, cy - wh / 2, d / 2 + eps],
          [cx + ww / 2, cy + wh / 2, d / 2 + eps],
          [cx - ww / 2, cy + wh / 2, d / 2 + eps], [0, 0, 1], wc);
        // Back -z.
        quad(m, [cx + ww / 2, cy - wh / 2, -d / 2 - eps],
          [cx - ww / 2, cy - wh / 2, -d / 2 - eps],
          [cx - ww / 2, cy + wh / 2, -d / 2 - eps],
          [cx + ww / 2, cy + wh / 2, -d / 2 - eps], [0, 0, -1], wc);
      }
    }
    var sideCols = Math.max(1, Math.floor(d / 3));
    var stepZ = sideCols > 1 ? (d - 2 * marginX - ww) / (sideCols - 1) : 0;
    for (var f2 = 0; f2 < floors; f2++) {
      for (var c2 = 0; c2 < sideCols; c2++) {
        var cz = -d / 2 + marginX + ww / 2 + c2 * stepZ;
        var cy2 = marginY + wh / 2 + f2 * stepY;
        var lit2 = rng ? rng() < litFrac : (litFrac > 0 && ((f2 * sideCols + c2) % 4 === 1));
        var wc2 = lit2 ? litColor : winColor;
        // Right +x.
        quad(m, [w / 2 + eps, cy2 - wh / 2, cz + ww / 2],
          [w / 2 + eps, cy2 - wh / 2, cz - ww / 2],
          [w / 2 + eps, cy2 + wh / 2, cz - ww / 2],
          [w / 2 + eps, cy2 + wh / 2, cz + ww / 2], [1, 0, 0], wc2);
        // Left -x.
        quad(m, [-w / 2 - eps, cy2 - wh / 2, cz - ww / 2],
          [-w / 2 - eps, cy2 - wh / 2, cz + ww / 2],
          [-w / 2 - eps, cy2 + wh / 2, cz + ww / 2],
          [-w / 2 - eps, cy2 + wh / 2, cz - ww / 2], [-1, 0, 0], wc2);
      }
    }
    return m;
  }

  // Merge a list of meshes into one big mesh. Indices are offset
  // per mesh so the merged data draws as one call. Callers must
  // keep the merged vertex count under 65536 (Uint16 indices).
  function mergeMeshes(list) {
    var out = empty();
    for (var i = 0; i < list.length; i++) {
      appendMesh(out, list[i], 0, 0, 0, 0);
    }
    return out;
  }

  // Translate a mesh in place and return it (chainable).
  function translate(mesh, dx, dy, dz) {
    translateInPlace(mesh, dx, dy, dz);
    return mesh;
  }

  function rotateY(mesh, angle) {
    rotateYInPlace(mesh, angle);
    return mesh;
  }

  function scale(mesh, sx, sy, sz) {
    scaleInPlace(mesh, sx, sy, sz === undefined ? sx : sz);
    return mesh;
  }

  CA.mesh = {
    empty: empty,
    hexToRgb: hexToRgb,
    colorOf: colorOf,
    shade: shade,
    quad: quad,
    tri: tri,
    addBox: addBox,
    box: box,
    groundPlane: groundPlane,
    roadQuad: roadQuad,
    disc: disc,
    addCylinder: addCylinder,
    cylinder: cylinder,
    cone: cone,
    prism: prism,
    car: car,
    person: person,
    tree: tree,
    streetlight: streetlight,
    building: building,
    mergeMeshes: mergeMeshes,
    appendMesh: appendMesh,
    translate: translate,
    rotateY: rotateY,
    scale: scale
  };
})();
