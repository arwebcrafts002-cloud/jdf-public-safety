/**
 * POST /api/square-webhook
 * Square calls this when a payment, refund, invoice or subscription changes.
 * It keeps the donations table true to what Square says actually happened,
 * and sends the donor's receipt email exactly once.
 *
 * UNTESTED AGAINST SQUARE. Written without credentials and never called by
 * Square. Every line marked VERIFY is an event name, payload field or platform
 * behavior that must be checked against the current Square webhook reference
 * and exercised with sandbox test events before go-live.
 *
 * Why it exists: api/square-pay.js records a gift when the embedded form is
 * used, but gifts made on the hosted checkout link and every monthly renewal
 * only ever reach us through this webhook.
 *
 * Environment variables:
 *   SQUARE_WEBHOOK_SIGNATURE_KEY   secret, shown when the webhook subscription is created
 *   SQUARE_WEBHOOK_URL             the exact URL registered with Square, e.g.
 *                                  https://jdfpublicsafety.org/api/square-webhook
 *                                  (the signature covers this string, so it must match
 *                                  character for character, including https and no trailing slash)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY, EMAIL_FROM     optional; without them no receipt is emailed
 *   RECEIPT_TAX_STATEMENT          optional; the accountant-approved sentence for receipts.
 *                                  Nothing about tax status is printed unless this is set.
 *   STAFF_NOTIFY_TO                optional, comma-separated
 *
 * Raw body: the signature is computed over the exact bytes Square sent, so the
 * body must not be parsed and re-serialized first.
 * VERIFY: on Vercel, a plain Node function in /api gets a parsed req.body from
 * the platform's helpers. Confirm one of these gives the untouched bytes on the
 * deployed project: (a) reading the request stream as done in rawBody() below,
 * (b) the exported config below, or (c) setting the project env var
 * NODEJS_HELPERS=0. If none does, signature checks fail closed (401) and no
 * event is processed.
 */
const crypto = require('crypto');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const money = (cents) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function rawBody(req) {
  return new Promise((resolve) => {
    if (Buffer.isBuffer(req.rawBody)) return resolve(req.rawBody);
    if (typeof req.rawBody === 'string') return resolve(Buffer.from(req.rawBody, 'utf8'));
    if (req.readableEnded || req.complete === true && req.readable === false) return resolve(null);
    const chunks = [];
    const timer = setTimeout(() => resolve(chunks.length ? Buffer.concat(chunks) : null), 3000);
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { clearTimeout(timer); resolve(chunks.length ? Buffer.concat(chunks) : null); });
    req.on('error', () => { clearTimeout(timer); resolve(null); });
  });
}

function validSignature(raw, header) {
  // VERIFY: header name x-square-hmacsha256-signature, and that the signed string
  // is notification URL + raw body, HMAC-SHA256 with the signature key, base64.
  if (!raw || typeof header !== 'string' || !header) return false;
  const expected = crypto.createHmac('sha256', process.env.SQUARE_WEBHOOK_SIGNATURE_KEY)
    .update(process.env.SQUARE_WEBHOOK_URL + raw.toString('utf8'), 'utf8').digest();
  let given;
  try { given = Buffer.from(header, 'base64'); } catch (e) { return false; }
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

async function sb(method, path, body, prefer) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(process.env.SUPABASE_URL + '/rest/v1/' + path, {
    method,
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: prefer || 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error('db ' + res.status + ': ' + (await res.text()));
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

async function email(to, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, html }),
  });
  if (!res.ok) throw new Error('resend ' + res.status);
}

