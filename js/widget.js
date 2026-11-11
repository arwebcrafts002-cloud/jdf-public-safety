/* ============================================================
   JDF PUBLIC SAFETY: HELP WIDGET
   A floating "Ask us a question" button on every page. The
   visitor picks a topic, types a question and leaves an email,
   without leaving the site. It posts to /api/intake (type
   "contact"), which stores the message and emails staff.
   If that endpoint is not live, the widget says so and offers
   an email link with the message already filled in, so a
   question is never silently lost.
   ============================================================ */
(function () {
  'use strict';
  if (document.body.getAttribute('data-portal') === 'admin') return;

  var TOPICS = ['General question', 'Donations and receipts', 'Founders Club', 'Training and classes', 'Request coverage for an institution', 'Volunteering', 'Press', 'Website problem'];
  var EMAIL = 'info@jdfpublicsafety.org';

  var root = document.createElement('div');
  root.className = 'w-root';
  root.innerHTML =
    '<button class="w-fab" type="button" aria-expanded="false" aria-controls="w-panel">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.800 7L4 20l1.200-4.600A8 8 0 1 1 21 12Z"/><path d="M9.500 9.500a2.500 2.500 0 1 1 3.500 2.300c-.700.300-1 .800-1 1.500M12 16.500h.010"/></svg>' +
      '<span>Ask us</span></button>' +
    '<section class="w-panel" id="w-panel" role="dialog" aria-label="Ask JDF a question" hidden>' +
      '<header><div><b>Ask us a question</b><small>We reply by email.</small></div><button type="button" class="w-x" aria-label="Close">&times;</button></header>' +
      '<p class="w-911">Not for emergencies. For an emergency call <a href="tel:911">911</a>, then the hotline <a href="tel:2132600061">(213) 260-0061</a>.</p>' +
      '<form novalidate>' +
        '<label for="w-topic">Topic</label><select id="w-topic" name="topic">' + TOPICS.map(function (t) { return '<option>' + t + '</option>'; }).join('') + '</select>' +
        '<label for="w-msg">Your question</label><textarea id="w-msg" name="message" rows="4" maxlength="2000" required></textarea>' +
        '<label for="w-name">Name (optional)</label><input id="w-name" name="name" autocomplete="name" maxlength="120">' +
        '<label for="w-email">Email</label><input id="w-email" name="email" type="email" autocomplete="email" required>' +
        '<input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="w-hp">' +
        '<button class="btn gold w-send" type="submit">Send question</button>' +
        '<p class="w-note" role="status" aria-live="polite"></p>' +
      '</form>' +
      '<div class="w-done" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg><b>Question sent</b><p>Thank you. We will reply to the email address you gave.</p><button type="button" class="w-again">Ask another</button></div>' +
    '</section>';
  document.body.appendChild(root);

  var fab = root.querySelector('.w-fab'), panel = root.querySelector('.w-panel'), form = root.querySelector('form'),
      note = root.querySelector('.w-note'), done = root.querySelector('.w-done'), send = root.querySelector('.w-send');

  function open(yes) {
    panel.hidden = !yes;
    fab.setAttribute('aria-expanded', yes ? 'true' : 'false');
    root.classList.toggle('is-open', yes);
    if (yes) setTimeout(function () { form.elements.message.focus(); }, 60); else fab.focus();
  }
  fab.addEventListener('click', function () { open(panel.hidden); });
  root.querySelector('.w-x').addEventListener('click', function () { open(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) open(false); });
  root.querySelector('.w-again').addEventListener('click', function () { done.hidden = true; form.hidden = false; form.reset(); note.textContent = ''; });

  // Any link on the site can open the widget: <a href="#ask">
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href="#ask"]');
    if (a) { e.preventDefault(); open(true); }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = form.elements, msg = f.message.value.trim(), email = f.email.value.trim();
    f.message.classList.toggle('bad', !msg);
    var badEmail = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
    f.email.classList.toggle('bad', badEmail);
    if (!msg || badEmail) { note.className = 'w-note bad'; note.textContent = !msg ? 'Type your question first.' : 'Enter an email address so we can reply.'; return; }

    send.disabled = true; send.textContent = 'Sending…'; note.textContent = '';
    var payload = { type: 'contact', page: location.pathname, source: 'help-widget', topic: f.topic.value, message: msg, name: f.name.value.trim(), email: email, website: f.website.value };

    fetch('/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { if (!r.ok) throw new Error('not sent'); form.hidden = true; done.hidden = false; })
      .catch(function () {
        var href = 'mailto:' + EMAIL + '?subject=' + encodeURIComponent('[' + f.topic.value + '] Question from the website') + '&body=' + encodeURIComponent(msg + '\n\n' + (f.name.value.trim() ? f.name.value.trim() + '\n' : '') + email);
        note.className = 'w-note bad';
        note.innerHTML = 'We could not send this from the site. <a href="' + href.replace(/"/g, '%22') + '">Send it from your email app instead</a>, or call (213) 260-0061.';
      })
      .then(function () { send.disabled = false; send.textContent = 'Send question'; });
  });
})();
