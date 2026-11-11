/**
 * POST /api/square-pay
 * Charges a card token from the embedded Square card form (js/square-pay.js).
 *
 * UNTESTED AGAINST SQUARE. Written without credentials. Nothing in this file
 * has been run against the Square sandbox or production. Every line marked
 * VERIFY is a Square field, path or behavior that must be checked against the
 * current Square API reference and exercised in the sandbox before go-live.
 *
 * Zero npm dependencies: plain fetch against the Square REST API.
 *
 * Body (JSON):
 *   token           one-time card token from the browser (never a card number)
 *   amount          dollars, as a number; converted to cents here, never trusted as cents
 *   frequency       'once' | 'monthly'
 *   idempotencyKey  UUID made by the browser once per donation attempt. A retry
 *                   with the same key cannot charge twice.
 *   donor           { first_name, last_name, email, phone, anonymous,
 *                     dedication_type, dedication_name }
 *   intentId        id of the donation_intents row, if the browser has it
 *
 * Environment variables (Vercel > Project > Settings > Environment Variables):
 *   SQUARE_ACCESS_TOKEN                       secret. Production or sandbox token.
 *   SQUARE_LOCATION_ID                        which JDF location receives the money
 *   SQUARE_ENVIRONMENT                        'production' | 'sandbox'
 *   SQUARE_API_VERSION                        e.g. 2025-01-23. Pin it; do not float.
 *   SQUARE_SUBSCRIPTION_PLAN_VARIATION_ID     catalog id of the monthly giving plan
 *                                             variation (only needed for monthly)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   to record the gift
 *
 * If a required variable is missing the answer is 503, and the donate page
 * falls back to the hosted Square checkout link.
 *
 * What goes back to the browser: ok, status, frequency, receiptUrl. Never a
 * raw Square error, never card details.
 */

// Supabase keys: a new secret key (sb_secret_...) goes on the apikey header only.
// A legacy service_role JWT goes on both headers. `bearer` is a signed-in user's token.
const sbHeaders = (key, bearer) => Object.assign(
  { apikey: key },
  bearer ? { Authorization: 'Bearer ' + bearer } : (String(key).startsWith('sb_') ? {} : { Authorization: 'Bearer ' + key })
);

const MIN_CENTS = 100;          // $1
const MAX_CENTS = 5000000;      // $50,000. Larger gifts go through a person, not a web form.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const clean = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const emailOf = (v) => {
  const e = clean(v, 254);
  return e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e.toLowerCase() : undefined;
};

function squareBase() {
  return process.env.SQUARE_ENVIRONMENT === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';
}

