/* ============================================================
   JDF PUBLIC SAFETY: MOTION + INTERACTIVE LAYER
   No dependencies. Safe to load on every page: each feature
   checks for its own markup and does nothing if it is absent.
   ============================================================ */
(function () {
  'use strict';

  var doc = document, root = doc.documentElement;
  var reduce = (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) || /[?&]still(&|$)/.test(location.search);
  var fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var $ = function (s, c) { return (c || doc).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); };

  if (!reduce) root.classList.add('js-motion');

  /* ---------- Scroll progress + header + hero parallax ------ */
  var bar = doc.createElement('div');
  bar.className = 'x-progress';
  doc.body.appendChild(bar);
  var header = $('.site-header'), heroBg = null, sticky = null, ticking = false;

  function onScroll() {
    ticking = false;
    var y = window.scrollY || 0;
    var max = root.scrollHeight - window.innerHeight;
    bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, y / max) : 0) + ')';
    if (header) header.classList.toggle('is-scrolled', y > 40);
    if (heroBg && !reduce && y < window.innerHeight * 1.2) heroBg.style.setProperty('--x-par', (y * 0.18).toFixed(1) + 'px');
    if (sticky) sticky.classList.toggle('is-on', y > 520);
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });

  /* ---------- Hero: moving photo layer, word reveal, radar -- */
  var hero = $('.hero');
  if (hero) {
    var bg = hero.style.backgroundImage;
    if (bg && bg !== 'none') {
      heroBg = doc.createElement('div');
      heroBg.className = 'x-hero-bg';
      heroBg.style.backgroundImage = bg;
      hero.insertBefore(heroBg, hero.firstChild);
      hero.style.backgroundImage = 'none';
    }

    var h1 = $('h1', hero);
    if (h1 && !reduce) {
      var i = 0;
      (function split(node) {
        Array.prototype.slice.call(node.childNodes).forEach(function (n) {
          if (n.nodeType === 3) {
            var frag = doc.createDocumentFragment();
            n.textContent.split(/(\s+)/).forEach(function (part) {
              if (!part) return;
              if (/^\s+$/.test(part)) { frag.appendChild(doc.createTextNode(' ')); return; }
              var s = doc.createElement('span');
              s.className = 'x-w';
              s.style.setProperty('--i', i++);
              s.textContent = part;
              frag.appendChild(s);
            });
            node.replaceChild(frag, n);
          } else if (n.nodeType === 1 && n.tagName !== 'BR') { split(n); }
        });
      })(h1);
    }
    requestAnimationFrame(function () { requestAnimationFrame(function () { hero.classList.add('is-ready'); }); });

    if (!reduce) radar(hero);
  }

  function radar(host) {
    var c = doc.createElement('canvas');
    c.className = 'x-hero-fx';
    c.setAttribute('aria-hidden', 'true');
    host.insertBefore(c, host.querySelector('.container'));
    var ctx = c.getContext('2d'), w, h, dpr, pts = [], t0 = performance.now(), visible = true, raf;

    function size() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = host.clientWidth; h = host.clientHeight;
      c.width = w * dpr; c.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      pts = [];
      var n = Math.round(Math.min(46, w / 30));
      for (var k = 0; k < n; k++) pts.push({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - .5) * .22, vy: (Math.random() - .5) * .22, r: Math.random() * 1.6 + .6 });
    }
    function draw(now) {
      if (!visible) return;
      var t = Math.max(0, (now - t0) / 1000);
      ctx.clearRect(0, 0, w, h);
      var cx = w * 0.78, cy = h * 0.52, R = Math.max(w, h) * 0.5;

      ctx.lineWidth = 1;
      for (var r = 1; r <= 4; r++) {
        ctx.beginPath(); ctx.arc(cx, cy, (R / 4) * r, 0, 6.2832);
        ctx.strokeStyle = 'rgba(229,154,14,' + (0.16 - r * 0.025) + ')'; ctx.stroke();
      }
      var pulse = (t % 4) / 4;
      ctx.beginPath(); ctx.arc(cx, cy, R * pulse, 0, 6.2832);
      ctx.strokeStyle = 'rgba(229,154,14,' + (0.35 * (1 - pulse)) + ')'; ctx.lineWidth = 2; ctx.stroke();

      var a = t * 0.7;
      if (ctx.createConicGradient) {
        var g = ctx.createConicGradient(a, cx, cy);
        g.addColorStop(0, 'rgba(229,154,14,0)'); g.addColorStop(0.86, 'rgba(229,154,14,0)'); g.addColorStop(1, 'rgba(229,154,14,.24)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fill();
      }
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.strokeStyle = 'rgba(246,183,60,.55)'; ctx.lineWidth = 1.4; ctx.stroke();

      for (var k = 0; k < pts.length; k++) {
        var p = pts[k];
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        var ang = Math.atan2(p.y - cy, p.x - cx); if (ang < 0) ang += 6.2832;
        var d = ((a % 6.2832) - ang + 6.2832) % 6.2832;
        var lit = d < 1.1 ? 1 - d / 1.1 : 0;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r + lit * 2.2, 0, 6.2832);
        ctx.fillStyle = 'rgba(255,255,255,' + (0.16 + lit * 0.75) + ')'; ctx.fill();
        for (var j = k + 1; j < pts.length; j++) {
          var q = pts[j], dx = p.x - q.x, dy = p.y - q.y, dist = dx * dx + dy * dy;
          if (dist < 13000) {
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = 'rgba(148,163,184,' + (0.13 * (1 - dist / 13000)) + ')'; ctx.lineWidth = 1; ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    }
    size();
    window.addEventListener('resize', size);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (e) {
        visible = e[0].isIntersecting;
        cancelAnimationFrame(raf);
        if (visible) raf = requestAnimationFrame(draw);
      }).observe(host);
    }
    raf = requestAnimationFrame(draw);
  }

  /* ---------- Reveal on scroll (auto-tags existing markup) -- */
  var auto = [
    '.section .kicker', '.section h2', '.section .lead', '.section .body-copy', '.section-header',
    '.card', '.pillar', '.program-card', '.report-card', '.support-card', '.board-member', '.contact-item',
    '.op-model', '.coverage', '.form-col', '.contact-info', '.notice .container', '.footer-col', '.footer-brand'
  ].join(',');
  $$(auto).forEach(function (el) {
    if (el.closest('.hero') || el.hasAttribute('data-reveal')) return;
    el.setAttribute('data-reveal', '');
  });
  $$('[data-stagger]').forEach(function (group) {
    Array.prototype.slice.call(group.children).forEach(function (el, n) {
      if (!el.hasAttribute('data-reveal')) el.setAttribute('data-reveal', '');
      el.style.setProperty('--d', (n * 90) + 'ms');
    });
  });
  $$('.grid, .card-grid, .support-grid, .footer-grid').forEach(function (group) {
    Array.prototype.slice.call(group.children).forEach(function (el, n) { el.style.setProperty('--d', (n % 4 * 90) + 'ms'); });
  });

  var revealEls = $$('[data-reveal], [data-inview]');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('is-in');
        $$('[data-count]', en.target).concat(en.target.hasAttribute('data-count') ? [en.target] : []).forEach(count);
        io.unobserve(en.target);
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -6% 0px' });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ---------- Count-up -------------------------------------- */
  function count(el) {
    if (el.__done) return; el.__done = true;
    var end = parseFloat(el.getAttribute('data-count')), dec = (el.getAttribute('data-count').split('.')[1] || '').length;
    var fmt = function (v) { return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }); };
    if (reduce) { el.textContent = fmt(end); return; }
    var start = performance.now(), dur = 1700;
    (function tick(now) {
      var p = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - p, 4);
      el.textContent = fmt(end * e);
      if (p < 1) requestAnimationFrame(tick);
    })(start);
  }

  /* ---------- Pointer glow + tilt --------------------------- */
  if (fine && !reduce) {
    $$('.x-stat, .x-mvv').forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        el.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    });
    $$('.x-stat, .card, .support-card, .program-card, .pillar, .x-video').forEach(function (el) {
      el.classList.add('x-tilt');
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - .5, py = (e.clientY - r.top) / r.height - .5;
        el.style.transition = 'transform .08s linear';
        el.style.transform = 'perspective(900px) rotateX(' + (-py * 5).toFixed(2) + 'deg) rotateY(' + (px * 6).toFixed(2) + 'deg) translateY(-4px)';
      });
      el.addEventListener('pointerleave', function () {
        el.style.transition = 'transform .6s cubic-bezier(.2,.7,.2,1)';
        el.style.transform = '';
      });
    });
  }

  /* ---------- Tabs (how we protect) ------------------------- */
  $$('.x-tabs').forEach(function (wrap) {
    var tabs = $$('.x-tab', wrap), panels = $$('.x-panel', wrap), cur = 0, timer, auto = !reduce, DUR = 7000;
    function show(n, user) {
      cur = (n + tabs.length) % tabs.length;
      tabs.forEach(function (t, k) {
        var on = k === cur;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        var i = $('i', t); if (i) { i.classList.remove('run'); void i.offsetWidth; if (on && auto) i.classList.add('run'); }
        panels[k].classList.toggle('is-on', on);
      });
      clearTimeout(timer);
      if (user) auto = false;
      if (auto) timer = setTimeout(function () { show(cur + 1); }, DUR);
    }
    wrap.style.setProperty('--x-dur', DUR + 'ms');
    tabs.forEach(function (t, k) {
      t.addEventListener('click', function () { show(k, true); });
      t.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); show(cur + 1, true); tabs[cur].focus(); }
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); show(cur - 1, true); tabs[cur].focus(); }
      });
    });
    wrap.addEventListener('pointerenter', function () { clearTimeout(timer); $$('i.run', wrap).forEach(function (i) { i.style.animationPlayState = 'paused'; }); });
    wrap.addEventListener('pointerleave', function () { if (auto) show(cur); });
    show(0);
  });

  /* ---------- Zone map -------------------------------------- */
  var map = $('.x-map');
  if (map) {
    var tip = $('.x-map-tip', map), tipDefault = tip ? tip.innerHTML : '';
    $$('.x-zone-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('.x-zone-btn').forEach(function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
        map.setAttribute('data-zone', b.getAttribute('data-zone'));
      });
    });
    $$('.poi', map).forEach(function (p) {
      var on = function () { if (tip) tip.innerHTML = '<b>' + p.getAttribute('data-t') + '</b>' + p.getAttribute('data-d'); };
      var off = function () { if (tip) tip.innerHTML = tipDefault; };
      p.addEventListener('pointerenter', on); p.addEventListener('focus', on); p.addEventListener('click', on);
      p.addEventListener('pointerleave', off); p.addEventListener('blur', off);
    });
  }

  /* ---------- Sticky mobile give bar ------------------------ */
  if (!/donate/.test(location.pathname) && !$('.x-give')) {
    sticky = doc.createElement('div');
    sticky.className = 'x-sticky';
    sticky.innerHTML = '<a href="donate.html">Donate</a><a href="tel:2132600061">Hotline</a>';
    doc.body.appendChild(sticky);
  }

  onScroll();
})();
