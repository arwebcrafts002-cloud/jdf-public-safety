/**
 * POST /api/intake
 * One endpoint for every form on the site. Stores the submission in Postgres
 * (Supabase REST) and emails staff through Resend.
 *
 * Zero npm dependencies: Vercel runs this file as a Node serverless function
 * next to the static site.
 *
 * Environment variables (Vercel > Project > Settings > Environment Variables):
 *   SUPABASE_URL                 https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY    server-side only, never shipped to the browser
 *   RESEND_API_KEY               optional; without it nothing is emailed
 *   EMAIL_FROM                   e.g. "JDF Public Safety <info@jdfpublicsafety.org>"
 *   STAFF_NOTIFY_TO              comma-separated staff inboxes
 *
 * If the database variables are missing the endpoint answers 503, and the
 * site tells the visitor to call or email instead. It never pretends.
 */

// Supabase keys: a new secret key (sb_secret_...) goes on the apikey header only.
// A legacy service_role JWT goes on both headers. `bearer` is a signed-in user's token.
const sbHeaders = (key, bearer) => Object.assign(
  { apikey: key },
  bearer ? { Authorization: 'Bearer ' + bearer } : (String(key).startsWith('sb_') ? {} : { Authorization: 'Bearer ' + key })
);

const TYPES = {
  donation_intent: 'donation_intents',
  report: 'concern_reports',
  contact: 'contact_messages',
  newsletter: 'subscribers',
};

const clean = (v, max = 2000) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const email = (v) => {
  const e = clean(v, 254);
  return e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e.toLowerCase() : undefined;
};

/* Giving levels (placeholders pending approval). Same table as js/donate.js.
   The level is always recomputed here from the amount; the browser's value is
   never trusted. Levels apply to one-time gifts only. Whether a founding seat
   is actually still open is decided when the gift is paid, by
   assign_founder_number() in db/founders.sql, not here. */
const TIER_MINS = [['founder', 3600], ['shield', 1800], ['guardian', 618], ['supporter', 360], ['friend', 180]];
const SHIRT_TIERS = ['guardian', 'shield', 'founder'];
const SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
const MERCH_FIELDS = ['tier', 'merch_opt_out', 'shirt_size', 'ship_name', 'ship_address1', 'ship_address2', 'ship_city', 'ship_state', 'ship_postal', 'wall_display_name'];

function tierFor(amount, frequency) {
  if (frequency !== 'once') return null;
  const hit = TIER_MINS.find(([, min]) => amount >= min);
  return hit ? hit[0] : null;
}

function merch(b, amount, frequency) {
  const tier = tierFor(amount, frequency);
  const optOut = !tier || b.merch_opt_out !== false;       // items ship only on an explicit "false"
  // Validate the whole value before any trimming to length, so 'California' is not cut down to a valid-looking 'CA'.
  const raw = (v) => (typeof v === 'string' ? v.trim() : '');
  const state = raw(b.ship_state);
  const postal = raw(b.ship_postal);
  const size = raw(b.shirt_size).toUpperCase();
  const out = {
    tier,
    merch_opt_out: optOut,
    shirt_size: !optOut && SHIRT_TIERS.includes(tier) && SHIRT_SIZES.includes(size) ? size : null,
    ship_name: optOut ? null : clean(b.ship_name, 120) || null,
    ship_address1: optOut ? null : clean(b.ship_address1, 160) || null,
    ship_address2: optOut ? null : clean(b.ship_address2, 160) || null,
    ship_city: optOut ? null : clean(b.ship_city, 80) || null,
    ship_state: !optOut && state && /^[A-Za-z]{2}$/.test(state) ? state.toUpperCase() : null,
    ship_postal: !optOut && postal && /^\d{5}(-\d{4})?$/.test(postal) ? postal : null,
    wall_display_name: tier === 'founder' ? (b.anonymous ? 'Anonymous founder' : clean(b.wall_display_name, 80) || null) : null,
  };
  // An incomplete address is stored as given (invalid parts become null) and never
  // rejected: the donor is already on their way to checkout, and staff can follow up.
  return out;
}