async function square(method, path, body) {
  const res = await fetch(squareBase() + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + process.env.SQUARE_ACCESS_TOKEN,
      'Square-Version': process.env.SQUARE_API_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = {};
  try { json = await res.json(); } catch (e) { /* empty or non-JSON body */ }
  return { ok: res.ok, status: res.status, json, errors: json.errors || [] };
}

// Turn Square's error list into something safe to show a donor.
function donorError(errors) {
  const e = errors[0] || {};
  // VERIFY: error category and code names against the Payments API error reference.
  const declined = e.category === 'PAYMENT_METHOD_ERROR' || [
    'CARD_DECLINED', 'GENERIC_DECLINE', 'CVV_FAILURE', 'ADDRESS_VERIFICATION_FAILURE', 'INVALID_EXPIRATION',
    'CARD_EXPIRED', 'INSUFFICIENT_FUNDS', 'TRANSACTION_LIMIT', 'CARD_NOT_SUPPORTED', 'INVALID_CARD', 'INVALID_CARD_DATA',
    'CARD_TOKEN_EXPIRED', 'CARD_TOKEN_USED', 'PAN_FAILURE', 'CARD_DECLINED_VERIFICATION_REQUIRED',
  ].includes(e.code);
  if (!declined) return null;
  const messages = {
    CVV_FAILURE: 'The security code did not match. Please check it and try again.',
    ADDRESS_VERIFICATION_FAILURE: 'The ZIP code did not match the card. Please check it and try again.',
    INVALID_EXPIRATION: 'The expiry date is not valid. Please check it and try again.',
    CARD_EXPIRED: 'That card has expired. Please use another card.',
    INSUFFICIENT_FUNDS: 'The card was declined for insufficient funds. Please use another card.',
    CARD_NOT_SUPPORTED: 'That card type is not supported. Please use another card.',
  };
  return messages[e.code] || 'Your card was declined. Please try another card or contact your bank.';
}

// ---------- Supabase (service key; server only) ----------------------------
async function sb(method, path, body, prefer) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(process.env.SUPABASE_URL + '/rest/v1/' + path, {
    method,
    headers: { ...sbHeaders(key), 'Content-Type': 'application/json', Prefer: prefer || 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error('db ' + res.status + ': ' + (await res.text()));
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

async function upsertDonor(d, squareCustomerId) {
  const row = { email: d.email, first_name: d.first_name, last_name: d.last_name, phone: d.phone };
  if (squareCustomerId) row.square_customer_id = squareCustomerId;
  const rows = await sb('POST', 'donors?on_conflict=email', row, 'resolution=merge-duplicates,return=representation');
  return rows[0] && rows[0].id;
}

// Find the "what the donor typed" row so the paid gift can be matched to it.
async function findIntent(intentId, email, cents) {
  if (intentId && UUID.test(intentId)) {
    const byId = await sb('GET', 'donation_intents?select=id&id=eq.' + intentId);
    if (byId[0]) return byId[0].id;
  }
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const rows = await sb('GET', 'donation_intents?select=id&email=eq.' + encodeURIComponent(email) +
    '&amount_cents=eq.' + cents + '&matched_donation=is.null&created_at=gte.' + encodeURIComponent(since) + '&order=created_at.desc&limit=1');
  return rows[0] && rows[0].id;
}

// ---------- One-time gift ---------------------------------------------------
async function payOnce(input) {
  const r = await square('POST', '/v2/payments', {
    source_id: input.token,
    idempotency_key: input.key,                     // Square limit: 45 characters; a UUID is 36
    amount_money: { amount: input.cents, currency: 'USD' },
    location_id: process.env.SQUARE_LOCATION_ID,
    autocomplete: true,
    buyer_email_address: input.donor.email,
    note: 'JDF website donation',                   // VERIFY: shown on the Square dashboard and possibly on Square's own receipt
    reference_id: input.key.slice(0, 40),           // VERIFY: reference_id max length is 40
  });
  if (!r.ok) return { error: r };
  const p = r.json.payment || {};
  return { payment: p };
}

// ---------- Monthly gift ----------------------------------------------------
async function findOrCreateCustomer(donor, key) {
  // VERIFY: SearchCustomers exact-email filter shape.
  const found = await square('POST', '/v2/customers/search', {
    query: { filter: { email_address: { exact: donor.email } } }, limit: 1,
  });
  if (found.ok && found.json.customers && found.json.customers[0]) return { id: found.json.customers[0].id };
  const made = await square('POST', '/v2/customers', {
    idempotency_key: key + ':c',
    given_name: donor.first_name, family_name: donor.last_name, email_address: donor.email,
    // Phone is left out on purpose: Square rejects the whole request if the format is not valid.
  });
  if (!made.ok) return { error: made };
  return { id: made.json.customer.id };
}

async function payMonthly(input) {
  const customer = await findOrCreateCustomer(input.donor, input.key);
  if (customer.error) return { error: customer.error };

  // A card token works once. For monthly it is spent on saving the card; the
  // subscription then charges the saved card. Do not also call /v2/payments.
  const card = await square('POST', '/v2/cards', {
    idempotency_key: input.key + ':k',
    source_id: input.token,
    card: { customer_id: customer.id },             // VERIFY: CreateCard body shape
  });
  if (!card.ok) return { error: card };

  // VERIFY (important): how a per-donor amount is set on a subscription.
  // This uses `price_override_money`. Per Square's developer forum (checked
  // 11 Nov 2026) the override only takes effect when the plan variation uses
  // STATIC pricing; on a RELATIVE-priced variation it is ignored and the amount
  // has to live in an order template instead. So the monthly-giving plan must be
  // created with a static-price variation. Prove it in the sandbox (create a
  // subscription, check the first invoice amount) before offering monthly giving.
  const sub = await square('POST', '/v2/subscriptions', {
    idempotency_key: input.key + ':s',
    location_id: process.env.SQUARE_LOCATION_ID,
    plan_variation_id: process.env.SQUARE_SUBSCRIPTION_PLAN_VARIATION_ID,
    customer_id: customer.id,
    card_id: card.json.card.id,
    timezone: 'America/Los_Angeles',
    price_override_money: { amount: input.cents, currency: 'USD' },
  });
  if (!sub.ok) return { error: sub };
  return { subscription: sub.json.subscription || {}, customerId: customer.id };
}

// ---------- Handler ---------------------------------------------------------
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false, error: 'method_not_allowed' }); }

  const env = process.env;
  const needed = ['SQUARE_ACCESS_TOKEN', 'SQUARE_LOCATION_ID', 'SQUARE_ENVIRONMENT', 'SQUARE_API_VERSION', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  if (needed.some((k) => !env[k])) return res.status(503).json({ ok: false, error: 'not_configured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') return res.status(400).json({ ok: false, error: 'bad_json' });

  const d = body.donor && typeof body.donor === 'object' ? body.donor : {};
  const donor = {
    first_name: clean(d.first_name, 80), last_name: clean(d.last_name, 80), email: emailOf(d.email), phone: clean(d.phone, 40),
    anonymous: !!d.anonymous,
    dedication_type: ['honor', 'memory'].includes(d.dedication_type) ? d.dedication_type : null,
    dedication_name: clean(d.dedication_name, 160),
  };
  const amount = Number(body.amount);
  const cents = Number.isFinite(amount) ? Math.round(amount * 100) : NaN;
  const frequency = body.frequency === 'monthly' ? 'monthly' : 'once';
  const token = clean(body.token, 400);
  const key = clean(body.idempotencyKey, 36);

  if (!token || !key || !UUID.test(key) || !donor.email) {
    return res.status(422).json({ ok: false, error: 'invalid_fields', message: 'Please check your details and try again.' });
  }
  if (!(cents >= MIN_CENTS && cents <= MAX_CENTS)) {
    return res.status(422).json({ ok: false, error: 'invalid_fields', message: 'Online gifts can be between $1 and $50,000. For a larger gift, please call (213) 260-0061.' });
  }
  if (frequency === 'monthly' && !env.SQUARE_SUBSCRIPTION_PLAN_VARIATION_ID) {
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }

  const input = { token, key, cents, donor };
  let result;
  try {
    result = frequency === 'monthly' ? await payMonthly(input) : await payOnce(input);
  } catch (err) {
    // Network failure talking to Square: the outcome is unknown. The browser keeps
    // the same idempotency key, so pressing the button again is safe.
    console.error('square-pay: request to Square failed', err && err.message);
    return res.status(502).json({ ok: false, error: 'unknown_outcome' });
  }

  if (result.error) {
    const message = donorError(result.error.errors);
    console.error('square-pay: Square refused', result.error.status, JSON.stringify(result.error.errors.map((e) => ({ category: e.category, code: e.code }))));
    if (message) return res.status(402).json({ ok: false, error: 'card_declined', message });
    return res.status(502).json({ ok: false, error: 'payment_failed' });
  }

  // The money has moved (or the subscription exists). From here on, a database
  // problem must NOT be reported to the donor as a failed payment: log it, and
  // let the webhook (api/square-webhook.js) fill in the record.
  let recorded = true;
  try {
    const donorId = await upsertDonor(donor, result.customerId || (result.payment && result.payment.customer_id));
    const intentId = await findIntent(body.intentId, donor.email, cents);

    if (frequency === 'once') {
      const p = result.payment;
      const rows = await sb('POST', 'donations?on_conflict=square_payment_id', {
        donor_id: donorId, square_payment_id: p.id, square_order_id: p.order_id || null,
        amount_cents: cents, currency: 'USD', frequency: 'once',
        status: String(p.status || 'COMPLETED').toLowerCase(),
        is_anonymous: donor.anonymous, dedication_type: donor.dedication_type, dedication_name: donor.dedication_name,
        donor_email: donor.email, idempotency_key: key, receipt_url: p.receipt_url || null, source: 'embedded',
        paid_at: p.created_at || new Date().toISOString(),
      }, 'resolution=merge-duplicates,return=representation');
      if (intentId && rows[0]) await sb('PATCH', 'donation_intents?id=eq.' + intentId, { matched_donation: rows[0].id }, 'return=minimal');
    } else {
      const s = result.subscription;
      const rows = await sb('POST', 'subscriptions?on_conflict=square_subscription_id', {
        donor_id: donorId, square_subscription_id: s.id, square_customer_id: result.customerId,
        amount_cents: cents, status: String(s.status || 'ACTIVE').toLowerCase(),
        is_anonymous: donor.anonymous, dedication_type: donor.dedication_type, dedication_name: donor.dedication_name,
        donor_email: donor.email, idempotency_key: key,
      }, 'resolution=merge-duplicates,return=representation');
      if (intentId && rows[0]) await sb('PATCH', 'donation_intents?id=eq.' + intentId, { matched_subscription: rows[0].id }, 'return=minimal');
    }
  } catch (err) {
    recorded = false;
    console.error('square-pay: PAID BUT NOT RECORDED. key=' + key + ' ' + (err && err.message));
  }

  // The receipt email is sent by the webhook when Square confirms the payment,
  // so that hosted-checkout gifts and monthly renewals get the same receipt.
  return res.status(200).json({
    ok: true,
    frequency,
    status: frequency === 'once' ? String(result.payment.status || '').toLowerCase() : String(result.subscription.status || '').toLowerCase(),
    receiptUrl: frequency === 'once' ? (result.payment.receipt_url || null) : null,
    recorded,
  });
};
