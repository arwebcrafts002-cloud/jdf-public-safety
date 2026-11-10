/* ============================================================
   JDF PUBLIC SAFETY — MAIN JS
   ============================================================ */

(function () {
  'use strict';

  /* ---------- Mobile Nav Toggle ----------------------------- */
  const hamburger = document.querySelector('.hamburger');
  const mobileNav = document.querySelector('.mobile-nav');

  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', function () {
      hamburger.classList.toggle('open');
      mobileNav.classList.toggle('open');
      hamburger.setAttribute('aria-expanded',
        mobileNav.classList.contains('open') ? 'true' : 'false'
      );
    });
  }

  /* ---------- Active Nav Link Detection --------------------- */
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';

  // Direct nav items
  document.querySelectorAll('nav.main-nav .nav-item, .mobile-nav a').forEach(function (link) {
    const href = link.getAttribute('href');
    if (href && (href === currentPage || (currentPage === '' && href === 'index.html'))) {
      link.classList.add('active');
    }
  });

  // Dropdown links & parent dropdown highlight
  document.querySelectorAll('.dropdown-link').forEach(function (link) {
    const href = link.getAttribute('href');
    if (href && href.split('#')[0] === currentPage) {
      link.classList.add('active');
      const parentDropdown = link.closest('.nav-dropdown');
      if (parentDropdown) {
        parentDropdown.classList.add('active');
      }
    }
  });

  /* ---------- Dropdown Toggle & Auto-Close Logic ------------ */
  document.querySelectorAll('.nav-dropdown').forEach(function (dropdown) {
    const toggle = dropdown.querySelector('.dropdown-toggle');
    if (!toggle) return;

    toggle.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const isOpen = dropdown.classList.contains('is-open');
      document.querySelectorAll('.nav-dropdown').forEach(function (d) {
        d.classList.remove('is-open');
        const t = d.querySelector('.dropdown-toggle');
        if (t) t.setAttribute('aria-expanded', 'false');
      });
      if (!isOpen) {
        dropdown.classList.add('is-open');
        toggle.setAttribute('aria-expanded', 'true');
      }
    });

    dropdown.addEventListener('mouseleave', function () {
      dropdown.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.nav-dropdown')) {
      document.querySelectorAll('.nav-dropdown').forEach(function (d) {
        d.classList.remove('is-open');
        const toggle = d.querySelector('.dropdown-toggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      });
    }
  });

  window.addEventListener('scroll', function () {
    document.querySelectorAll('.nav-dropdown').forEach(function (d) {
      d.classList.remove('is-open');
      const toggle = d.querySelector('.dropdown-toggle');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    });
  }, { passive: true });

  /* ---------- Contact / Report Form Validation -------------- */
  document.querySelectorAll('form.jdf-form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const btn = form.querySelector('[type="submit"]');
      const originalText = btn ? btn.textContent : '';

      // Basic validation
      let valid = true;
      form.querySelectorAll('[required]').forEach(function (field) {
        if (!field.value.trim()) {
          field.style.borderColor = '#ef4444';
          valid = false;
        } else {
          field.style.borderColor = '';
        }
      });

      if (!valid) {
        alert('Please fill in all required fields.');
        return;
      }

      if (btn) {
        btn.textContent = 'Submitting…';
        btn.disabled = true;
      }

      // Send to the intake endpoint. Never show a success message unless
      // the submission was actually stored.
      var payload = { type: form.getAttribute('data-intake') || 'contact', page: location.pathname };
      new FormData(form).forEach(function (v, k) { if (typeof v === 'string') payload[k] = v.trim(); });

      function note(ok) {
        var old = form.querySelector('.form-result'); if (old) old.remove();
        var msg = document.createElement('div');
        msg.className = 'form-result';
        msg.setAttribute('role', 'status');
        msg.style.cssText = ok
          ? 'background:#064e3b;border:1px solid #10b981;color:#ecfdf5;padding:16px 20px;border-radius:8px;margin-top:18px;font-weight:700;font-size:14px;'
          : 'background:#7f1d1d;border:1px solid #f87171;color:#fef2f2;padding:16px 20px;border-radius:8px;margin-top:18px;font-weight:700;font-size:14px;line-height:1.6;';
        msg.innerHTML = ok
          ? 'Your submission has been received. Our team will review it promptly.'
          : 'We could not send this online. Please call the Public Safety Hotline at <a href="tel:2132600061" style="text-decoration:underline;">(213) 260-0061</a> or email <a href="mailto:info@jdfpublicsafety.org" style="text-decoration:underline;">info@jdfpublicsafety.org</a>. For an emergency, call 911.';
        form.appendChild(msg);
        if (ok) form.reset();
        if (btn) { btn.textContent = originalText; btn.disabled = false; }
      }

      fetch('/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function (r) { note(r.ok); })
        .catch(function () { note(false); });
    });
  });

  /* ---------- Smooth Scroll for Anchor Links ---------------- */
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId && targetId !== '#') {
        const target = document.querySelector(targetId);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  });

  /* Scroll animation now lives in js/motion.js */

})();
