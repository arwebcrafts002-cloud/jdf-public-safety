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

function row(type, b, meta) {
  if (type === 'donation_intent') {
    const amount = Number(b.amount);
    if (!email(b.email) || !(amount >= 1 && amount <= 250000)) return null;
    return {
      first_name: clean(b.first_name, 80),
      last_name: clean(b.last_name, 80),
      email: email(b.email),
      phone: clean(b.phone, 40),
      amount_cents: Math.round(amount * 100),
      frequency: b.frequency === 'monthly' ? 'monthly' : 'once',
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
    const rest = Object.assign({}, b);
    delete rest.type;
    delete rest.page;
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
  const res = await fetch(process.env.SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: table === 'subscribers' ? 'resolution=ignore-duplicates,return=minimal' : 'return=minimal',
    },
    body: JSON.stringify(record),
  });
  if (!res.ok) throw new Error('db ' + res.status + ': ' + (await res.text()));
}

async function notifyStaff(type, record) {
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

  const table = TYPES[body.type];
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
    console.error('intake failed', err);
    return res.status(502).json({ ok: false, error: 'storage_failed' });
  }
};
