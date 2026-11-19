// economy.js — Cayo Azul money.
// Owns the balance. Money comes from missions, jobs, events and
// selling cars. Every change carries a reason string so the HUD log
// and the save file can say why the number moved. Paying refuses
// when unaffordable instead of going negative.
// Prices: hatchback cheapest, sports coupe dearest, pickup and sedan
// between, taxi above the sedan. The police cruiser is never for sale.
// Revision notes: a refund after a failed store no longer inflates
// totalEarned (it reverses the payment directly); sellCar now removes
// the car from garage contents in place instead of spawning it into
// the world and deleting it again; reset() and carValue() added for
// new games and for the garage UI.
(function () {
  'use strict';
  var CA = window.CA || (window.CA = {});
  if (!CA.state) CA.state = {};
  if (!CA.state.player) CA.state.player = {};
  if (typeof CA.state.player.money !== 'number') CA.state.player.money = 500;
  if (typeof CA.state.totalEarned !== 'number') CA.state.totalEarned = 0;
  if (!CA.state.ledger) CA.state.ledger = [];

  var STARTING_BALANCE = 500;
  var PRICES = {
    hatchback: 4500,
    sedan: 9500,
    taxi: 12000,
    pickup: 14000,
    /* Canonical model id is 'sports' (the car module's id); the
       old 'sports-coupe' key priced a model that does not exist. */
    sports: 32000
  };
  var SELLBACK = 0.6;

  function balance() { return CA.state.player.money; }

  function log(kind, amount, reason) {
    var entry = { kind: kind, amount: amount, reason: reason || '', balance: CA.state.player.money };
    CA.state.ledger.push(entry);
    if (CA.state.ledger.length > 60) CA.state.ledger.shift();
    return entry;
  }

  function grant(amount, reason) {
    if (typeof amount !== 'number' || amount <= 0) return { ok: false, reason: 'bad-amount' };
    var paid = Math.floor(amount);
    CA.state.player.money += paid;
    CA.state.totalEarned += paid;
    log('grant', paid, reason);
    /* (G integration: the threshold lives in moneyChanged — the
       old code called check('earned-10k') on every grant, so the
       Ten Grand achievement fired on the first $750 mission.) */
    if (CA.achievements && typeof CA.achievements.moneyChanged === 'function') {
      CA.achievements.moneyChanged();
    }
    return { ok: true, amount: paid, balance: CA.state.player.money };
  }

  function pay(amount, reason) {
    if (typeof amount !== 'number' || amount <= 0) return { ok: false, reason: 'bad-amount' };
    var cost = Math.floor(amount);
    if (CA.state.player.money < cost) {
      return { ok: false, reason: 'unaffordable', balance: CA.state.player.money, needed: cost };
    }
    CA.state.player.money -= cost;
    log('pay', -cost, reason);
    return { ok: true, amount: cost, balance: CA.state.player.money };
  }

  // Reverse a payment without touching totalEarned: used only when a
  // purchase fails after the money was already taken.
  function refund(amount, reason) {
    if (typeof amount !== 'number' || amount <= 0) return { ok: false, reason: 'bad-amount' };
    var back = Math.floor(amount);
    CA.state.player.money += back;
    log('refund', back, reason);
    return { ok: true, amount: back, balance: CA.state.player.money };
  }

  function canAfford(amount) {
    return typeof amount === 'number' && CA.state.player.money >= Math.floor(amount);
  }

  function price(model) {
    if (Object.prototype.hasOwnProperty.call(PRICES, model)) return PRICES[model];
    return null;
  }

  function carValue(model) {
    var p = price(model);
    if (p === null) return null;
    return Math.floor(p * SELLBACK);
  }

  function buyableModels() { return Object.keys(PRICES); }

  // Buy a car model into a garage. The car module never handles money;
  // this is the one place a purchase happens.
  function buyCar(model, garageId) {
    var p = price(model);
    if (p === null) return { ok: false, reason: 'not-for-sale', model: model };
    var paid = pay(p, 'buy car ' + model);
    if (!paid.ok) return { ok: false, reason: paid.reason, needed: p, balance: paid.balance };
    var stored = null;
    if (CA.garages) {
      var res = CA.garages.store({ model: model, colour: defaultColour(model), health: 100 }, garageId);
      if (!res.ok) {
        // Garage full or missing: refund in full, no car lost, and
        // the refund must not count as earnings.
        refund(p, 'refund: ' + model + ' (' + res.reason + ')');
        return { ok: false, reason: res.reason, garage: res.garage };
      }
      stored = res;
    }
    return { ok: true, model: model, price: p, balance: CA.state.player.money, stored: stored };
  }

  function defaultColour(model) {
    var colours = {
      hatchback: 'yellow',
      sedan: 'blue',
      taxi: 'yellow',
      pickup: 'red',
      sports: 'orange'
    };
    return colours[model] || 'grey';
  }

  // Sell a stored car back for sixty percent of its list price. The
  // car is removed from garage contents directly; it never spawns
  // into the world as part of a sale.
  function sellCar(garageId, index) {
    if (!CA.garages) return { ok: false, reason: 'no-garages' };
    var cars = CA.garages.list(garageId);
    if (!cars || index < 0 || index >= cars.length) return { ok: false, reason: 'empty-slot' };
    var car = cars[index];
    var p = price(car.model);
    if (p === null) return { ok: false, reason: 'not-for-sale' };
    var back = Math.floor(p * SELLBACK);
    var contents = CA.garages.contents();
    var slot = contents[garageId];
    if (!slot || index >= slot.length) return { ok: false, reason: 'empty-slot' };
    slot.splice(index, 1);
    var owned = CA.state.ownedCars;
    for (var i = owned.length - 1; i >= 0; i--) {
      if (owned[i].plate === car.plate && owned[i].garage === garageId) { owned.splice(i, 1); break; }
    }
    grant(back, 'sell car ' + car.model);
    return { ok: true, model: car.model, amount: back, balance: CA.state.player.money };
  }

  // Mission and job payouts. A kill streak above one adds a small
  // multiplier, capped, as the player module's streak describes.
  function payout(base, reason, clean) {
    var mult = 1;
    var streak = (CA.state.player && CA.state.player.killStreak) || 0;
    if (streak > 1) mult += Math.min(0.25, (streak - 1) * 0.05);
    if (clean) mult += 0.1;
    var total = Math.floor(base * mult);
    return grant(total, reason);
  }

  // Preview a payout without paying it, for the mission briefing.
  function estimatePayout(base, clean) {
    var mult = 1;
    var streak = (CA.state.player && CA.state.player.killStreak) || 0;
    if (streak > 1) mult += Math.min(0.25, (streak - 1) * 0.05);
    if (clean) mult += 0.1;
    return Math.floor(base * mult);
  }

  function fine(amount, reason) {
    return pay(amount, reason || 'fine');
  }

  function reset() {
    CA.state.player.money = STARTING_BALANCE;
    CA.state.totalEarned = 0;
    CA.state.ledger = [];
  }

  CA.economy = {
    prices: PRICES,
    sellback: SELLBACK,
    startingBalance: STARTING_BALANCE,
    balance: balance,
    grant: grant,
    pay: pay,
    refund: refund,
    canAfford: canAfford,
    price: price,
    carValue: carValue,
    buyableModels: buyableModels,
    buyCar: buyCar,
    sellCar: sellCar,
    payout: payout,
    estimatePayout: estimatePayout,
    fine: fine,
    reset: reset,
    totalEarned: function () { return CA.state.totalEarned; },
    ledger: function () { return CA.state.ledger.slice(); }
  };
})();
