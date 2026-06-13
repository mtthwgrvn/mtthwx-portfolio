# mtthwx-portfolio

Personal portfolio of Matthew Garvin — Senior UI/UX Designer, Human-AI Interaction.
Seven case studies spanning NASA directorates, ComEd, and Detroit research labs.

Static site: hand-written HTML, CSS, and vanilla JavaScript. No build step.

- `index.html` — landing page (WebGL hero, work list, capabilities, contact)
- `*.html` — one file per case study
- `css/style.css` — global design tokens and styles
- `js/` — `main.js` (shared interactions), `hero.js` (Three.js hero), `scrolly.js`
  (step-driven sticky scrollytelling engine), `atlas.js` (ComEd dataset)

## Local preview

```bash
python -m http.server 8000
# open http://localhost:8000
```

Destined for [mtthwx.com](https://mtthwx.com). Designed by Vinsetta Studio LLC.
