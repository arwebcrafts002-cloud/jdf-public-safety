/* ============================================================
   JDF PUBLIC SAFETY: ON-SITE DONATION FLOW
   Step 1 amount, step 2 donor details, step 3 hand-off.

   Until Square API credentials exist, payment itself happens on
   the hosted Square checkout link below. Before the hand-off we
   record the donor's details at /api/intake so the gift can be
   matched, receipted and thanked. If that endpoint is not live
   yet, the donor is still sent to checkout: a gift is never
   blocked by our own backend.
   ============================================================ */
(function () {
  'use strict';

  var SQUARE_CHECKOUT_URL = 'https://checkout.square.site/merchant/MLJ5PH61AXA6B/checkout/ELKW6BQBBVY4ELAI3QT67YUJ';
  var INTAKE_URL = '/api/intake';
  var COST_PER_PATROL_HOUR = 90.5; // FY2026 budgeted cost of one deployed hour

  var form = document.getElementById('give');
  if (!form) return;

  var state = { amount: 180, freq: 'once' };
  var $ = function (s) { return form.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(form.querySelectorAll(s)); };
  var money = function (n) { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); };
  var custom = document.getElementById('give-custom');
  var byId = function (id) { return document.getElementById(id); };

  /* Giving levels. Placeholders pending David's approval. The level is always
     worked out from the amount; a tier name in the page address is ignored.
     api/intake.js repeats this table and recomputes the level on the server. */
  var TIERS = [
    { slug: 'founder',   min: 3600, name: 'Founders Club', items: 'Numbered challenge coin, lapel pin, Founders Wall plaque, plus hat, shirt, patch set and sticker', shirt: true },
    { slug: 'shield',    min: 1800, name: 'Shield',        items: 'Supporter patch set, shirt, hat, sticker and card, and your name on the supporters page', shirt: true },
    { slug: 'guardian',  min: 618,  name: 'Guardian',      items: 'Shirt, hat, sticker and thank-you card', shirt: true },
    { slug: 'supporter', min: 360,  name: 'Supporter',     items: 'Hat, sticker and thank-you card', shirt: false },
    { slug: 'friend',    min: 180,  name: 'Friend',        items: 'Sticker and thank-you card', shirt: false }
  ];

  /* Levels apply to one-time gifts. The Founders Club needs an open seat; if all
     seats are filled a gift of that size receives the Shield level instead. */
  function tier() {
    if (state.freq !== 'once' || !(state.amount >= 1)) return null;
    var seats = window.JDF_FOUNDERS, full = seats && seats.open === 0;
    for (var i = 0; i < TIERS.length; i++) {
      if (state.amount >= TIERS[i].min && !(TIERS[i].slug === 'founder' && full)) return TIERS[i];
    }
    return null;
  }

  var merch = byId('merch'), optOut = byId('merch-opt'), wall = byId('g-wall'), wallTyped = '';

  function merchUI() {
    if (!merch) return;
    var t = tier(), anon = form.elements.anonymous.checked;
    merch.hidden = !t;
    if (!t) return;
    var founder = t.slug === 'founder';
    byId('merch-line').innerHTML = 'This gift reaches the <b>' + t.name + '</b> level' + (founder ? ', limited to the first 20 founding donors' : '') + '. Included: ' + t.items + '.';
    byId('merch-wall').hidden = !founder;
    byId('merch-ship').hidden = optOut.checked;
    byId('merch-size').hidden = !t.shirt;
    if (anon) { if (!wall.disabled) wallTyped = wall.value; wall.value = 'Anonymous founder'; wall.disabled = true; }
    else if (wall.disabled) { wall.disabled = false; wall.value = wallTyped; }
    var sn = byId('g-ship-name');
    if (!sn.value.trim()) sn.value = (byId('g-first').value.trim() + ' ' + byId('g-last').value.trim()).trim();
  }
  if (merch) {
    optOut.addEventListener('change', merchUI);
    form.elements.anonymous.addEventListener('change', merchUI);
  }

  function impact() {
    var a = state.amount, el = document.getElementById('give-impact'), per = state.freq === 'monthly' ? ' every month' : '';
    if (!a || a < 1) { el.textContent = 'Choose an amount, or enter your own.'; return; }
    var hrs = a / COST_PER_PATROL_HOUR, txt;
    if (hrs < 0.95) txt = '<b>' + money(a) + '</b>' + per + ' keeps a patrol unit on the street for about <b>' + Math.max(1, Math.round(hrs * 60)) + ' minutes</b>.';
    else txt = '<b>' + money(a) + '</b>' + per + ' funds about <b>' + (hrs < 10 ? (Math.round(hrs * 2) / 2) : Math.round(hrs)) + ' hours</b> of patrol coverage.';
    var t = tier();
    el.innerHTML = txt + ' One deployed hour costs about $90.' + (t ? ' This gift reaches the <b>' + t.name + '</b> level.' : '');
  }

  function setAmount(a, fromCustom) {
    state.amount = a;
    $$('.x-amt').forEach(function (b) { b.setAttribute('aria-pressed', !fromCustom && Number(b.dataset.amt) === a ? 'true' : 'false'); });
    if (!fromCustom) custom.value = '';
    impact();
  }

  $$('.x-amt').forEach(function (b) { b.addEventListener('click', function () { setAmount(Number(b.dataset.amt)); }); });
  custom.addEventListener('input', function () {
    var v = parseFloat(custom.value.replace(/[^0-9.]/g, ''));
    setAmount(isNaN(v) ? 0 : Math.round(v * 100) / 100, true);
  });
  $$('[data-freq]').forEach(function (b) {
    b.addEventListener('click', function () {
      state.freq = b.dataset.freq;
      $('.x-freq').setAttribute('data-f', state.freq);
      $$('[data-freq]').forEach(function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
      impact();
    });
  });

  function validate(pane) {
    if (pane === 1) {
      if (!state.amount || state.amount < 1) { custom.focus(); return false; }
      return true;
    }
    var ok = true, first = null;
    ['#g-first', '#g-last', '#g-email'].forEach(function (s) {
      var f = $(s), bad = !f.value.trim() || (f.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.value.trim()));
      f.classList.toggle('bad', bad);
      if (bad) { ok = false; first = first || f; }
    });
    var t = tier();
    if (t && merch && !optOut.checked) {
      var need = ['#g-ship-name', '#g-ship-a1', '#g-ship-city', '#g-ship-state', '#g-ship-zip'];
      if (t.shirt) need.push('#g-size');
      need.forEach(function (s) {
        var f = $(s), v = f.value.trim(), bad = !v
          || (s === '#g-ship-state' && !/^[A-Za-z]{2}$/.test(v))
          || (s === '#g-ship-zip' && !/^\d{5}(-\d{4})?$/.test(v));
        f.classList.toggle('bad', bad);
        if (bad) { ok = false; first = first || f; }
      });
    }
    if (first) first.focus();
    return ok;
  }

  function summary() {
    var d = data();
    document.getElementById('s-name').textContent = d.first_name + ' ' + d.last_name;
    document.getElementById('s-email').textContent = d.email;
    var ded = d.dedication_type && d.dedication_name;
    document.getElementById('s-ded-row').style.display = ded ? '' : 'none';
    document.getElementById('s-ded').textContent = ded ? (d.dedication_type === 'honor' ? 'In honor of ' : 'In memory of ') + d.dedication_name : '';
    document.getElementById('s-anon').textContent = d.anonymous ? 'Anonymous' : 'Named';
    var t = tier();
    byId('s-tier-row').style.display = t ? '' : 'none';
    byId('s-items-row').style.display = t ? '' : 'none';
    if (t) {
      byId('s-tier').textContent = t.name + (t.slug === 'founder' ? ' (seat assigned when the gift is completed)' : '');
      byId('s-items').textContent = d.merch_opt_out ? 'None. Whole gift counts.' : 'Shipped to ' + d.ship_city + ', ' + d.ship_state + (t.shirt ? ' · shirt ' + d.shirt_size : '');
    }
    document.getElementById('s-total').textContent = money(state.amount) + (state.freq === 'monthly' ? ' / month' : '');
    document.getElementById('s-notice').textContent = state.freq === 'monthly'
      ? 'You will make your first ' + money(state.amount) + ' gift on our secure Square checkout. Enter ' + money(state.amount) + ' as the amount on the next screen. We will email you a secure link to set up the monthly schedule.'
      : 'You will complete payment on our secure Square checkout. Enter ' + money(state.amount) + ' as the amount on the next screen.';
  }

  function go(n) {
    $$('.x-pane').forEach(function (p) { p.classList.toggle('is-on', Number(p.dataset.pane) === n); });
    $$('.x-steps span').forEach(function (s, i) { s.classList.toggle('on', i < n); });
    if (n === 2) merchUI();
    if (n === 3) summary();
    var top = form.getBoundingClientRect().top + window.scrollY - 110;
    if (window.scrollY > top) window.scrollTo({ top: top, behavior: 'smooth' });
  }

  $$('[data-next]').forEach(function (b) {
    b.addEventListener('click', function () {
      var target = Number(b.dataset.next), cur = Number(form.querySelector('.x-pane.is-on').dataset.pane);
      if (target > cur && !validate(cur)) return;
      go(target);
    });
  });

  function data() {
    var fd = new FormData(form), o = {};
    fd.forEach(function (v, k) { o[k] = typeof v === 'string' ? v.trim() : v; });
    ['anonymous', 'newsletter', 'sms_consent'].forEach(function (k) { o[k] = !!form.elements[k].checked; });
    o.type = 'donation_intent';
    o.amount = state.amount;
    o.frequency = state.freq;
    o.page = location.pathname;

    var t = tier(), ship = ['ship_name', 'ship_address1', 'ship_address2', 'ship_city', 'ship_state', 'ship_postal'];
    o.tier = t ? t.slug : null;
    o.merch_opt_out = t ? !!optOut.checked : true;
    var sending = t && !o.merch_opt_out;
    ship.forEach(function (k) { if (!sending) o[k] = ''; });
    o.ship_state = (o.ship_state || '').toUpperCase();
    o.shirt_size = sending && t.shirt ? o.shirt_size : '';
    /* A disabled field is left out of FormData, so set the wall name by hand. */
    o.wall_display_name = t && t.slug === 'founder' ? (o.anonymous ? 'Anonymous founder' : wall.value.trim()) : '';
    return o;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    // Enter pressed on an earlier step: treat it as "continue", not "pay".
    var cur = Number(form.querySelector('.x-pane.is-on').dataset.pane);
    if (cur < 3) { if (validate(cur)) go(cur + 1); return; }
    if (!validate(1) || !validate(2)) return;
    var btn = document.getElementById('give-submit');
    btn.textContent = 'Opening secure checkout…';
    btn.style.pointerEvents = 'none';
    var leave = function () { window.location.href = SQUARE_CHECKOUT_URL; };
    var timer = setTimeout(leave, 2500);
    fetch(INTAKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data()), keepalive: true })
      .catch(function () {})
      .then(function () { clearTimeout(timer); leave(); });
  });

  impact();
})();