// ---------- Receipt: exactly once -------------------------------------------
// The claim is a single UPDATE that only succeeds while receipt_sent_at is null.
// Two webhook deliveries racing each other cannot both win it. If sending then
// fails, the claim is released so Square's retry can try again.
async function sendReceiptOnce(donation) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return;
  const claimed = await sb('PATCH', 'donations?id=eq.' + donation.id + '&receipt_sent_at=is.null',
    { receipt_sent_at: new Date().toISOString() });
  if (!claimed.length) return;
  const d = claimed[0];

  let to = d.donor_email, first = '';
  if (d.donor_id) {
    const donors = await sb('GET', 'donors?select=email,first_name&id=eq.' + d.donor_id);
    if (donors[0]) { to = to || donors[0].email; first = donors[0].first_name || ''; }
  }
  if (!to) { await sb('PATCH', 'donations?id=eq.' + d.id, { receipt_sent_at: null }, 'return=minimal'); return; }

  const receiptNo = 'JDF-' + String(d.id).slice(0, 8).toUpperCase();
  const date = new Date(d.paid_at).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'long', day: 'numeric' });
  const dedication = d.dedication_type && d.dedication_name
    ? '<tr><td style="padding:6px 16px 6px 0;color:#64748b">Dedication</td><td><b>' + (d.dedication_type === 'honor' ? 'In honor of ' : 'In memory of ') + esc(d.dedication_name) + '</b></td></tr>' : '';
  const tax = process.env.RECEIPT_TAX_STATEMENT
    ? '<p style="font-size:13px;color:#475569;border-top:1px solid #e2e8f0;padding-top:14px">' + esc(process.env.RECEIPT_TAX_STATEMENT) + '</p>' : '';
  // This is the plain fallback layout. The designed template (donation-receipt.html
  // on the email templates page) replaces it once the templates are loaded into Resend.
  const html =
    '<div style="font:16px/1.6 Arial,sans-serif;color:#0b1329;max-width:560px">' +
    '<h2 style="margin:0 0 12px">Thank you' + (first ? ', ' + esc(first) : '') + '.</h2>' +
    '<p>Your gift to JDF Public Safety has been received. It goes to work on the streets of Pico-Robertson and Beverlywood.</p>' +
    '<table style="font-size:15px;border-collapse:collapse;margin:14px 0">' +
    '<tr><td style="padding:6px 16px 6px 0;color:#64748b">Amount</td><td><b>' + esc(money(d.amount_cents)) + (d.frequency === 'monthly' ? ' (monthly gift)' : '') + '</b></td></tr>' +
    '<tr><td style="padding:6px 16px 6px 0;color:#64748b">Date</td><td><b>' + esc(date) + '</b></td></tr>' +
    '<tr><td style="padding:6px 16px 6px 0;color:#64748b">Receipt</td><td><b>' + esc(receiptNo) + '</b></td></tr>' + dedication +
    '</table>' + tax +
    '<p style="font-size:13px;color:#64748b">Questions about this gift: (213) 260-0061 or info@jdfpublicsafety.org.</p></div>';

  try {
    await email([to], 'Thank you for your gift to JDF Public Safety', html);
    if (process.env.STAFF_NOTIFY_TO) {
      await email(process.env.STAFF_NOTIFY_TO.split(',').map((s) => s.trim()).filter(Boolean),
        '[JDF site] Gift received: ' + money(d.amount_cents) + (d.frequency === 'monthly' ? ' monthly' : ''),
        '<p style="font:14px Arial,sans-serif">' + esc(d.is_anonymous ? 'Anonymous donor' : to) + ', ' + esc(money(d.amount_cents)) + ', receipt ' + esc(receiptNo) + '.</p>').catch(() => {});
    }
  } catch (err) {
    await sb('PATCH', 'donations?id=eq.' + d.id, { receipt_sent_at: null }, 'return=minimal');
    throw err;
  }
}

