# mtthwx-portfolio

Personal portfolio of Matthew Garvin — Senior UI/UX Designer, Human-AI Interaction.
Seven case studies spanning NASA directorates, ComEd, and Detroit research labs.

Static site: hand-written HTML, CSS, and vanilla JavaScript. No build step.

- `index.html` — landing page (WebGL hero, work list, capabilities, contact)
- `*.html` — one file per case study
- `css/style.css` — global design tokens and styles
- `js/` — `main.js` (shared interactions), `hero.js` (Three.js hero), `scrolly.js`
  (step-driven sticky scrollytelling engine), `atlas.js` (ComEd dataset),
  `il-geo.js` (generated county boundaries), `comed-charts.js` (ComEd figures)
- `copy/` — copy proposals awaiting review; not loaded by the site
- `tools/` — one-time developer scripts, not loaded by the site

## Local preview

```bash
python -m http.server 8000
# open http://localhost:8000
```

## Regenerating the ComEd map geography

`js/il-geo.js` is generated, not hand-edited. It holds simplified county boundary rings for
the map on `comed-v2x.html`.

```bash
node tools/bake-il-geo.mjs --selftest   # checks before trusting the output
node tools/bake-il-geo.mjs              # writes js/il-geo.js
```

Two things to know before changing it:

- **The simplification tolerance is tied to the render scale.** At 0.0003° a boundary point is
  about 0.07px on the current map — invisible. Make the map much larger and it needs re-baking.
- **Lake Michigan is not a dataset.** The census county polygons are clipped to the shoreline, so
  the lake is simply wherever no county is drawn. That is also why the bake includes counties in
  Wisconsin, Indiana and Iowa: without them, the surrounding land would render as water.

`tools/fix-atlas-geo.mjs` is a companion one-off that repaired county labels and unmapped
positions in `atlas.js`. It has already been applied; `--check` re-runs the assertions without
writing.

Destined for [mtthwx.com](https://mtthwx.com). Designed by Vinsetta Studio LLC.
