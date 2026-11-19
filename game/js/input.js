// Cayo Azul — input.js
// Keyboard and mouse state. Game code reads state through query
// functions; it never touches the raw event listeners. The loop calls
// update() once per frame, after the frame's logic has run, which
// clears the just-pressed set and the per-frame mouse deltas.
// Call reset() when switching screens (title, pause, busted) so no
// key held on the old screen leaks into the new one.

(function () {
  'use strict';

  window.CA = window.CA || {};
  var CA = window.CA;

  var held = {};
  var justPressed = {};
  var mouseDown = {};
  var mouseJustPressed = {};
  var mouseX = 0;
  var mouseY = 0;
  var mouseDX = 0;
  var mouseDY = 0;
  var wheelDelta = 0;
  var attached = false;
  var canvasEl = null;
  var lastMouseX = 0;
  var lastMouseY = 0;

  // Keys the game uses; their browser defaults (scrolling, etc.)
  // are suppressed while the page has focus.
  var GAME_KEYS = [
    'KeyW', 'KeyA', 'KeyS', 'KeyD',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Space', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyF',
    'KeyR', 'KeyQ', 'KeyM', 'KeyP', 'Escape', 'Enter', 'Tab'
  ];

  function isGameKey(code) {
    return GAME_KEYS.indexOf(code) !== -1;
  }

  function onKeyDown(e) {
    if (isGameKey(e.code)) { e.preventDefault(); }
    // Ignore auto-repeat: a held key must not re-fire justPressed.
    if (!e.repeat && !held[e.code]) { justPressed[e.code] = true; }
    held[e.code] = true;
  }

  function onKeyUp(e) {
    held[e.code] = false;
  }

  function onBlur() {
    // Losing focus releases everything: a held key must never
    // stick across a tab switch.
    reset();
  }

  function onMouseMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    mouseDX += e.clientX - lastMouseX;
    mouseDY += e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }

  function onMouseDown(e) {
    if (!mouseDown[e.button]) { mouseJustPressed[e.button] = true; }
    mouseDown[e.button] = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    mouseX = e.clientX;
    mouseY = e.clientY;
  }

  function onMouseUp(e) {
    mouseDown[e.button] = false;
  }

  function onWheel(e) {
    e.preventDefault();
    wheelDelta += e.deltaY;
  }

  function onContextMenu(e) {
    // Right-click is a game input (camera orbit), not a menu.
    if (canvasEl) { e.preventDefault(); }
  }

  function attach(canvas) {
    if (attached) { return; }
    attached = true;
    canvasEl = canvas || null;
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    if (canvas) {
      canvas.addEventListener('mousemove', onMouseMove);
      canvas.addEventListener('mousedown', onMouseDown);
      canvas.addEventListener('contextmenu', onContextMenu);
      window.addEventListener('mouseup', onMouseUp);
      canvas.addEventListener('wheel', onWheel, { passive: false });
    }
  }

  // End-of-frame housekeeping. Call once per frame, after logic.
  function update() {
    justPressed = {};
    mouseJustPressed = {};
    mouseDX = 0;
    mouseDY = 0;
    wheelDelta = 0;
  }

  // Clear all held and just-pressed state immediately.
  function reset() {
    held = {};
    justPressed = {};
    mouseDown = {};
    mouseJustPressed = {};
    mouseDX = 0;
    mouseDY = 0;
    wheelDelta = 0;
  }

  function isDown(code) {
    return !!held[code];
  }

  function wasPressed(code) {
    return !!justPressed[code];
  }

  function anyDown(codes) {
    for (var i = 0; i < codes.length; i++) {
      if (held[codes[i]]) { return true; }
    }
    return false;
  }

  function anyPressed(codes) {
    for (var i = 0; i < codes.length; i++) {
      if (justPressed[codes[i]]) { return true; }
    }
    return false;
  }

  function isMouseDown(button) {
    return !!mouseDown[button || 0];
  }

  function wasMousePressed(button) {
    return !!mouseJustPressed[button || 0];
  }

  function heldCodes() {
    var out = [];
    for (var code in held) {
      if (held[code]) { out.push(code); }
    }
    return out;
  }

  CA.input = {
    attach: attach,
    update: update,
    reset: reset,
    isDown: isDown,
    wasPressed: wasPressed,
    anyDown: anyDown,
    anyPressed: anyPressed,
    isMouseDown: isMouseDown,
    wasMousePressed: wasMousePressed,
    heldCodes: heldCodes,
    getMouseX: function () { return mouseX; },
    getMouseY: function () { return mouseY; },
    getMouseDX: function () { return mouseDX; },
    getMouseDY: function () { return mouseDY; },
    getWheelDelta: function () { return wheelDelta; },
    // Movement helpers: -1/0/+1 along the two ground axes, from
    // WASD or the arrow keys, so callers do not repeat the mapping.
    moveX: function () {
      var x = 0;
      if (held['KeyD'] || held['ArrowRight']) { x += 1; }
      if (held['KeyA'] || held['ArrowLeft']) { x -= 1; }
      return x;
    },
    moveY: function () {
      var y = 0;
      if (held['KeyW'] || held['ArrowUp']) { y += 1; }
      if (held['KeyS'] || held['ArrowDown']) { y -= 1; }
      return y;
    }
  };
})();
