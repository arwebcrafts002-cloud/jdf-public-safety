/* ============================================================
   JDF PUBLIC SAFETY: FOUNDERS CLUB
   One honest source of truth for the seat count.

   FOUNDERS_TAKEN is the number of founding seats that have
   actually been filled by a completed founder-level gift.
   It is 0 until real gifts exist. Do not raise it to create
   urgency: the counter is only worth something if it is true.
   When the database is live this constant is replaced by a
   fetch of the real count.
   ============================================================ */
(function () {
  'use strict';

  var FOUNDERS_TOTAL = 20;
  var FOUNDERS_TAKEN = 0;

  var taken = Math.max(0, Math.min(FOUNDERS_TOTAL, FOUNDERS_TAKEN));
  var open = FOUNDERS_TOTAL - taken;
  /* Shared with js/donate.js so the donate form never offers a founding seat that does not exist. */
  window.JDF_FOUNDERS = { total: FOUNDERS_TOTAL, taken: taken, open: open };
  var each = function (sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };

  each('[data-f-open]', function (el) { el.textContent = open; });
  each('[data-f-taken]', function (el) { el.textContent = taken; });
  each('[data-f-total]', function (el) { el.textContent = FOUNDERS_TOTAL; });
  each('[data-f-status]', function (el) {
    el.textContent = open === 0 ? 'All ' + FOUNDERS_TOTAL + ' founding seats are filled'
      : open === FOUNDERS_TOTAL ? 'All ' + FOUNDERS_TOTAL + ' founding seats are open'
      : open + ' of ' + FOUNDERS_TOTAL + ' founding seats open';
  });

  /* Seat grid in the hero */
  each('.f-seats', function (grid) {
    var html = '';
    for (var n = 1; n <= FOUNDERS_TOTAL; n++) {
      var t = n <= taken;
      html += '<div class="f-seat ' + (t ? 'is-taken' : 'is-open') + '" style="--n:' + (n - 1) + '" role="listitem" aria-label="Founder seat ' + n + (t ? ', taken' : ', open') + '"><div><b>' + pad(n) + '</b><i>' + (t ? 'Founder' : 'Open') + '</i></div></div>';
    }
    grid.setAttribute('role', 'list');
    grid.innerHTML = html;
  });

  /* Founders Wall plaques. Names come from the database later; never invented here. */
  each('.f-wall', function (wall) {
    var html = '';
    for (var n = 1; n <= FOUNDERS_TOTAL; n++) {
      html += '<div class="f-plaque" style="--n:' + (n - 1) + '"><b>No. ' + pad(n) + '</b><span>Reserved for founder No. ' + n + '</span></div>';
    }
    wall.innerHTML = html;
    if (!('IntersectionObserver' in window)) { wall.classList.add('is-in'); return; }
    var io = new IntersectionObserver(function (e) {
      if (e[0].isIntersecting) { wall.classList.add('is-in'); io.disconnect(); }
    }, { threshold: 0.12 });
    io.observe(wall);
  });

  /* Challenge coin: hover flips it on desktop, tap or Enter toggles it everywhere */
  each('.f-coin', function (coin) {
    coin.addEventListener('click', function () {
      var on = coin.classList.toggle('is-flipped');
      coin.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  });

  /* Tier links carry ?amount=&tier= to the donate page. If donate.js has not
     picked the amount up itself, preselect it here without touching donate.js. */
  var q = new URLSearchParams(location.search), amt = parseFloat(q.get('amount'));
  var custom = document.getElementById('give-custom');
  if (custom && amt > 0) {
    var hit = document.querySelector('.x-amt[data-amt="' + amt + '"]');
    if (hit) hit.click();
    else { custom.value = String(amt); custom.dispatchEvent(new Event('input', { bubbles: true })); }
  }
})();
