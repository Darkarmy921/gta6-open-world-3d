// Cayo Azul — gl.js
// The WebGL1 renderer, written from scratch with plain WebGL calls.
// Two shader programs, both written here as text: solid coloured
// geometry (sun + ambient + fog) and an animated water plane.
// Other modules draw through createMesh / drawMesh / drawWater and
// never touch the raw context. Uniform locations are cached per
// program so a draw call does no string lookup work. If a program
// fails to compile, draw calls using it are refused and the failure
// is logged once at init; the game keeps running without that pass.

(function () {
  'use strict';

  window.CA = window.CA || {};
  var CA = window.CA;

  var canvas = null;
  var gl = null;
  var solidProgram = null;
  var waterProgram = null;
  var solidOK = false;
  var waterOK = false;
  var contextLost = false;
  var skyColor = [0.53, 0.81, 0.98];
  var viewMatrix = null;
  var projMatrix = null;
  var sunDir = [0.5, 0.8, 0.3];
  var sunColor = [1.0, 0.95, 0.85];
  var ambientColor = [0.35, 0.35, 0.4];
  var fogColor = [0.53, 0.81, 0.98];
  var fogNear = 400;
  var fogFar = 1600;
  var uniformCache = {};

  var SOLID_VERT =
    'attribute vec3 aPos;\n' +
    'attribute vec3 aNormal;\n' +
    'attribute vec3 aColor;\n' +
    'uniform mat4 uModel;\n' +
    'uniform mat4 uView;\n' +
    'uniform mat4 uProj;\n' +
    'varying vec3 vNormal;\n' +
    'varying vec3 vColor;\n' +
    'varying float vDist;\n' +
    'void main() {\n' +
    '  vec4 worldPos = uModel * vec4(aPos, 1.0);\n' +
    '  vNormal = mat3(uModel) * aNormal;\n' +
    '  vColor = aColor;\n' +
    '  vec4 viewPos = uView * worldPos;\n' +
    '  vDist = -viewPos.z;\n' +
    '  gl_Position = uProj * viewPos;\n' +
    '}\n';

  var SOLID_FRAG =
    'precision mediump float;\n' +
    'varying vec3 vNormal;\n' +
    'varying vec3 vColor;\n' +
    'varying float vDist;\n' +
    'uniform vec3 uSunDir;\n' +
    'uniform vec3 uSunColor;\n' +
    'uniform vec3 uAmbient;\n' +
    'uniform vec3 uFogColor;\n' +
    'uniform float uFogNear;\n' +
    'uniform float uFogFar;\n' +
    'void main() {\n' +
    '  vec3 n = normalize(vNormal);\n' +
    '  float diff = max(dot(n, normalize(uSunDir)), 0.0);\n' +
    '  vec3 lit = vColor * (uAmbient + uSunColor * diff);\n' +
    '  float f = clamp((vDist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);\n' +
    '  gl_FragColor = vec4(mix(lit, uFogColor, f), 1.0);\n' +
    '}\n';

  var WATER_VERT =
    'attribute vec3 aPos;\n' +
    'uniform mat4 uModel;\n' +
    'uniform mat4 uView;\n' +
    'uniform mat4 uProj;\n' +
    'uniform float uTime;\n' +
    'varying vec3 vPos;\n' +
    'varying float vWave;\n' +
    'void main() {\n' +
    '  float w = sin(aPos.x * 0.05 + uTime * 1.2) + sin(aPos.z * 0.07 - uTime * 0.9);\n' +
    '  vec3 p = aPos;\n' +
    '  p.y += w * 0.35;\n' +
    '  vPos = p;\n' +
    '  vWave = w * 0.5;\n' +
    '  gl_Position = uProj * uView * uModel * vec4(p, 1.0);\n' +
    '}\n';

  var WATER_FRAG =
    'precision mediump float;\n' +
    'varying vec3 vPos;\n' +
    'varying float vWave;\n' +
    'uniform vec3 uDeep;\n' +
    'uniform vec3 uShallow;\n' +
    'uniform vec3 uSunDir;\n' +
    'void main() {\n' +
    '  float band = 0.5 + 0.5 * sin(vPos.x * 0.08 + vPos.z * 0.06 + vWave * 2.0);\n' +
    '  vec3 col = mix(uDeep, uShallow, band * 0.5 + vWave * 0.25);\n' +
    '  float glint = pow(max(0.0, vWave), 3.0) * 0.25;\n' +
    '  gl_FragColor = vec4(col + vec3(glint), 1.0);\n' +
    '}\n';

  function compileShader(type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(shader);
      console.error('[CA.gl] shader compile failed: ' + log);
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function linkProgram(vertSource, fragSource) {
    var vs = compileShader(gl.VERTEX_SHADER, vertSource);
    if (!vs) { return null; }
    var fs = compileShader(gl.FRAGMENT_SHADER, fragSource);
    if (!fs) {
      gl.deleteShader(vs);
      return null;
    }
    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[CA.gl] program link failed: ' + gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  function getUniform(program, name) {
    var key = (program === solidProgram ? 's:' : 'w:') + name;
    if (!(key in uniformCache)) {
      uniformCache[key] = gl.getUniformLocation(program, name);
    }
    return uniformCache[key];
  }

  function getAttrib(program, name) {
    var key = (program === solidProgram ? 'sa:' : 'wa:') + name;
    if (!(key in uniformCache)) {
      uniformCache[key] = gl.getAttribLocation(program, name);
    }
    return uniformCache[key];
  }

  function onContextLost(e) {
    e.preventDefault();
    contextLost = true;
    console.error('[CA.gl] WebGL context lost; drawing is paused.');
  }

  function onContextRestored() {
    contextLost = false;
    console.error('[CA.gl] WebGL context restored; re-init is required.');
  }

  function init(canvasEl) {
    canvas = canvasEl;
    gl = canvas.getContext('webgl', { antialias: true, depth: true });
    if (!gl) {
      console.error('[CA.gl] WebGL is not available in this browser.');
      return false;
    }
    canvas.addEventListener('webglcontextlost', onContextLost, false);
    canvas.addEventListener('webglcontextrestored', onContextRestored, false);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.clearColor(skyColor[0], skyColor[1], skyColor[2], 1);
    solidProgram = linkProgram(SOLID_VERT, SOLID_FRAG);
    waterProgram = linkProgram(WATER_VERT, WATER_FRAG);
    solidOK = !!solidProgram;
    waterOK = !!waterProgram;
    if (!solidOK) { console.error('[CA.gl] solid program failed; nothing will draw.'); }
    if (!waterOK) { console.error('[CA.gl] water program failed; water will not draw.'); }
    resize();
    return solidOK;
  }

  function resize() {
    if (!canvas || !gl) { return; }
    var w = canvas.clientWidth || canvas.width || 1280;
    var h = canvas.clientHeight || canvas.height || 720;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function getSize() {
    if (!canvas) { return { width: 1280, height: 720 }; }
    return { width: canvas.width, height: canvas.height };
  }

  function clear() {
    if (!gl || contextLost) { return; }
    gl.clearColor(skyColor[0], skyColor[1], skyColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  function setSkyColor(r, g, b) {
    skyColor = [r, g, b];
  }

  function setView(matrix) { viewMatrix = matrix; }
  function setProjection(matrix) { projMatrix = matrix; }

  function setSun(dir, color) {
    if (dir) { sunDir = dir; }
    if (color) { sunColor = color; }
  }

  function setAmbient(color) { ambientColor = color; }
  function setFog(color, near, far) {
    if (color) { fogColor = color; }
    if (near !== undefined) { fogNear = near; }
    if (far !== undefined) { fogFar = far; }
  }

  function makeBuffer(data, target) {
    var buf = gl.createBuffer();
    gl.bindBuffer(target, buf);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return buf;
  }

  // data: {positions, normals, colors, indices} — plain arrays.
  // Missing normals default to up; missing colors default to white.
  // Index counts above 65535 need splitting by the caller: this
  // renderer uses Uint16 indices, so keep one mesh under that cap.
  function createMesh(data) {
    if (!gl) { return null; }
    var count = data.positions.length / 3;
    var normals = data.normals && data.normals.length === data.positions.length
      ? data.normals
      : null;
    var colors = data.colors && data.colors.length === data.positions.length
      ? data.colors
      : null;
    var normArr = new Float32Array(count * 3);
    var colArr = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      if (normals) {
        normArr[i * 3] = normals[i * 3];
        normArr[i * 3 + 1] = normals[i * 3 + 1];
        normArr[i * 3 + 2] = normals[i * 3 + 2];
      } else {
        normArr[i * 3 + 1] = 1;
      }
      if (colors) {
        colArr[i * 3] = colors[i * 3];
        colArr[i * 3 + 1] = colors[i * 3 + 1];
        colArr[i * 3 + 2] = colors[i * 3 + 2];
      } else {
        colArr[i * 3] = 1; colArr[i * 3 + 1] = 1; colArr[i * 3 + 2] = 1;
      }
    }
    var mesh = {
      posBuf: makeBuffer(new Float32Array(data.positions), gl.ARRAY_BUFFER),
      normBuf: makeBuffer(normArr, gl.ARRAY_BUFFER),
      colBuf: makeBuffer(colArr, gl.ARRAY_BUFFER),
      indexBuf: makeBuffer(new Uint16Array(data.indices), gl.ELEMENT_ARRAY_BUFFER),
      count: data.indices.length
    };
    return mesh;
  }

  function bindAttrib(program, name, buffer, size) {
    var loc = getAttrib(program, name);
    if (loc < 0 || loc === null) { return; }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }

  function setMatUniform(program, name, matrix) {
    var loc = getUniform(program, name);
    if (loc) { gl.uniformMatrix4fv(loc, false, matrix); }
  }

  function setVec3Uniform(program, name, v) {
    var loc = getUniform(program, name);
    if (loc) { gl.uniform3fv(loc, v); }
  }

  function drawMesh(mesh, modelMatrix) {
    if (!gl || contextLost || !solidOK || !mesh || !mesh.count) { return; }
    if (!viewMatrix || !projMatrix) { return; }
    gl.useProgram(solidProgram);
    bindAttrib(solidProgram, 'aPos', mesh.posBuf, 3);
    bindAttrib(solidProgram, 'aNormal', mesh.normBuf, 3);
    bindAttrib(solidProgram, 'aColor', mesh.colBuf, 3);
    setMatUniform(solidProgram, 'uModel', modelMatrix);
    setMatUniform(solidProgram, 'uView', viewMatrix);
    setMatUniform(solidProgram, 'uProj', projMatrix);
    setVec3Uniform(solidProgram, 'uSunDir', sunDir);
    setVec3Uniform(solidProgram, 'uSunColor', sunColor);
    setVec3Uniform(solidProgram, 'uAmbient', ambientColor);
    setVec3Uniform(solidProgram, 'uFogColor', fogColor);
    var loc;
    loc = getUniform(solidProgram, 'uFogNear');
    if (loc) { gl.uniform1f(loc, fogNear); }
    loc = getUniform(solidProgram, 'uFogFar');
    if (loc) { gl.uniform1f(loc, fogFar); }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuf);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  }

  // Water uses its own program. deep/shallow are [r,g,b] 0..1.
  function drawWater(mesh, modelMatrix, time, deep, shallow) {
    if (!gl || contextLost || !waterOK || !mesh || !mesh.count) { return; }
    if (!viewMatrix || !projMatrix) { return; }
    gl.useProgram(waterProgram);
    bindAttrib(waterProgram, 'aPos', mesh.posBuf, 3);
    setMatUniform(waterProgram, 'uModel', modelMatrix);
    setMatUniform(waterProgram, 'uView', viewMatrix);
    setMatUniform(waterProgram, 'uProj', projMatrix);
    var loc;
    loc = getUniform(waterProgram, 'uTime');
    if (loc) { gl.uniform1f(loc, time || 0); }
    setVec3Uniform(waterProgram, 'uDeep', deep || [0.05, 0.25, 0.45]);
    setVec3Uniform(waterProgram, 'uShallow', shallow || [0.15, 0.55, 0.7]);
    setVec3Uniform(waterProgram, 'uSunDir', sunDir);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuf);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  }

  function destroyMesh(mesh) {
    if (!gl || !mesh) { return; }
    if (mesh.posBuf) { gl.deleteBuffer(mesh.posBuf); }
    if (mesh.normBuf) { gl.deleteBuffer(mesh.normBuf); }
    if (mesh.colBuf) { gl.deleteBuffer(mesh.colBuf); }
    if (mesh.indexBuf) { gl.deleteBuffer(mesh.indexBuf); }
    mesh.count = 0;
  }

  CA.gl = {
    init: init,
    resize: resize,
    getSize: getSize,
    clear: clear,
    setSkyColor: setSkyColor,
    setView: setView,
    setProjection: setProjection,
    setSun: setSun,
    setAmbient: setAmbient,
    setFog: setFog,
    createMesh: createMesh,
    drawMesh: drawMesh,
    drawWater: drawWater,
    destroyMesh: destroyMesh,
    getContext: function () { return gl; },
    getCanvas: function () { return canvas; },
    isReady: function () { return solidOK && !contextLost; },
    isWaterReady: function () { return waterOK && !contextLost; },
    isContextLost: function () { return contextLost; },
    getSkyColor: function () { return skyColor.slice(); }
  };
})();