// ---------- Event handlers ---------------------------------------------------
async function onPayment(payment) {
  // VERIFY: payment object fields used here: id, status, amount_money.amount,
  // amount_money.currency, order_id, customer_id, buyer_email_address,
  // receipt_url, created_at, updated_at.
  if (!payment || !payment.id) return;
  const status = String(payment.status || '').toLowerCase();   // approved | pending | completed | canceled | failed
  const row = {
    square_payment_id: payment.id,
    amount_cents: payment.amount_money ? Number(payment.amount_money.amount) : undefined,
    currency: payment.amount_money ? payment.amount_money.currency : undefined,
    status,
    square_order_id: payment.order_id || undefined,
    square_customer_id: payment.customer_id || undefined,
    receipt_url: payment.receipt_url || undefined,
    paid_at: payment.created_at || undefined,
  };
  if (payment.buyer_email_address) row.donor_email = String(payment.buyer_email_address).toLowerCase();
  Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);

  // merge-duplicates updates only the columns sent, so what api/square-pay.js
  // already recorded (anonymous, dedication, frequency, donor) is left alone.
  const rows = await sb('POST', 'donations?on_conflict=square_payment_id', row, 'resolution=merge-duplicates,return=representation');
  let donation = rows[0];
  if (!donation) return;

  // A payment that did not come through our embedded form (hosted checkout, or a
  // monthly renewal) arrives with no donor attached. Fill in what can be known.
  if (!donation.donor_id) {
    const patch = {};
    if (payment.customer_id) {
      // Monthly renewal: the Square customer has an active subscription with us.
      const subs = await sb('GET', 'subscriptions?select=id,donor_id,is_anonymous,dedication_type,dedication_name,donor_email&square_customer_id=eq.' +
        encodeURIComponent(payment.customer_id) + '&amount_cents=eq.' + donation.amount_cents + '&order=created_at.desc&limit=1');
      if (subs[0]) Object.assign(patch, {
        donor_id: subs[0].donor_id, frequency: 'monthly', subscription_id: subs[0].id, source: 'subscription',
        is_anonymous: subs[0].is_anonymous, dedication_type: subs[0].dedication_type, dedication_name: subs[0].dedication_name,
        donor_email: donation.donor_email || subs[0].donor_email,
      });
    }
    if (!patch.donor_id && donation.donor_email) {
      // Hosted checkout: match the details the donor typed on our page before leaving.
      const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const intents = await sb('GET', 'donation_intents?select=*&email=eq.' + encodeURIComponent(donation.donor_email) +
        '&amount_cents=eq.' + donation.amount_cents + '&matched_donation=is.null&created_at=gte.' + encodeURIComponent(since) + '&order=created_at.desc&limit=1');
      const it = intents[0];
      if (it) {
        const donors = await sb('POST', 'donors?on_conflict=email',
          { email: it.email, first_name: it.first_name, last_name: it.last_name, phone: it.phone, sms_consent: it.sms_consent },
          'resolution=merge-duplicates,return=representation');
        Object.assign(patch, {
          donor_id: donors[0] && donors[0].id, frequency: it.frequency, source: 'hosted',
          is_anonymous: it.is_anonymous, dedication_type: it.dedication_type, dedication_name: it.dedication_name,
        });
        await sb('PATCH', 'donation_intents?id=eq.' + it.id, { matched_donation: donation.id }, 'return=minimal');
      }
    }
    if (Object.keys(patch).length) {
      const patched = await sb('PATCH', 'donations?id=eq.' + donation.id, patch);
      donation = patched[0] || donation;
    }
  }

  if (status === 'completed') {
    // ======================================================================
    // TODO (Founders Club): assign the founder seat number here, once, when a
    // completed gift is at the founder level. db/founders.sql is owned by
    // another thread; call its assignment function through PostgREST, e.g.
    //   await sb('POST', 'rpc/assign_founder_number', { p_donation: donation.id });
    // VERIFY: the function's real name and arguments in db/founders.sql. It must
    // be idempotent, because Square can deliver the same event more than once.
    // ======================================================================
    await sendReceiptOnce(donation);
  }
}

