/* ============================================================
   JDF PUBLIC SAFETY: EMBEDDED SQUARE CARD FORM
   UNTESTED AGAINST SQUARE. Written without credentials; nothing
   here has been run against the sandbox or production. Test in
   the sandbox first (docs/SQUARE-SETUP.md).

   Standalone, no dependencies. Needs js/config.js loaded first.
   Card details are typed into an iframe served by Square, so
   card numbers never reach this site or its server. This module
   only ever handles the one-time token Square returns.

   Usage:
     if (JDFSquare.isEnabled()) {
       JDFSquare.mount(el).then(function (card) {
         card.tokenize().then(function (token) {
           return JDFSquare.pay({ token: token, amount: 180, frequency: 'once',
                                  donor: {...}, intentId: null });
         });
       });
     }
   ============================================================ */
(function () {
  'use strict';

  var cfg = window.JDF_CONFIG || {};
  var PAY_URL = '/api/square-pay';
  // VERIFY: Web Payments SDK script URLs (production and sandbox).
  var SDK = cfg.SQUARE_ENVIRONMENT === 'sandbox'
    ? 'https://sandbox.web.squarecdn.com/v1/square.js'
    : 'https://web.squarecdn.com/v1/square.js';
  var sdkPromise = null;
  var attemptKey = null; // one idempotency key per donation attempt, reused on retry

  function fail(message, code) {
    var e = new Error(message);
    e.code = code || 'square_error';
    e.donorMessage = message;
    return e;
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  function isEnabled() {
    return !!(cfg.SQUARE_APPLICATION_ID && cfg.SQUARE_LOCATION_ID);
  }

  function loadSdk() {
    if (window.Square) return Promise.resolve(window.Square);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      var timer = setTimeout(function () { reject(fail('The secure card form is taking too long to load. Check your connection and try again.', 'sdk_timeout')); }, 15000);
      s.src = SDK;
      s.async = true;
      s.onload = function () {
        clearTimeout(timer);
        if (window.Square) resolve(window.Square);
        else reject(fail('The secure card form could not start. Please refresh the page.', 'sdk_missing'));
      };
      s.onerror = function () {
        clearTimeout(timer);
        reject(fail('The secure card form could not load. An ad blocker or a network filter may be blocking it.', 'sdk_blocked'));
      };
      document.head.appendChild(s);
    }).catch(function (e) { sdkPromise = null; throw e; });
    return sdkPromise;
  }

  /**
   * Draws Square's card field inside containerEl.
   * Resolves with { tokenize(), destroy() }.
   */
  function mount(containerEl) {
    if (!isEnabled()) return Promise.reject(fail('Card payments are not switched on yet.', 'not_enabled'));
    if (!containerEl) return Promise.reject(fail('The card form has nowhere to appear on this page.', 'no_container'));
    attemptKey = uuid();

    return loadSdk().then(function (Square) {
      var payments;
      try {
        payments = Square.payments(cfg.SQUARE_APPLICATION_ID, cfg.SQUARE_LOCATION_ID);
      } catch (e) {
        throw fail('The secure card form could not start. Please refresh the page.', 'init_failed');
      }
      return payments.card().then(function (card) {
        return card.attach(containerEl).then(function () {
          return {
            tokenize: function () {
              return card.tokenize().then(function (result) {
                if (result && result.status === 'OK' && result.token) return result.token;
                var first = result && result.errors && result.errors[0];
                // Square's field-level messages are written for the cardholder, so pass the first one on.
                throw fail((first && first.message) || 'Please check the card number, expiry date, security code and ZIP code.', 'tokenize_failed');
              }, function () {
                throw fail('We could not read that card. Please check the details and try again.', 'tokenize_failed');
              });
            },
            destroy: function () {
              try { return card.destroy(); } catch (e) { return Promise.resolve(); }
            }
          };
        });
      }, function () {
        throw fail('The secure card form could not start. Please refresh the page.', 'card_failed');
      });
    });
  }

  /**
   * Sends the token to our server, which charges it through Square.
   * Resolves with { ok: true, status, receiptUrl?, frequency }.
   * Rejects with an Error carrying .donorMessage and .code.
   *   code 'not_configured' means the server has no Square credentials:
   *   the caller should fall back to the hosted checkout link.
   *   code 'unknown_outcome' means do NOT send the donor to pay again elsewhere.
   */
  function pay(opts) {
    opts = opts || {};
    if (!opts.token) return Promise.reject(fail('Please enter your card details.', 'no_token'));
    if (!attemptKey) attemptKey = uuid();

    var body = {
      token: opts.token,
      amount: Number(opts.amount),
      frequency: opts.frequency === 'monthly' ? 'monthly' : 'once',
      donor: opts.donor || {},
      intentId: opts.intentId || null,
      idempotencyKey: attemptKey,
      page: location.pathname
    };

    return fetch(PAY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (json) {
          if (res.ok && json.ok) { attemptKey = null; return json; }
          if (res.status === 503) throw fail('Card payments are not switched on yet.', 'not_configured');
          if (json.error === 'card_declined') {
            // A card token works once. The caller must tokenize again; a fresh key is right because nothing was charged.
            attemptKey = uuid();
            throw fail(json.message || 'Your card was declined. Please try another card or contact your bank.', 'card_declined');
          }
          if (json.error === 'invalid_fields') throw fail(json.message || 'Please check the amount and your details.', 'invalid_fields');
          throw fail('We could not confirm your payment. Before trying again, check your email for a receipt, or call (213) 260-0061.', 'unknown_outcome');
        });
      }, function () {
        // Network failure: the charge may or may not have gone through. Keep the same key so a retry cannot double-charge.
        throw fail('The connection dropped before we could confirm your payment. Press the button again: you will not be charged twice.', 'network');
      });
  }

  window.JDFSquare = { isEnabled: isEnabled, mount: mount, pay: pay };
})();
