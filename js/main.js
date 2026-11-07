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

      // Simulate submission feedback
      setTimeout(function () {
        const msg = document.createElement('div');
        msg.style.cssText = 'background:#064e3b;border:1px solid #10b981;color:#ecfdf5;padding:16px 20px;border-radius:4px;margin-top:18px;font-weight:700;font-size:14px;';
        msg.textContent = '✓ Your submission has been received. Our team will review it promptly.';
        form.appendChild(msg);
        form.reset();
        if (btn) {
          btn.textContent = originalText;
          btn.disabled = false;
        }
      }, 800);
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

  /* ---------- Animate on Scroll ------------------------------ */
  if ('IntersectionObserver' in window) {
    const style = document.createElement('style');
    style.textContent = '.fade-in{opacity:0;transform:translateY(20px);transition:opacity .5s ease,transform .5s ease}.fade-in.visible{opacity:1;transform:none}';
    document.head.appendChild(style);

    document.querySelectorAll('.card, .pillar, .program-card, .report-card, .support-card, .board-member').forEach(function (el) {
      el.classList.add('fade-in');
    });

    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('.fade-in').forEach(function (el) {
      observer.observe(el);
    });
  }

})();
