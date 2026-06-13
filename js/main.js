/* Shared interactions: cursor, clock, GSAP scroll animations */
(function () {
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Detroit clock ---------- */
  var clockEl = document.getElementById('clock');
  if (clockEl) {
    function setClock() {
      try {
        clockEl.textContent = new Date().toLocaleTimeString('en-US', {
          hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Detroit'
        });
      } catch (e) {
        clockEl.textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      }
    }
    setClock();
    setInterval(setClock, 30000);
  }

  /* ---------- custom cursor ---------- */
  var cursor = document.querySelector('.cursor');
  if (cursor && window.matchMedia('(hover: hover)').matches) {
    var cx = -100, cy = -100, tx = -100, ty = -100;
    document.addEventListener('mousemove', function (e) {
      tx = e.clientX; ty = e.clientY;
      document.body.classList.add('cursor-on');
    }, { passive: true });
    (function loop() {
      cx += (tx - cx) * 0.18;
      cy += (ty - cy) * 0.18;
      cursor.style.transform = 'translate(' + cx + 'px,' + cy + 'px) translate(-50%,-50%)';
      requestAnimationFrame(loop);
    })();
    document.querySelectorAll('a, button').forEach(function (el) {
      el.addEventListener('mouseenter', function () { cursor.classList.add('is-hover'); });
      el.addEventListener('mouseleave', function () { cursor.classList.remove('is-hover'); });
    });
  }

  /* ---------- back to top (Vinsetta Studio standard) ---------- */
  (function () {
    var btn = document.createElement('button');
    btn.className = 'to-top';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Back to top');
    btn.innerHTML = '<span aria-hidden="true">↑</span>';
    document.body.appendChild(btn);
    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    });
    var shown = false;
    function onScroll() {
      var show = window.scrollY > window.innerHeight * 0.9;
      if (show !== shown) { shown = show; btn.classList.toggle('is-visible', show); }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  })();

  /* ---------- scroll/reveal motion ----------
     All content is visible by default in CSS. Motion is gated behind the
     `anim-ready` class, which we add ONLY when motion is allowed. With JS off,
     reduced-motion on, or GSAP missing, nothing is hidden. */
  if (reduced) return;

  /* reveals: enhance an already-visible default (IntersectionObserver, fires once) */
  function revealOnce(els, rootMargin) {
    if (!els.length) return;
    if (!('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: rootMargin || '0px 0px -10% 0px' });
    els.forEach(function (el) { io.observe(el); });
  }

  document.documentElement.classList.add('anim-ready');

  var revealEls = [];
  document.querySelectorAll('.work-item, .cap, .stat, .step, .outcome, .case-meta__cell, .philosophy__bio p, .case-body > *, .reveal')
    .forEach(function (el) { el.classList.add('will-reveal'); revealEls.push(el); });
  revealOnce(revealEls);

  /* word-by-word statement: split into words, fade in once on entry (no scroll scrub) */
  document.querySelectorAll('.split-words').forEach(function (el) {
    var words = el.textContent.trim().split(/\s+/);
    el.innerHTML = words.map(function (w) { return '<span class="w">' + w + '</span>'; }).join(' ');
  });
  revealOnce(Array.prototype.slice.call(document.querySelectorAll('.split-words')), '0px 0px -20% 0px');

  /* ---------- GSAP (hero entrance, marquee, count-up) ---------- */
  if (typeof gsap === 'undefined') return;
  if (typeof ScrollTrigger !== 'undefined') gsap.registerPlugin(ScrollTrigger);

  /* hero line intro */
  var lines = document.querySelectorAll('.hero__title .line > span, .case-hero .line > span');
  if (lines.length) {
    gsap.from(lines, {
      yPercent: 110, duration: 1.1, stagger: 0.12, ease: 'power4.out', delay: 0.15
    });
  }
  var fades = document.querySelectorAll('.hero__eyebrow, .hero__sub, .hero__cta, .case-hero__label, .case-hero__sub, .case-meta');
  if (fades.length) {
    gsap.from(fades, { opacity: 0, y: 24, duration: 0.9, stagger: 0.1, ease: 'power3.out', delay: 0.5 });
  }

  if (typeof ScrollTrigger === 'undefined') return;

  /* marquee scroll-speed */
  var track = document.querySelector('.marquee__track');
  if (track) {
    gsap.to(track, { xPercent: -50, ease: 'none', duration: 28, repeat: -1 });
  }

  /* count-up stats (HTML carries the final value as static text for the no-anim path) */
  document.querySelectorAll('[data-count]').forEach(function (el) {
    var end = parseInt(el.getAttribute('data-count'), 10);
    var obj = { v: 0 };
    el.textContent = '0'; // anim path only: reset from the static final value, then count up
    gsap.to(obj, {
      v: end, duration: 1.6, ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 88%' },
      onUpdate: function () { el.textContent = Math.round(obj.v); }
    });
  });

  /* big contact link */
  var big = document.querySelectorAll('.contact__big .line > span, .case-next__link');
  big.forEach(function (el) {
    gsap.from(el, {
      yPercent: 60, opacity: 0, duration: 1, ease: 'power4.out',
      scrollTrigger: { trigger: el, start: 'top 92%' }
    });
  });
})();