async function onRefund(refund) {
  // VERIFY: refund object fields: payment_id, status, amount_money.amount.
  if (!refund || !refund.payment_id) return;
  if (String(refund.status || '').toUpperCase() !== 'COMPLETED') return;
  const rows = await sb('GET', 'donations?select=id,amount_cents&square_payment_id=eq.' + encodeURIComponent(refund.payment_id));
  if (!rows[0]) return;
  const refunded = refund.amount_money ? Number(refund.amount_money.amount) : rows[0].amount_cents;
  // Sets the total from this refund only. If JDF ever issues two partial refunds
  // on one gift, sum them from Square instead.
  await sb('PATCH', 'donations?id=eq.' + rows[0].id, {
    status: refunded >= rows[0].amount_cents ? 'refunded' : 'partially_refunded',
    refunded_cents: refunded, refunded_at: new Date().toISOString(),
  }, 'return=minimal');
}

async function onInvoice(invoice) {
  // A monthly renewal is billed by Square as an invoice tied to the subscription.
  // The money itself arrives as a payment event; this only labels that donation.
  // VERIFY: invoice.subscription_id and invoice.order_id exist on subscription invoices.
  if (!invoice || !invoice.subscription_id || !invoice.order_id) return;
  const subs = await sb('GET', 'subscriptions?select=id,donor_id&square_subscription_id=eq.' + encodeURIComponent(invoice.subscription_id));
  if (!subs[0]) return;
  await sb('PATCH', 'donations?square_order_id=eq.' + encodeURIComponent(invoice.order_id),
    { frequency: 'monthly', subscription_id: subs[0].id, donor_id: subs[0].donor_id, source: 'subscription' }, 'return=minimal');
}

async function onSubscription(sub) {
  // VERIFY: subscription.status values (ACTIVE, CANCELED, DEACTIVATED, PAUSED, PENDING) and canceled_date.
  if (!sub || !sub.id) return;
  const status = String(sub.status || '').toLowerCase();
  const patch = { status };
  if (status === 'canceled' || status === 'deactivated') patch.canceled_at = new Date().toISOString();
  await sb('PATCH', 'subscriptions?square_subscription_id=eq.' + encodeURIComponent(sub.id), patch, 'return=minimal');
}

// ---------- Handler ----------------------------------------------------------
const handler = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false }); }
  const env = process.env;
  if (!env.SQUARE_WEBHOOK_SIGNATURE_KEY || !env.SQUARE_WEBHOOK_URL || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }

  let raw = await rawBody(req);
  if (!raw && typeof req.body === 'string') raw = Buffer.from(req.body, 'utf8');
  if (!raw && Buffer.isBuffer(req.body)) raw = req.body;
  // If the platform already parsed the body into an object, the original bytes
  // are gone and the signature cannot be checked. Refuse rather than trust it.
  if (!validSignature(raw, req.headers['x-square-hmacsha256-signature'])) {
    console.error('square-webhook: signature check failed' + (raw ? '' : ' (no raw body available; see the VERIFY note at the top of this file)'));
    return res.status(401).json({ ok: false });
  }

  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch (e) { return res.status(400).json({ ok: false }); }
  const obj = (event.data && event.data.object) || {};

  try {
    // VERIFY: event type names and where the object sits (data.object.<name>).
    switch (event.type) {
      case 'payment.created':
      case 'payment.updated':
        await onPayment(obj.payment); break;
      case 'refund.created':
      case 'refund.updated':
        await onRefund(obj.refund); break;
      case 'invoice.payment_made':
        await onInvoice(obj.invoice); break;
      case 'subscription.created':
      case 'subscription.updated':
        await onSubscription(obj.subscription); break;
      default:
        break; // an event we did not ask for: acknowledge it so Square stops retrying
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    // A non-2xx answer makes Square retry later. Every handler above is safe to run twice.
    console.error('square-webhook: ' + event.type + ' failed', err && err.message);
    return res.status(500).json({ ok: false });
  }
};

module.exports = handler;
// VERIFY: this is the Next.js form of "do not parse the body". It is exported
// because it is harmless if ignored; see the raw-body note at the top.
module.exports.config = { api: { bodyParser: false } };
