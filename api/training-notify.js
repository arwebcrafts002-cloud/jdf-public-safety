/**
 * POST /api/training-notify   { session_id }
 * Header: Authorization: Bearer <the member's Supabase access token>
 *
 * Sends the member a confirmation email for a session they just registered
 * for, and alerts staff. The caller's identity comes from their token, and
 * the registration is re-read from the database with the service key, so a
 * visitor cannot trigger an email about someone else's seat or learn a
 * location they have no confirmed seat for.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, EMAIL_FROM,
 *      STAFF_NOTIFY_TO (optional).
 */

// Supabase keys: a new secret key (sb_secret_...) goes on the apikey header only.
// A legacy service_role JWT goes on both headers. `bearer` is a signed-in user's token.
const sbHeaders = (key, bearer) => Object.assign(
  { apikey: key },
  bearer ? { Authorization: 'Bearer ' + bearer } : (String(key).startsWith('sb_') ? {} : { Authorization: 'Bearer ' + key })
);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

async function sb(path, token) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(process.env.SUPABASE_URL + path, {
    headers: sbHeaders(key, token),
  });
  if (!res.ok) throw new Error('supabase ' + res.status);
  return res.json();
}

async function send(to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, html }),
  });
  if (!r.ok) throw new Error('resend ' + r.status);
}

// Claim the one confirmation email for this registration. Returns true only for
// the first caller, so replaying the request cannot send more mail.
async function claim(sessionId, userId) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/registrations?session_id=eq.' + sessionId + '&user_id=eq.' + userId + '&notified_at=is.null&status=neq.cancelled', {
    method: 'PATCH',
    headers: { ...sbHeaders(key), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ notified_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error('supabase ' + r.status);
  return (await r.json()).length > 0;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false }); }
  const env = process.env;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const sessionId = body && typeof body.session_id === 'string' ? body.session_id : '';
  if (!token || !/^[0-9a-f-]{36}$/i.test(sessionId)) return res.status(400).json({ ok: false, error: 'bad_request' });

  try {
    let user;
    try { user = await sb('/auth/v1/user', token); } catch (e) { return res.status(401).json({ ok: false, error: 'not_signed_in' }); }
    if (!user || !/^[0-9a-f-]{36}$/i.test(String(user.id))) return res.status(401).json({ ok: false, error: 'not_signed_in' });

    // The member must still be approved. A blocked member gets nothing, even with an old token.
    const prof = await sb('/rest/v1/profiles?select=status&id=eq.' + user.id);
    if (!prof[0] || prof[0].status !== 'approved' || !user.email_confirmed_at) return res.status(403).json({ ok: false, error: 'not_approved' });
    const regs = await sb('/rest/v1/registrations?select=status&session_id=eq.' + sessionId + '&user_id=eq.' + user.id);
    if (!regs.length || regs[0].status === 'cancelled') return res.status(404).json({ ok: false, error: 'no_registration' });

    const sessions = await sb('/rest/v1/training_sessions?select=title,status,starts_at,ends_at,training_tracks(name),session_locations(venue,address,arrival_notes)&id=eq.' + sessionId);
    const s = sessions[0];
    if (!s || s.status !== 'scheduled' || new Date(s.starts_at) < new Date()) return res.status(404).json({ ok: false, error: 'no_session' });
    if (!(await claim(sessionId, user.id))) return res.status(200).json({ ok: true, already_sent: true });
    let loc = s.session_locations;
    if (Array.isArray(loc)) loc = loc[0];
    const confirmed = regs[0].status === 'confirmed';
    const name = s.title || (s.training_tracks && s.training_tracks.name) || 'JDF training';
    const when = new Date(s.starts_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

    const html =
      '<div style="font:16px/1.6 Arial,sans-serif;color:#0b1329;max-width:560px">' +
      '<h2 style="margin:0 0 12px">' + (confirmed ? 'Your seat is confirmed' : 'You are on the waitlist') + '</h2>' +
      '<p><b>' + esc(name) + '</b><br>' + esc(when) + ' (Pacific)</p>' +
      (confirmed && loc ? '<p><b>' + esc(loc.venue) + '</b><br>' + esc(loc.address) + (loc.arrival_notes ? '<br>' + esc(loc.arrival_notes) : '') + '</p><p>Please do not forward or post this location.</p>'
        : '<p>We will email you if a seat opens. The location is shared only once a seat is confirmed.</p>') +
      '<p>Questions: Public Safety Hotline (213) 260-0061. For an emergency, call 911.</p>' +
      '<p style="color:#64748b;font-size:13px">JDF Public Safety</p></div>';

    await send([user.email], (confirmed ? 'Confirmed: ' : 'Waitlist: ') + name, html);
    if (env.STAFF_NOTIFY_TO) {
      await send(env.STAFF_NOTIFY_TO.split(',').map((x) => x.trim()).filter(Boolean), '[JDF site] Training registration: ' + name,
        '<p style="font:14px Arial,sans-serif">' + esc(user.email) + ' is ' + esc(regs[0].status) + ' for ' + esc(name) + ', ' + esc(when) + '.</p>');
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('training-notify failed', String(err && err.message).slice(0, 12));
    return res.status(502).json({ ok: false, error: 'failed' });
  }
};
