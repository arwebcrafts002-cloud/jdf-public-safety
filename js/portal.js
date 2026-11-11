/* ============================================================
   JDF PUBLIC SAFETY: MEMBER PORTAL
   Drives account.html (sign in / create account), trainings.html
   (schedule + registration) and admin.html (staff).
   Needs js/config.js and the Supabase JS client loaded first.
   All access rules live in the database (db/training.sql); this
   file only shows what the database agrees to return.
   ============================================================ */
(function () {
  'use strict';

  var cfg = window.JDF_CONFIG || {};
  var page = document.body.getAttribute('data-portal');
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var show = function (id) { $$('[data-view]').forEach(function (v) { v.hidden = v.getAttribute('data-view') !== id; }); };
  var say = function (el, msg, bad) { if (!el) return; el.textContent = msg || ''; el.className = 'p-msg' + (msg ? (bad ? ' bad' : ' ok') : ''); };

  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) { show('offline'); return; }
  var db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  var fmtDate = function (iso) { return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); };
  var fmtTime = function (iso) { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
  var money = function (c) { return c > 0 ? '$' + (c / 100).toFixed(c % 100 ? 2 : 0) : 'Free'; };

  function profile(uid) {
    return db.from('profiles').select('id,email,full_name,phone,status,role').eq('id', uid).maybeSingle().then(function (r) { return r.data; });
  }

  /* ---------------- account.html ---------------------------- */
  function account() {
    var msg = $('#p-auth-msg');
    $$('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('[data-tab]').forEach(function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
        $$('[data-form]').forEach(function (f) { f.hidden = f.getAttribute('data-form') !== b.getAttribute('data-tab'); });
        say(msg, '');
      });
    });

    $('#p-signin').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target; say(msg, 'Signing in…');
      db.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value }).then(function (r) {
        if (r.error) return say(msg, 'That email and password do not match an account.', true);
        location.href = 'trainings.html';
      });
    });

    $('#p-signup').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target;
      if (f.password.value.length < 10) return say(msg, 'Use a password of at least 10 characters.', true);
      say(msg, 'Creating your account…');
      db.auth.signUp({
        email: f.email.value.trim(), password: f.password.value,
        options: { data: { full_name: f.full_name.value.trim(), phone: f.phone.value.trim() }, emailRedirectTo: location.origin + '/trainings.html' }
      }).then(function (r) {
        if (r.error) return say(msg, r.error.message, true);
        f.reset();
        say(msg, r.data.session ? 'Account created.' : 'Check your email and click the link to confirm your address. Then sign in.');
        if (r.data.session) location.href = 'trainings.html';
      });
    });

    $('#p-forgot').addEventListener('click', function () {
      var email = $('#p-signin').email.value.trim();
      if (!email) return say(msg, 'Enter your email above first.', true);
      db.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/account.html' }).then(function () {
        say(msg, 'If that address has an account, a reset link is on its way.');
      });
    });

    db.auth.onAuthStateChange(function (event) {
      if (event !== 'PASSWORD_RECOVERY') return;
      var pw = window.prompt('Choose a new password (at least 10 characters)');
      if (pw && pw.length >= 10) db.auth.updateUser({ password: pw }).then(function (r) { say(msg, r.error ? r.error.message : 'Password updated. You are signed in.', !!r.error); });
    });

    db.auth.getSession().then(function (r) { if (r.data.session && !/type=recovery/.test(location.hash)) location.href = 'trainings.html'; else show('auth'); });
  }

  /* ---------------- trainings.html -------------------------- */
  function trainings(session) {
    var uid = session.user.id, me, list = $('#p-sessions'), mine = $('#p-mine'), msg = $('#p-msg');

    function load() {
      Promise.all([
        db.from('training_sessions').select('id,title,starts_at,ends_at,capacity,price_cents,area,training_tracks(name,audience)').eq('status', 'scheduled').gt('starts_at', new Date().toISOString()).order('starts_at'),
        db.rpc('session_availability'),
        db.from('registrations').select('session_id,status,payment_status').eq('user_id', uid).neq('status', 'cancelled'),
        db.from('session_locations').select('session_id,venue,address,arrival_notes')
      ]).then(function (r) {
        var sessions = r[0].data || [], taken = {}, reg = {}, loc = {};
        (r[1].data || []).forEach(function (a) { taken[a.session_id] = a.taken; });
        (r[2].data || []).forEach(function (a) { reg[a.session_id] = a; });
        (r[3].data || []).forEach(function (a) { loc[a.session_id] = a; });

        if (!sessions.length) { list.innerHTML = '<p class="p-empty">No sessions are scheduled yet. New dates are announced by email to members.</p>'; }
        else list.innerHTML = sessions.map(function (s) {
          var left = Math.max(0, s.capacity - (taken[s.id] || 0)), mineReg = reg[s.id], l = loc[s.id], t = s.training_tracks || {};
          var action = mineReg
            ? '<span class="p-pill ' + (mineReg.status === 'confirmed' ? 'ok' : 'wait') + '">' + (mineReg.status === 'confirmed' ? 'You are registered' : 'On the waitlist') + '</span><button class="p-link" data-cancel="' + s.id + '">Cancel my seat</button>'
            : (me.status === 'approved'
              ? '<button class="btn gold" data-register="' + s.id + '">' + (left ? 'Register' : 'Join waitlist') + '</button>'
              : '<span class="p-pill wait">Available once your account is approved</span>');
          return '<article class="p-session">' +
            '<div class="p-when"><b>' + esc(fmtDate(s.starts_at)) + '</b><span>' + esc(fmtTime(s.starts_at)) + (s.ends_at ? ' to ' + esc(fmtTime(s.ends_at)) : '') + '</span></div>' +
            '<div class="p-what"><h3>' + esc(s.title || t.name) + '</h3><p>' + esc(t.name || '') + (t.audience ? ' · ' + esc(t.audience) : '') + (s.area ? ' · ' + esc(s.area) : '') + '</p>' +
            (l ? '<p class="p-loc"><b>' + esc(l.venue) + '</b> ' + esc(l.address) + (l.arrival_notes ? '<br>' + esc(l.arrival_notes) : '') + '</p>' : '<p class="p-loc muted">Location is shared after your seat is confirmed.</p>') + '</div>' +
            '<div class="p-act"><span class="p-seats">' + (left ? left + ' of ' + s.capacity + ' seats open' : 'Full') + ' · ' + money(s.price_cents) + '</span>' + action + '</div></article>';
        }).join('');

        var n = Object.keys(reg).length;
        mine.textContent = n ? 'You hold ' + n + ' upcoming ' + (n === 1 ? 'registration' : 'registrations') + '.' : 'You have no upcoming registrations.';
      });
    }

    list.addEventListener('click', function (e) {
      var r = e.target.getAttribute('data-register'), c = e.target.getAttribute('data-cancel');
      if (r) {
        e.target.disabled = true;
        db.rpc('register_for_session', { p_session: r }).then(function (res) {
          if (res.error) return say(msg, res.error.message === 'not_approved' ? 'Your account is still waiting for approval.' : 'That session is no longer available.', true);
          say(msg, res.data === 'confirmed' ? 'Your seat is confirmed. The location is now shown below, and a confirmation email is on its way.' : 'The session is full. You are on the waitlist.');
          db.auth.getSession().then(function (s) {
            fetch('/api/training-notify', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.data.session.access_token }, body: JSON.stringify({ session_id: r }) }).catch(function () {});
          });
          load();
        });
      }
      if (c && window.confirm('Cancel your seat in this session?')) db.rpc('cancel_registration', { p_session: c }).then(function () { say(msg, 'Your seat was cancelled.'); load(); });
    });

    profile(uid).then(function (p) {
      me = p || { status: 'pending' };
      $('#p-hello').textContent = me.full_name ? 'Welcome, ' + me.full_name.split(' ')[0] : 'Welcome';
      $('#p-status').hidden = me.status === 'approved';
      $('#p-status').textContent = me.status === 'blocked' ? 'This account cannot register for training. Call (213) 260-0061 with questions.' : 'Your account is waiting for approval. JDF confirms every new member before sharing class locations. You will get an email when you are approved.';
      if (me.role === 'staff') $('#p-admin-link').hidden = false;
      show('portal'); load();
    });
  }

  /* ---------------- admin.html ------------------------------ */
  function admin(session) {
    var msg = $('#a-msg');
    profile(session.user.id).then(function (p) {
      if (!p || p.role !== 'staff') { show('denied'); return; }
      show('admin'); members(); sessions(); tracks();
    });

    function members() {
      db.from('profiles').select('id,email,full_name,phone,status,role,created_at').order('created_at', { ascending: false }).then(function (r) {
        $('#a-members').innerHTML = (r.data || []).map(function (m) {
          return '<tr><td><b>' + esc(m.full_name || 'No name given') + '</b><br>' + esc(m.email) + (m.phone ? '<br>' + esc(m.phone) : '') + '</td><td>' + esc(new Date(m.created_at).toLocaleDateString()) + '</td><td><span class="p-pill ' + (m.status === 'approved' ? 'ok' : 'wait') + '">' + esc(m.status) + '</span>' + (m.role === 'staff' ? ' <span class="p-pill ok">staff</span>' : '') + '</td><td>' +
            (m.status !== 'approved' ? '<button class="p-link" data-set="approved" data-id="' + m.id + '">Approve</button> ' : '') +
            (m.status !== 'blocked' ? '<button class="p-link bad" data-set="blocked" data-id="' + m.id + '">Block</button>' : '') + '</td></tr>';
        }).join('') || '<tr><td colspan="4">No accounts yet.</td></tr>';
      });
    }
    $('#a-members').addEventListener('click', function (e) {
      var s = e.target.getAttribute('data-set'); if (!s) return;
      db.from('profiles').update({ status: s, approved_at: s === 'approved' ? new Date().toISOString() : null }).eq('id', e.target.getAttribute('data-id')).then(function (r) { say(msg, r.error ? r.error.message : 'Member ' + s + '.', !!r.error); members(); });
    });

    function tracks() {
      db.from('training_tracks').select('id,name').order('sort').then(function (r) {
        $('#a-track').innerHTML = (r.data || []).map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + '</option>'; }).join('');
      });
    }

    function sessions() {
      Promise.all([
        db.from('training_sessions').select('id,title,starts_at,capacity,status,training_tracks(name),session_locations(venue,address),registrations(status,profiles(full_name,email,phone))').order('starts_at'),
      ]).then(function (r) {
        $('#a-sessions').innerHTML = ((r[0].data) || []).map(function (s) {
          var regs = (s.registrations || []).filter(function (x) { return x.status !== 'cancelled'; }), l = s.session_locations;
          if (Array.isArray(l)) l = l[0];
          return '<details class="p-admin-session"><summary><b>' + esc(fmtDate(s.starts_at)) + ', ' + esc(fmtTime(s.starts_at)) + '</b> ' + esc(s.title || (s.training_tracks || {}).name) + ' <span class="p-pill ' + (s.status === 'scheduled' ? 'ok' : 'wait') + '">' + esc(s.status) + '</span> ' + regs.length + ' of ' + s.capacity + '</summary>' +
            '<p class="p-loc">' + (l ? '<b>' + esc(l.venue) + '</b> ' + esc(l.address) : 'No location set') + '</p><ul>' +
            (regs.map(function (x) { var p = x.profiles || {}; return '<li>' + esc(p.full_name || p.email) + ' · ' + esc(p.email) + (p.phone ? ' · ' + esc(p.phone) : '') + ' <span class="p-pill ' + (x.status === 'confirmed' ? 'ok' : 'wait') + '">' + esc(x.status) + '</span></li>'; }).join('') || '<li>No registrations yet.</li>') +
            '</ul>' + (s.status === 'scheduled' ? '<button class="p-link bad" data-cancel-session="' + s.id + '">Cancel this session</button>' : '') + '</details>';
        }).join('') || '<p class="p-empty">No sessions yet. Add the first one below.</p>';
      });
    }
    $('#a-sessions').addEventListener('click', function (e) {
      var id = e.target.getAttribute('data-cancel-session');
      if (id && window.confirm('Cancel this session? Registered members are not emailed automatically yet.')) db.from('training_sessions').update({ status: 'cancelled' }).eq('id', id).then(sessions);
    });

    $('#a-new').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, start = new Date(f.date.value + 'T' + f.start.value), end = f.end.value ? new Date(f.date.value + 'T' + f.end.value) : null;
      db.from('training_sessions').insert({ track_id: f.track.value, title: f.title.value.trim() || null, starts_at: start.toISOString(), ends_at: end ? end.toISOString() : null, capacity: Number(f.capacity.value) || 12, price_cents: Math.round((Number(f.price.value) || 0) * 100), area: f.area.value.trim() || null })
        .select('id').single().then(function (r) {
          if (r.error) return say(msg, r.error.message, true);
          return db.from('session_locations').insert({ session_id: r.data.id, venue: f.venue.value.trim(), address: f.address.value.trim(), arrival_notes: f.notes.value.trim() || null }).then(function (l) {
            say(msg, l.error ? l.error.message : 'Session added.', !!l.error); if (!l.error) f.reset(); sessions();
          });
        });
    });
  }

  /* ---------------- boot ------------------------------------ */
  $$('[data-signout]').forEach(function (b) { b.addEventListener('click', function () { db.auth.signOut().then(function () { location.href = 'account.html'; }); }); });

  if (page === 'account') return account();
  db.auth.getSession().then(function (r) {
    if (!r.data.session) { location.href = 'account.html'; return; }
    if (page === 'trainings') trainings(r.data.session);
    if (page === 'admin') admin(r.data.session);
  });
})();