function row(type, b, meta) {
  if (type === 'donation_intent') {
    const amount = Number(b.amount);
    if (!email(b.email) || !(amount >= 1 && amount <= 250000)) return null;
    const frequency = b.frequency === 'monthly' ? 'monthly' : 'once';
    const m = merch(b, amount, frequency);
    if (!m) return null;
    return {
      ...m,
      first_name: clean(b.first_name, 80),
      last_name: clean(b.last_name, 80),
      email: email(b.email),
      phone: clean(b.phone, 40),
      amount_cents: Math.round(amount * 100),
      frequency,
      dedication_type: ['honor', 'memory'].includes(b.dedication_type) ? b.dedication_type : null,
      dedication_name: clean(b.dedication_name, 160),
      is_anonymous: !!b.anonymous,
      newsletter_opt_in: !!b.newsletter,
      sms_consent: !!b.sms_consent,
      ...meta,
    };
  }
  if (type === 'report') {
    if (!clean(b.description)) return null;
    return {
      reporter_name: clean(b.reporter_name, 160),
      reporter_email: email(b.reporter_email),
      reporter_phone: clean(b.reporter_phone, 40),
      concern_type: clean(b.concern_type, 80),
      location: clean(b.location, 300),
      incident_datetime: clean(b.incident_datetime, 40),
      description: clean(b.description, 6000),
      ...meta,
    };
  }
  if (type === 'contact') {
    if (!email(b.email || b.reporter_email) || !clean(b.message || b.description)) return null;
    const rest = {};
    for (const k of Object.keys(b).slice(0, 20)) {
      if (k !== 'type' && k !== 'page' && k !== 'website' && typeof b[k] === 'string') rest[k.slice(0, 40)] = b[k].slice(0, 500);
    }
    return {
      name: clean(b.name || b.reporter_name, 160),
      email: email(b.email || b.reporter_email),
      phone: clean(b.phone || b.reporter_phone, 40),
      message: clean(b.message || b.description, 6000),
      payload: rest,
      ...meta,
    };
  }
  if (type === 'newsletter') {
    if (!email(b.email)) return null;
    return { email: email(b.email), first_name: clean(b.first_name, 80), source: clean(b.page, 120), ...meta };
  }
  return null;
}

async function insert(table, record) {
  const res = await fetch(process.env.SUPABASE_URL + '/rest/v1/' + table + (table === 'subscribers' ? '?on_conflict=email' : ''), {
    method: 'POST',
    headers: {
      ...sbHeaders(process.env.SUPABASE_SERVICE_ROLE_KEY),
      'Content-Type': 'application/json',
      Prefer: table === 'subscribers' ? 'resolution=ignore-duplicates,return=minimal' : 'return=minimal',
    },
    body: JSON.stringify(record),
  });
  if (res.ok) return;
  const text = await res.text();
  // db/founders.sql not applied yet: the level and shipping columns do not exist.
  // Store the gift without them rather than lose the donor's details.
  if (table === 'donation_intents' && /PGRST204|42703/.test(text) && MERCH_FIELDS.some((k) => k in record)) {
    const slim = Object.assign({}, record);
    MERCH_FIELDS.forEach((k) => delete slim[k]);
    console.error('intake: merch columns missing, stored without them. Run db/founders.sql.');
    return insert(table, slim);
  }
  throw new Error('db ' + res.status + ': ' + text);
}

async function notifyStaff(type, record) {
  if (type === 'report') record = { notice: 'A new concern report was submitted. Read it in the database; contents are not emailed.', concern_type: record.concern_type };
  if (!process.env.RESEND_API_KEY || !process.env.STAFF_NOTIFY_TO || !process.env.EMAIL_FROM) return;
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const lines = Object.entries(record)
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && typeof v !== 'object')
    .map(([k, v]) => '<tr><td style="padding:4px 12px 4px 0;color:#64748b">' + esc(k) + '</td><td style="padding:4px 0"><b>' + esc(v) + '</b></td></tr>')
    .join('');
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: process.env.STAFF_NOTIFY_TO.split(',').map((s) => s.trim()).filter(Boolean),
      subject: '[JDF site] New ' + type.replace('_', ' '),
      html: '<table style="font:14px/1.5 Arial,sans-serif">' + lines + '</table>',
    }),
  }).catch(() => {});
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ ok: false, error: 'bad_json' });

  // Honeypot: a hidden field people never see. Bots fill it; answer OK and store nothing.
  if (typeof body.website === 'string' && body.website.trim()) return res.status(200).json({ ok: true });

  const table = Object.prototype.hasOwnProperty.call(TYPES, body.type) ? TYPES[body.type] : null;
  if (!table) return res.status(400).json({ ok: false, error: 'unknown_type' });

  const meta = { page: clean(body.page, 120), user_agent: clean(req.headers['user-agent'], 300) };
  const record = row(body.type, body, meta);
  if (!record) return res.status(422).json({ ok: false, error: 'invalid_fields' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ ok: false, error: 'storage_not_configured' });
  }

  try {
    await insert(table, record);
    if (body.type === 'donation_intent' && record.newsletter_opt_in) {
      await insert('subscribers', {
        email: record.email, first_name: record.first_name, source: 'donate', page: meta.page, user_agent: meta.user_agent,
      }).catch(() => {});
    }
    await notifyStaff(body.type, record);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('intake failed', String(err && err.message).slice(0, 12));
    return res.status(502).json({ ok: false, error: 'storage_failed' });
  }
};
