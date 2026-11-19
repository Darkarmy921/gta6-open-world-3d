// Cayo Azul — math3d.js
// Vectors and 4x4 matrices written by hand. Vectors are plain
// [x, y, z] arrays; matrices are Float32Array(16) in column-major
// order, the layout WebGL expects. x is east, z is north, y is up.
// Facing convention: yaw 0 points toward +z (north); yaw grows
// toward +x (east). mat4Multiply(a, b) returns a * b, so b is
// applied to a point first, then a.

(function () {
  'use strict';

  window.CA = window.CA || {};
  var CA = window.CA;

  // ---- vec3 -------------------------------------------------------

  function v3(x, y, z) {
    return [x || 0, y || 0, z || 0];
  }

  function v3Add(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  }

  function v3Sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }

  function v3Negate(a) {
    return [-a[0], -a[1], -a[2]];
  }

  function v3Scale(a, s) {
    return [a[0] * s, a[1] * s, a[2] * s];
  }

  function v3Dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  function v3Cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  function v3LengthSq(a) {
    return a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
  }

  function v3Length(a) {
    return Math.sqrt(v3LengthSq(a));
  }

  function v3Normalize(a) {
    var len = v3Length(a);
    if (len === 0) { return [0, 0, 0]; }
    return [a[0] / len, a[1] / len, a[2] / len];
  }

  function v3Lerp(a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    ];
  }

  function v3Distance(a, b) {
    return v3Length(v3Sub(a, b));
  }

  // Reflect direction d about a unit normal n.
  function v3Reflect(d, n) {
    var s = 2 * v3Dot(d, n);
    return [d[0] - s * n[0], d[1] - s * n[1], d[2] - s * n[2]];
  }

  // ---- mat4 -------------------------------------------------------
  // Column-major: element (row r, column c) lives at index c*4 + r.

  function mat4Identity() {
    var m = new Float32Array(16);
    m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
    return m;
  }

  function mat4Multiply(a, b) {
    // Returns a * b: b is applied first, then a.
    var out = new Float32Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        var sum = 0;
        for (var k = 0; k < 4; k++) {
          sum += a[k * 4 + r] * b[c * 4 + k];
        }
        out[c * 4 + r] = sum;
      }
    }
    return out;
  }

  function mat4Transpose(m) {
    var out = new Float32Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        out[c * 4 + r] = m[r * 4 + c];
      }
    }
    return out;
  }

  function mat4Translate(x, y, z) {
    var m = mat4Identity();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
  }

  function mat4Scale(x, y, z) {
    var m = mat4Identity();
    m[0] = x; m[5] = y; m[10] = z;
    return m;
  }

  function mat4RotateX(angle) {
    var c = Math.cos(angle);
    var s = Math.sin(angle);
    var m = mat4Identity();
    m[5] = c; m[6] = s;
    m[9] = -s; m[10] = c;
    return m;
  }

  function mat4RotateY(angle) {
    var c = Math.cos(angle);
    var s = Math.sin(angle);
    var m = mat4Identity();
    m[0] = c; m[2] = -s;
    m[8] = s; m[10] = c;
    return m;
  }

  function mat4RotateZ(angle) {
    var c = Math.cos(angle);
    var s = Math.sin(angle);
    var m = mat4Identity();
    m[0] = c; m[1] = s;
    m[4] = -s; m[5] = c;
    return m;
  }

  // Rotation around the up axis (Y). Yaw 0 leaves +z unchanged.
  function mat4FromYaw(yaw) {
    return mat4RotateY(yaw);
  }

  // Model matrix for an object at (x, y, z) facing angle yaw, with
  // an optional uniform scale. Facing 0 points toward +z (north).
  function mat4Compose(x, y, z, yaw, scale) {
    var s = scale === undefined ? 1 : scale;
    var t = mat4Translate(x, y, z);
    var r = mat4RotateY(yaw);
    var sc = mat4Scale(s, s, s);
    return mat4Multiply(t, mat4Multiply(r, sc));
  }

  function mat4Perspective(fovY, aspect, near, far) {
    var f = 1 / Math.tan(fovY / 2);
    var m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) / (near - far);
    m[11] = -1;
    m[14] = (2 * far * near) / (near - far);
    return m;
  }

  // Orthographic projection, for HUD-style or minimap draws.
  function mat4Ortho(left, right, bottom, top, near, far) {
    var m = new Float32Array(16);
    m[0] = 2 / (right - left);
    m[5] = 2 / (top - bottom);
    m[10] = -2 / (far - near);
    m[12] = -(right + left) / (right - left);
    m[13] = -(top + bottom) / (top - bottom);
    m[14] = -(far + near) / (far - near);
    m[15] = 1;
    return m;
  }

  function mat4LookAt(eye, target, up) {
    var zAxis = v3Normalize(v3Sub(eye, target));
    var xAxis = v3Normalize(v3Cross(up, zAxis));
    // If eye and target are vertically aligned the cross product
    // collapses; fall back to a +x right vector.
    if (v3LengthSq(xAxis) === 0) { xAxis = [1, 0, 0]; }
    var yAxis = v3Cross(zAxis, xAxis);
    var m = new Float32Array(16);
    m[0] = xAxis[0]; m[1] = yAxis[0]; m[2] = zAxis[0]; m[3] = 0;
    m[4] = xAxis[1]; m[5] = yAxis[1]; m[6] = zAxis[1]; m[7] = 0;
    m[8] = xAxis[2]; m[9] = yAxis[2]; m[10] = zAxis[2]; m[11] = 0;
    m[12] = -v3Dot(xAxis, eye);
    m[13] = -v3Dot(yAxis, eye);
    m[14] = -v3Dot(zAxis, eye);
    m[15] = 1;
    return m;
  }

  // Transform a point by a matrix (assumes w = 1).
  function mat4TransformPoint(m, p) {
    var x = p[0], y = p[1], z = p[2];
    var w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w === 0) { w = 1; }
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) / w
    ];
  }

  // Transform a direction by a matrix (translation ignored).
  function mat4TransformDir(m, d) {
    return [
      m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
      m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
      m[2] * d[0] + m[6] * d[1] + m[10] * d[2]
    ];
  }

  CA.math3d = {
    v3: v3,
    v3Add: v3Add,
    v3Sub: v3Sub,
    v3Negate: v3Negate,
    v3Scale: v3Scale,
    v3Dot: v3Dot,
    v3Cross: v3Cross,
    v3Length: v3Length,
    v3LengthSq: v3LengthSq,
    v3Normalize: v3Normalize,
    v3Lerp: v3Lerp,
    v3Distance: v3Distance,
    v3Reflect: v3Reflect,
    mat4Identity: mat4Identity,
    mat4Multiply: mat4Multiply,
    mat4Transpose: mat4Transpose,
    mat4Translate: mat4Translate,
    mat4Scale: mat4Scale,
    mat4RotateX: mat4RotateX,
    mat4RotateY: mat4RotateY,
    mat4RotateZ: mat4RotateZ,
    mat4FromYaw: mat4FromYaw,
    mat4Compose: mat4Compose,
    mat4Perspective: mat4Perspective,
    mat4Ortho: mat4Ortho,
    mat4LookAt: mat4LookAt,
    mat4TransformPoint: mat4TransformPoint,
    mat4TransformDir: mat4TransformDir
  };
})();
