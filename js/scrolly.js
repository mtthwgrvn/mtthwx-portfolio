/* Step-driven sticky scrollytelling.

   Markup contract:
     <figure class="scrolly" data-scrolly>
       <div class="scrolly__viz">…diagram (reuse .viz / .gjsvg chrome)…</div>
       <div class="scrolly__steps">
         <div class="scrolly__step" data-state="0">…narrative beat…</div>
         <div class="scrolly__step" data-state="1">…</div>
       </div>
     </figure>

   As a step crosses the viewport's vertical center, its `data-state` is copied
   onto `.scrolly__viz`. Figure-specific CSS keys the diagram's appearance off
   `.scrolly.is-live [data-state="N"]` — discrete states, one transition per
   change, never coupled to scroll velocity.

   With JS off, reduced motion on, or no IntersectionObserver, nothing activates:
   the complete diagram and every step stay fully visible and readable. */
(function () {
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !('IntersectionObserver' in window)) return;

  document.querySelectorAll('[data-scrolly]').forEach(function (fig) {
    var viz = fig.querySelector('.scrolly__viz');
    var steps = Array.prototype.slice.call(fig.querySelectorAll('.scrolly__step'));
    if (!viz || steps.length < 2) return;

    fig.classList.add('is-live');
    var current = null;

    function activate(step) {
      if (step === current) return;
      current = step;
      viz.setAttribute('data-state', step.getAttribute('data-state') || '0');
      steps.forEach(function (s) { s.classList.toggle('is-active', s === step); });
    }

    activate(steps[0]);

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) activate(en.target);
      });
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });

    steps.forEach(function (s) { io.observe(s); });
  });
})();
