/* ComEd V2X case study — charts.
   Depends on atlas.js (window.ATLAS) and il-geo.js (window.ILGEO), both loaded first.

   Four figures: the study-at-a-glance tiles are static HTML; this file draws the
   emissions comparison, the grid-intensity trajectory, and the peaker displacement
   atlas (territory map + Chicago inset).

   Conventions used throughout, so the three figures read as one system:
     - gridlines and axes are solid hairlines, never dashed
     - a dash on a *series* is fine — it is redundant encoding for colour-blind readers
     - no value is reachable only by hover: everything is in a table view as well
     - marks carry the colour; labels, values and legends wear text tokens
     - one shared tooltip, one shared readout, driven by both mouse and keyboard */

(function () {
  'use strict';

  var A = window.ATLAS, GEO = window.ILGEO;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ============================================================ helpers */

  var NBSP = ' ';
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function num(n, d) { return Number(n).toLocaleString('en-US', { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d == null ? 0 : d }); }
  function byId(id) { return document.getElementById(id); }

  /* One tooltip for the whole page. Positioned in viewport coordinates, kept inside
     the window, and hidden from assistive tech — the readout panels carry the same
     text in the accessibility tree. */
  var tip = document.createElement('div');
  tip.className = 'vtip';
  tip.setAttribute('aria-hidden', 'true');
  document.body.appendChild(tip);

  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.classList.add('on');
    var r = tip.getBoundingClientRect();
    var left = Math.min(Math.max(8, x + 14), window.innerWidth - r.width - 8);
    var top = y - r.height - 14;
    if (top < 8) top = y + 20;
    tip.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';
  }
  function hideTip() { tip.classList.remove('on'); }
  document.addEventListener('scroll', hideTip, { passive: true });

  /**
   * Make one SVG figure a single keyboard widget.
   *
   * The first cut gave every mark its own tabindex. On the atlas that produced 259
   * focus stops, each a circle a few pixels across — every one of them under the
   * 24x24 minimum target size, and 500-odd accessibility failures. Tabbing through
   * 259 dots is also just bad.
   *
   * So the SVG itself is the control: one tab stop, arrow keys move a visible cursor
   * between marks, and an adjacent live region speaks the current value. The SVG
   * carries role="img" with a full label, marks are decorative to assistive tech,
   * and the table view underneath remains the complete, unmediated data path.
   */
  function keyboardFigure(svg, opts) {
    var idx = 0;
    function clamp(i, n) { return Math.max(0, Math.min(n - 1, i)); }
    function go(delta, absolute) {
      var n = opts.count();
      if (!n) return;
      idx = clamp(absolute == null ? idx + delta : absolute, n);
      opts.select(idx);
    }
    svg.addEventListener('keydown', function (e) {
      var n = opts.count();
      switch (e.key) {
        case 'ArrowRight': case 'ArrowDown': go(1); break;
        case 'ArrowLeft': case 'ArrowUp': go(-1); break;
        case 'PageDown': go(10); break;
        case 'PageUp': go(-10); break;
        case 'Home': go(0, 0); break;
        case 'End': go(0, n - 1); break;
        case 'Escape': opts.clear(); svg.blur(); break;
        default: return;
      }
      e.preventDefault();
    });
    svg.addEventListener('focus', function () { opts.select(idx); });
    svg.addEventListener('blur', function () { opts.clear(); });
    return { reset: function () { idx = 0; }, current: function () { return idx; } };
  }

  /** Build a <table> from a header row and an array of row arrays. */
  function table(head, rows, caption) {
    var h = '<table class="dtable"><caption class="sr-only">' + esc(caption) + '</caption><thead><tr>';
    head.forEach(function (c, i) {
      h += '<th scope="col"' + (i ? ' class="n"' : '') + '>' + esc(c) + '</th>';
    });
    h += '</tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr>';
      r.forEach(function (c, i) {
        h += i ? '<td class="n">' + esc(c) + '</td>' : '<th scope="row">' + esc(c) + '</th>';
      });
      h += '</tr>';
    });
    return h + '</tbody></table>';
  }

  /* ============================================================ 1. emissions */
  /* Five systems on one axis. The page's finding is a crossover between two of
     them, and a crossover is only visible when both series share a scale — which
     the previous tabbed one-system-at-a-time form made impossible. Emphasis
     colouring rather than five categorical hues: this page's palette is already at
     its colour-blind separation floor and cannot take more. */

  var YEARS = [2025, 2030, 2035, 2040];
  var SYS = [
    { k: 'v2g', name: 'V2G', emph: 1, cls: 'a' },
    { k: 'mc', name: 'Managed charging', emph: 1, cls: 'b' },
    { k: 'v2h', name: 'V2H', emph: 0, cls: 'q' },
    { k: 'v2b', name: 'V2B', emph: 0, cls: 'q' },
    { k: 'bess', name: 'Stationary BESS', emph: 0, cls: 'q' }
  ];
  var EM = {
    v2g: [[0.1983, 0.1636, 0.1232, 0.0911], [0.1345, 0.0631, 0.0401, 0.0249], [0.2514, 0.1950, 0.1610, 0.1466]],
    v2h: [[0.1678, 0.1293, 0.0883, 0.0573], [0.1065, 0.0381, 0.0163, 0.0076], [0.2030, 0.1554, 0.1190, 0.1009]],
    v2b: [[0.1228, 0.0886, 0.0560, 0.0344], [0.0536, 0.0089, 0.0039, 0.0051], [0.1764, 0.1360, 0.0910, 0.0766]],
    bess: [[0.0898, 0.0583, 0.0305, 0.0125], [0.0089, 0.0031, 0.0019, 0.0028], [0.1504, 0.1054, 0.0628, 0.0560]],
    mc: [[0.0221, 0.0507, 0.1003, 0.1100], [0.0203, -0.0080, 0.0945, 0.1122], [0.0246, 0.0676, 0.0696, 0.0924]]
  };
  var SCEN = ['Base', 'Optimistic grid', 'Pessimistic grid'];

  /** Linear interpolation crossing point between two series, in fractional years. */
  function crossover(a, b) {
    for (var i = 1; i < YEARS.length; i++) {
      var d0 = a[i - 1] - b[i - 1], d1 = a[i] - b[i];
      if (d0 === 0) return YEARS[i - 1];
      if ((d0 < 0) !== (d1 < 0)) {
        return YEARS[i - 1] + (YEARS[i] - YEARS[i - 1]) * (d0 / (d0 - d1));
      }
    }
    return null;
  }

  function initEmissions() {
    var svg = byId('exsvg');
    if (!svg) return;
    var W = 720, H = 340, L = 62, R = 132, T = 22, B = 46;
    var y0 = -0.03, y1 = 0.27;
    var px = function (yr) { return L + (yr - 2025) / 15 * (W - L - R); };
    var py = function (v) { return T + (y1 - v) / (y1 - y0) * (H - T - B); };
    var scen = 0;
    var note = byId('exnote'), tw = byId('extable');

    function render() {
      var g = '';
      /* gridlines — solid hairlines, one shade off the surface */
      var ticks = [0.00, 0.05, 0.10, 0.15, 0.20, 0.25];
      ticks.forEach(function (t) {
        g += '<line class="grid" x1="' + L + '" y1="' + py(t).toFixed(1) + '" x2="' + (W - R) + '" y2="' + py(t).toFixed(1) + '"/>';
        g += '<text class="ctick" x="' + (L - 10) + '" y="' + py(t).toFixed(1) + '" text-anchor="end" dominant-baseline="middle">' + t.toFixed(2) + '</text>';
      });
      /* the zero line is the point of the redesign: one series goes negative and
         must be seen to cross, not recoloured and drawn the same direction */
      g += '<line class="zero" x1="' + L + '" y1="' + py(0).toFixed(1) + '" x2="' + (W - R) + '" y2="' + py(0).toFixed(1) + '"/>';
      YEARS.forEach(function (yr) {
        g += '<text class="ctick" x="' + px(yr).toFixed(1) + '" y="' + (H - B + 22) + '" text-anchor="middle">' + yr + '</text>';
      });
      g += '<text class="axis-title" transform="translate(16,' + ((T + H - B) / 2) + ') rotate(-90)" text-anchor="middle">kg CO₂e avoided per kWh</text>';

      /* de-emphasised series first, so the two that carry the story sit on top */
      SYS.slice().sort(function (a, b) { return a.emph - b.emph; }).forEach(function (s) {
        var v = EM[s.k][scen];
        var pts = v.map(function (val, i) { return px(YEARS[i]).toFixed(1) + ',' + py(val).toFixed(1); }).join(' ');
        g += '<polyline class="ln ln--' + s.cls + '" points="' + pts + '"/>';
        if (s.emph) {
          v.forEach(function (val, i) {
            g += '<circle class="dot dot--' + s.cls + '" cx="' + px(YEARS[i]).toFixed(1) + '" cy="' + py(val).toFixed(1) + '" r="4"/>';
          });
          /* direct end-labels, but only on the two emphasised series */
          g += '<text class="endlab endlab--' + s.cls + '" x="' + (px(2040) + 12) + '" y="' + py(v[3]).toFixed(1) + '" dominant-baseline="middle">' + esc(s.name) + '</text>';
        }
      });

      /* crossover annotation */
      var x = crossover(EM.mc[scen], EM.v2g[scen]);
      if (x) {
        g += '<line class="xover" x1="' + px(x).toFixed(1) + '" y1="' + T + '" x2="' + px(x).toFixed(1) + '" y2="' + (H - B) + '"/>';
        g += '<text class="xlab" x="' + (px(x) + 6).toFixed(1) + '" y="' + (T + 12) + '">CROSSOVER ' + x.toFixed(0) + '</text>';
      }

      g += '<g class="kcursor"></g>';
      /* mouse hit columns — one per year, comfortably wide. Not focusable: the SVG
         itself is the single keyboard control. */
      var colW = (W - L - R) / 3;
      YEARS.forEach(function (yr, i) {
        var cx = px(yr);
        g += '<rect class="hit" x="' + (cx - colW / 2).toFixed(1) + '" y="' + T + '" width="' + colW.toFixed(1) + '" height="' + (H - T - B) + '" data-yr="' + i + '"/>';
      });
      svg.innerHTML = g;
      svg.setAttribute('aria-label', figureLabel());

      note.textContent = x
        ? 'MANAGED CHARGING OVERTAKES V2G IN ' + x.toFixed(0) + ' UNDER THE ' + SCEN[scen].toUpperCase() + ' GRID.'
        : 'UNDER THE ' + SCEN[scen].toUpperCase() + ', MANAGED CHARGING NEVER OVERTAKES V2G BEFORE 2040.';

      tw.innerHTML = table(
        ['Year'].concat(SYS.map(function (s) { return s.name; })),
        YEARS.map(function (yr, i) {
          return [String(yr)].concat(SYS.map(function (s) { return EM[s.k][scen][i].toFixed(4); }));
        }),
        'Emissions avoided per kWh by system and year, ' + SCEN[scen] + ' scenario'
      );

      svg.querySelectorAll('.hit').forEach(function (r) {
        var i = +r.getAttribute('data-yr');
        r.addEventListener('mousemove', function (e) { showTip(yearTip(i), e.clientX, e.clientY); });
        r.addEventListener('mouseleave', hideTip);
      });
    }

    function figureLabel() {
      var x = crossover(EM.mc[scen], EM.v2g[scen]);
      return 'Line chart. Emissions avoided per kilowatt-hour by five systems, 2025 to 2040, ' + SCEN[scen] + ' grid. ' +
        (x ? 'Managed charging overtakes V2G in ' + x.toFixed(0) + '.' : 'Managed charging does not overtake V2G before 2040.') +
        ' Press the arrow keys to read each year, or open the table view below the chart.';
    }
    function yearLabel(i) {
      return YEARS[i] + ': ' + SYS.map(function (s) {
        return s.name + ' ' + EM[s.k][scen][i].toFixed(4) + ' kilograms';
      }).join(', ');
    }

    /* keyboard cursor */
    var exread = byId('exread');
    function drawCursor(i) {
      var c = svg.querySelector('.kcursor');
      if (!c) return;
      if (i == null) { c.innerHTML = ''; return; }
      var s = '<line class="kcurline" x1="' + px(YEARS[i]).toFixed(1) + '" y1="' + T + '" x2="' + px(YEARS[i]).toFixed(1) + '" y2="' + (H - B) + '"/>';
      SYS.forEach(function (sy) {
        s += '<circle class="kcurdot" cx="' + px(YEARS[i]).toFixed(1) + '" cy="' + py(EM[sy.k][scen][i]).toFixed(1) + '" r="5.5"/>';
      });
      c.innerHTML = s;
    }
    keyboardFigure(svg, {
      count: function () { return YEARS.length; },
      select: function (i) { drawCursor(i); exread.textContent = yearLabel(i); },
      clear: function () { drawCursor(null); exread.textContent = ''; }
    });
    function yearTip(i) {
      return '<b>' + YEARS[i] + '</b><dl>' + SYS.map(function (s) {
        return '<dt>' + esc(s.name) + '</dt><dd>' + EM[s.k][scen][i].toFixed(4) + '</dd>';
      }).join('') + '</dl>';
    }

    document.querySelectorAll('[data-scen]').forEach(function (b) {
      b.addEventListener('click', function () {
        scen = +b.getAttribute('data-scen');
        document.querySelectorAll('[data-scen]').forEach(function (x) {
          var on = x === b;
          x.classList.toggle('on', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        render();
      });
    });
    render();
  }

  /* ============================================================ 2. trajectory */

  var TRAJ = {
    base: { off: [0.76, 0.66, 0.39, 0.37], peak: [0.78, 0.72, 0.49, 0.48], note: 'BASE CASE: THE PEAK / OFF-PEAK GAP HOLDS — GAS PEAKERS STILL SET PEAK EMISSIONS THROUGH 2040.' },
    opt: { off: [0.76, 0.69, 0.31, 0.26], peak: [0.78, 0.68, 0.41, 0.37], note: 'OPTIMISTIC: AROUND 2030 PEAK FALLS BELOW OFF-PEAK. A TIME-OF-USE PROGRAM CALIBRATED FOR TODAY WOULD SHIFT LOAD INTO DIRTIER HOURS.' },
    pess: { off: [0.76, 0.63, 0.43, 0.41], peak: [0.78, 0.70, 0.50, 0.50], note: 'PESSIMISTIC: SLOWER DECARBONISATION KEEPS MARGINAL EMISSIONS — AND V2X’S RELATIVE BENEFIT — HIGH.' }
  };

  function initTraj() {
    var svg = byId('trajsvg');
    if (!svg) return;
    var W = 720, H = 330, L = 66, R = 26, T = 20, B = 48;
    var ymax = 0.9;
    var px = function (yr) { return L + (yr - 2025) / 15 * (W - L - R); };
    /* Ticks are computed from this scale. They used to be hardcoded at y=30/140/253
       against a scale that put them at 33.5/141.8/250 — every label sat up to 7.8px
       above the value it named. */
    var py = function (v) { return T + (ymax - v) / ymax * (H - T - B); };
    var key = 'base', note = byId('trajnote'), tw = byId('trajtable');

    function render() {
      var d = TRAJ[key], g = '';
      [0, 0.2, 0.4, 0.6, 0.8].forEach(function (t) {
        g += '<line class="grid" x1="' + L + '" y1="' + py(t).toFixed(1) + '" x2="' + (W - R) + '" y2="' + py(t).toFixed(1) + '"/>';
        g += '<text class="ctick" x="' + (L - 10) + '" y="' + py(t).toFixed(1) + '" text-anchor="end" dominant-baseline="middle">' + t.toFixed(1) + '</text>';
      });
      YEARS.forEach(function (yr) {
        g += '<text class="ctick" x="' + px(yr).toFixed(1) + '" y="' + (H - B + 24) + '" text-anchor="middle">' + yr + '</text>';
      });
      g += '<text class="axis-title" transform="translate(16,' + ((T + H - B) / 2) + ') rotate(-90)" text-anchor="middle">kg CO₂e per kWh (marginal)</text>';

      /* Where peak drops under off-peak, band the inversion. This is the page's
         most interesting finding and nothing on the chart used to mark it. */
      var inv = [];
      for (var i = 0; i < YEARS.length; i++) if (d.peak[i] < d.off[i]) inv.push(i);
      if (inv.length) {
        var s = Math.max(0, inv[0] - 1), e = Math.min(YEARS.length - 1, inv[inv.length - 1]);
        var top = [], bot = [];
        for (var j = s; j <= e; j++) { top.push(px(YEARS[j]).toFixed(1) + ',' + py(d.off[j]).toFixed(1)); bot.unshift(px(YEARS[j]).toFixed(1) + ',' + py(d.peak[j]).toFixed(1)); }
        g += '<polygon class="invband" points="' + top.concat(bot).join(' ') + '"/>';
      }

      g += '<polyline class="tl tl--off" points="' + d.off.map(function (v, i) { return px(YEARS[i]).toFixed(1) + ',' + py(v).toFixed(1); }).join(' ') + '"/>';
      g += '<polyline class="tl tl--peak" points="' + d.peak.map(function (v, i) { return px(YEARS[i]).toFixed(1) + ',' + py(v).toFixed(1); }).join(' ') + '"/>';
      d.off.forEach(function (v, i) { g += '<circle class="dot dot--off" cx="' + px(YEARS[i]).toFixed(1) + '" cy="' + py(v).toFixed(1) + '" r="4"/>'; });
      d.peak.forEach(function (v, i) { g += '<circle class="dot dot--peak" cx="' + px(YEARS[i]).toFixed(1) + '" cy="' + py(v).toFixed(1) + '" r="4"/>'; });

      if (inv.length) {
        var xi = px(YEARS[inv[0]]), yi = py(d.peak[inv[0]]);
        g += '<line class="lead" x1="' + xi.toFixed(1) + '" y1="' + (yi + 8).toFixed(1) + '" x2="' + (xi + 30).toFixed(1) + '" y2="' + (yi + 52).toFixed(1) + '"/>';
        g += '<text class="xlab" x="' + (xi + 34).toFixed(1) + '" y="' + (yi + 56).toFixed(1) + '">PEAK BELOW OFF-PEAK</text>';
      }

      g += '<g class="kcursor"></g>';
      var colW = (W - L - R) / 3;
      YEARS.forEach(function (yr, i) {
        g += '<rect class="hit" x="' + (px(yr) - colW / 2).toFixed(1) + '" y="' + T + '" width="' + colW.toFixed(1) + '" height="' + (H - T - B) + '" data-i="' + i + '"/>';
      });
      svg.innerHTML = g;
      svg.setAttribute('aria-label',
        'Line chart. Marginal grid carbon intensity at peak and off-peak hours, 2025 to 2040, ' + key + ' scenario. ' +
        (inv.length ? 'Peak falls below off-peak from ' + YEARS[inv[0]] + '. ' : 'Peak stays above off-peak throughout. ') +
        'Press the arrow keys to read each year, or open the table view below the chart.');
      note.textContent = d.note;

      tw.innerHTML = table(
        ['Year', 'Peak', 'Off-peak', 'Gap'],
        YEARS.map(function (yr, i) {
          return [String(yr), d.peak[i].toFixed(2), d.off[i].toFixed(2), (d.peak[i] - d.off[i]).toFixed(2)];
        }),
        'Marginal grid carbon intensity by year, ' + key + ' scenario'
      );

      svg.querySelectorAll('.hit').forEach(function (r) {
        var i = +r.getAttribute('data-i');
        r.addEventListener('mousemove', function (e) { showTip(tjTip(d, i), e.clientX, e.clientY); });
        r.addEventListener('mouseleave', hideTip);
      });
      drawCursor(null);
    }

    function tjTip(d, i) {
      return '<b>' + YEARS[i] + '</b><dl><dt>Peak</dt><dd>' + d.peak[i].toFixed(2) + '</dd>' +
        '<dt>Off-peak</dt><dd>' + d.off[i].toFixed(2) + '</dd>' +
        '<dt>Gap</dt><dd>' + (d.peak[i] - d.off[i]).toFixed(2) + '</dd></dl>';
    }
    var tjread = byId('trajread');
    function drawCursor(i) {
      var c = svg.querySelector('.kcursor');
      if (!c) return;
      if (i == null) { c.innerHTML = ''; return; }
      var d = TRAJ[key];
      c.innerHTML = '<line class="kcurline" x1="' + px(YEARS[i]).toFixed(1) + '" y1="' + T + '" x2="' + px(YEARS[i]).toFixed(1) + '" y2="' + (H - B) + '"/>' +
        '<circle class="kcurdot" cx="' + px(YEARS[i]).toFixed(1) + '" cy="' + py(d.peak[i]).toFixed(1) + '" r="5.5"/>' +
        '<circle class="kcurdot" cx="' + px(YEARS[i]).toFixed(1) + '" cy="' + py(d.off[i]).toFixed(1) + '" r="5.5"/>';
    }
    keyboardFigure(svg, {
      count: function () { return YEARS.length; },
      select: function (i) {
        var d = TRAJ[key];
        drawCursor(i);
        tjread.textContent = YEARS[i] + ': peak ' + d.peak[i].toFixed(2) + ', off-peak ' + d.off[i].toFixed(2) +
          ', gap ' + (d.peak[i] - d.off[i]).toFixed(2) + ' kilograms CO2e per kilowatt-hour.';
      },
      clear: function () { drawCursor(null); tjread.textContent = ''; }
    });

    document.querySelectorAll('[data-traj]').forEach(function (b) {
      b.addEventListener('click', function () {
        key = b.getAttribute('data-traj');
        document.querySelectorAll('[data-traj]').forEach(function (x) {
          var on = x === b;
          x.classList.toggle('on', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        render();
      });
    });
    render();
  }

  /* ============================================================ 3. atlas */

  /* Scales are FIXED across every year and scenario. If the radius scale were
     refitted per view, the year slider would show no growth — every year would look
     the same. The global maximum is the 2040 optimistic Cook figure. */
  var FLEET_MAX = 33543;
  var R_MAX = 10, R_MIN = 1.5, R_EXP = 0.42;
  function radius(f) { return Math.max(R_MIN, R_MAX * Math.pow(Math.max(f, 1) / FLEET_MAX, R_EXP)); }

  /* Sequential ramp: one hue, light-on-dark so brighter reads as more. Every step
     clears 3:1 against the lightest thing behind it (territory land #171C25); the
     floor step measures 3.20:1. The previous version encoded magnitude as raw alpha
     from 0.12, so the bottom of the scale was invisible against the surface. */
  var RAMP = ['#0B7A55', '#009B69', '#00BA7C', '#00D98B', '#7DEEC0'];
  var RM = [1.0, 1.3, 0.55];
  var PART = [0.10, 0.20, 0.05];

  function fleetAt(e, K, r, t, sc) {
    return K / (1 + (K / Math.max(e, 1) - 1) * Math.exp(-r * RM[sc] * t));
  }
  /* Equity weight is static: it depends on vulnerability and peaker burden, not on
     the year. Keeping it on the colour channel and the fleet on the size channel
     makes the two variables independent, so "big and bright" is a real interaction
     rather than the same number drawn twice. */
  function equity(z) { return z.v * (0.25 + 0.75 * z.pb); }

  function quintiles(vals) {
    var s = vals.slice().sort(function (a, b) { return a - b; });
    return [0.2, 0.4, 0.6, 0.8].map(function (p) { return s[Math.floor(p * (s.length - 1))]; });
  }
  function binOf(v, edges) {
    for (var i = 0; i < edges.length; i++) if (v <= edges[i]) return i;
    return edges.length;
  }

  /** Equirectangular fit with a cos(lat) correction, sized to a viewBox. */
  function fit(pts, W, H, pad) {
    var mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
    pts.forEach(function (p) {
      if (p[0] < mnx) mnx = p[0]; if (p[0] > mxx) mxx = p[0];
      if (p[1] < mny) mny = p[1]; if (p[1] > mxy) mxy = p[1];
    });
    var kx = Math.cos((mny + mxy) / 2 * Math.PI / 180);
    var w = (mxx - mnx) * kx, h = mxy - mny;
    var s = Math.min((W - 2 * pad) / w, (H - 2 * pad) / h);
    var ox = pad + ((W - 2 * pad) - w * s) / 2;
    var oy = pad + ((H - 2 * pad) - h * s) / 2;
    return {
      x: function (lon) { return ox + (lon - mnx) * kx * s; },
      y: function (lat) { return oy + (mxy - lat) * s; },
      inside: function (lon, lat) { return lon >= mnx && lon <= mxx && lat >= mny && lat <= mxy; }
    };
  }

  function ringPath(flat, p) {
    var d = '';
    for (var i = 0; i < flat.length; i += 2) {
      d += (i ? 'L' : 'M') + p.x(flat[i]).toFixed(1) + ',' + p.y(flat[i + 1]).toFixed(1);
    }
    return d + 'Z';
  }

  function initAtlas() {
    var main = byId('atmap');
    if (!main || !A || !GEO) return;
    var inset = byId('atinset');

    var terr = [], ctx = [];
    for (var k in GEO) (GEO[k].t === 1 ? terr : ctx).push(GEO[k]);

    /* Domain covers the territory polygons AND every mark, so nothing can be
       plotted off-canvas. Four zips and a peaker used to fall outside the old
       hardcoded window and were silently lost. */
    var dom = [];
    terr.forEach(function (c) {
      c.r.forEach(function (r) { for (var i = 0; i < r.length; i += 2) dom.push([r[i], r[i + 1]]); });
    });
    A.zips.forEach(function (z) { dom.push([z.lo, z.la]); });
    A.peakers.forEach(function (p) { dom.push([p.lo, p.la]); });
    /* Territory stops at Cook's eastern edge, which is the shoreline — fitting to it
       exactly left Lake Michigan as a two-pixel sliver that read as more land. Push
       the domain out over the water so the lake is visibly a lake, and so Chicago's
       label has somewhere to sit that is not on top of the dot cluster. */
    (function () {
      var e = -Infinity, s = Infinity, n = -Infinity;
      dom.forEach(function (p) { if (p[0] > e) e = p[0]; if (p[1] < s) s = p[1]; if (p[1] > n) n = p[1]; });
      dom.push([e + 0.42, (s + n) / 2]);
    })();

    var MW = 880, MH = 690, IW = 470, IH = 560;
    var pm = fit(dom, MW, MH, 14);
    /* Chicago window: Cook, DuPage, southern Lake, northern Will. Wide enough to
       keep the south-suburban high-burden belt, which a tighter crop would cut. */
    var IWIN = [[-88.35, 41.42], [-87.50, 42.18]];
    var pi = fit(IWIN, IW, IH, 10);

    var EDGES = quintiles(A.zips.map(equity));
    var LANDMARKS = [['CHICAGO', 41.88, -87.63], ['ROCKFORD', 42.27, -89.09], ['AURORA', 41.76, -88.32],
      ['JOLIET', 41.53, -88.08], ['WAUKEGAN', 42.36, -87.84], ['KANKAKEE', 41.12, -87.86], ['DEKALB', 41.93, -88.75]];
    var BIG = { Cook: 1, DuPage: 1, Lake: 1, Will: 1, McHenry: 1, Kane: 1, Winnebago: 1, Kendall: 1, Ogle: 1, LaSalle: 1 };

    var scen = 0, year = 2030, showHB = true, showPK = true;
    var readout = byId('atreadout');
    var estGroups = {};

    var terrByName = {};
    terr.forEach(function (c) { terrByName[c.n] = c; });

    /** Area-weighted centroid of a county's largest ring, cached. */
    var cenCache = {};
    function centroidOf(c) {
      if (cenCache[c.n]) return cenCache[c.n];
      var best = null, bestA = -1;
      c.r.forEach(function (flat) {
        var a = 0, cx = 0, cy = 0;
        for (var i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) {
          var f = flat[j] * flat[i + 1] - flat[i] * flat[j + 1];
          a += f; cx += (flat[j] + flat[i]) * f; cy += (flat[j + 1] + flat[i + 1]) * f;
        }
        a *= 0.5;
        if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = [cx / (6 * a), cy / (6 * a)]; }
      });
      return (cenCache[c.n] = best);
    }

    /** Static base map for one projection. Built once per projection, not per frame. */
    function baseLayers(p, opts) {
      var all = ctx.concat(terr);
      var g = '<rect class="lake" x="0" y="0" width="' + opts.w + '" height="' + opts.h + '"/>';

      /* Coastline. Three dark fills can only be pushed about 1.2:1 apart before the
         data ramp loses its 3:1 floor against the land, so fills alone can never
         make the lake read as water. Instead every landmass is stroked wide in a
         water blue FIRST; the fills then paint over each interior seam, and the only
         blue that survives is the outer edge of the land — the Lake Michigan shore
         and the Mississippi. An explicit coast rather than a hoped-for contrast. */
      g += '<g class="coast" aria-hidden="true">' + all.map(function (c) {
        return '<path d="' + c.r.map(function (r) { return ringPath(r, p); }).join('') + '"/>';
      }).join('') + '</g>';

      ctx.forEach(function (c) {
        g += '<path class="land land--ctx" d="' + c.r.map(function (r) { return ringPath(r, p); }).join('') + '"/>';
      });
      terr.forEach(function (c) {
        g += '<path class="land land--terr" d="' + c.r.map(function (r) { return ringPath(r, p); }).join('') + '"><title>' + esc(c.n) + ' County</title></path>';
      });

      (opts.labelCounties || []).forEach(function (name) {
        var c = terr.find(function (x) { return x.n === name; });
        if (!c) return;
        var cx = 0, cy = 0, n = 0, ring = c.r[0];
        for (var i = 0; i < ring.length; i += 2) { cx += ring[i]; cy += ring[i + 1]; n++; }
        if (!p.inside(cx / n, cy / n)) return;
        g += '<text class="clab" x="' + p.x(cx / n).toFixed(1) + '" y="' + p.y(cy / n).toFixed(1) + '" text-anchor="middle">' + esc(c.n.toUpperCase()) + '</text>';
      });

      /* City labels are returned separately so they can be drawn ON TOP of the data
         marks. Underneath, the Waukegan peaker triangle and the Aurora dot cluster
         each sat squarely over their own city's name. */
      var over = LANDMARKS.map(function (l) {
        if (!p.inside(l[2], l[1])) return '';
        var x = p.x(l[2]), y = p.y(l[1]);
        var flip = x > opts.w - 84;
        return '<circle class="cityd" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2.4"/>' +
          '<text class="city" x="' + (flip ? x - 7 : x + 7).toFixed(1) + '" y="' + (y - 6).toFixed(1) + '"' +
          (flip ? ' text-anchor="end"' : '') + '>' + l[0] + '</text>';
      }).join('');
      return { under: g, over: over };
    }

    /* Only counties with no city label of their own get named here. DeKalb,
       Kankakee, Lake, Kane and Will all collided with a landmark sitting inside
       them — two of them printing the same word twice — and Cook and DuPage are
       labelled on the inset, since on the territory map their centroids fall inside
       the densest part of the dot cluster. */
    var baseMain = baseLayers(pm, {
      w: MW, h: MH,
      labelCounties: ['Winnebago', 'McHenry', 'Ogle', 'LaSalle', 'Kendall', 'Grundy', 'Whiteside', 'Bureau', 'Iroquois', 'Lee']
    });
    /* Locator: show the reader which part of the territory the inset magnifies. */
    baseMain.over += '<rect class="locator" x="' + pm.x(IWIN[0][0]).toFixed(1) + '" y="' + pm.y(IWIN[1][1]).toFixed(1) +
      '" width="' + (pm.x(IWIN[1][0]) - pm.x(IWIN[0][0])).toFixed(1) + '" height="' + (pm.y(IWIN[0][1]) - pm.y(IWIN[1][1])).toFixed(1) + '"/>';
    var baseInset = baseLayers(pi, { w: IW, h: IH, labelCounties: ['Cook', 'DuPage', 'Will', 'Lake', 'Kane'] });

    function markup(rows, p, opts) {
      var dots = '', rings = '', peaks = '';
      /* Largest first so the smallest marks are never buried. */
      rows.filter(function (d) { return !d.z.ap; })
        .sort(function (a, b) { return b.r - a.r; })
        .forEach(function (d) {
          if (!p.inside(d.z.lo, d.z.la)) return;
          var cx = p.x(d.z.lo).toFixed(1), cy = p.y(d.z.la).toFixed(1);
          dots += '<circle class="zip" cx="' + cx + '" cy="' + cy + '" r="' + d.r.toFixed(1) +
            '" fill="' + RAMP[d.bin] + '" data-z="' + d.z.z + '"/>';
          if (showHB && d.z.hb) rings += '<circle class="hbring" cx="' + cx + '" cy="' + cy + '" r="' + (d.r + 1.8).toFixed(1) + '"/>';
        });

      /* 133 of 371 zip codes have no station-derived centroid. Scattering them
         around their county centroid drew a cluster that looked like a finding and
         wasn't — in Cook it put city-of-Chicago zips out in the suburbs and stacked
         a hundred amber EIEC rings in one spot, the loudest thing on the map. A map
         should not invent a position. They collapse into one hollow mark per county
         instead, sized by their combined fleet and labelled as unplaced. */
      var byCounty = {};
      rows.forEach(function (d) {
        if (!d.z.ap) return;
        var g = byCounty[d.z.y] || (byCounty[d.z.y] = { n: 0, f: 0, hb: 0, county: d.z.y });
        g.n++; g.f += d.f; g.hb += d.z.hb ? 1 : 0;
      });
      Object.keys(byCounty).forEach(function (name) {
        var g = byCounty[name], c = terrByName[name];
        if (!c) return;
        var cen = centroidOf(c);
        if (!p.inside(cen[0], cen[1])) return;
        var r = radius(g.f);
        dots += '<circle class="zip--est" cx="' + p.x(cen[0]).toFixed(1) + '" cy="' + p.y(cen[1]).toFixed(1) + '" r="' + r.toFixed(1) +
          '" data-est="' + esc(name) + '"/>';
      });
      estGroups = byCounty;
      if (showPK) {
        A.peakers.forEach(function (pk) {
          if (!p.inside(pk.lo, pk.la)) return;
          var s = 5 + Math.sqrt(pk.co2) / 130;
          if (s > 15) s = 15;
          var zero = pk.co2 === 0;
          if (zero) s = 5;
          var x = p.x(pk.lo), y = p.y(pk.la);
          peaks += '<path class="pk' + (zero ? ' pk--zero' : '') + '" d="M' + x.toFixed(1) + ',' + (y - s).toFixed(1) +
            'L' + (x + s * 0.9).toFixed(1) + ',' + (y + s * 0.7).toFixed(1) + 'L' + (x - s * 0.9).toFixed(1) + ',' + (y + s * 0.7).toFixed(1) + 'Z"' +
            ' data-pk="' + esc(pk.n) + '"/>';
        });
      }
      return '<g class="zips">' + dots + '</g><g class="hbrings">' + rings + '</g><g class="pks">' + peaks + '</g><g class="kcursor"></g>';
    }

    function label(d) {
      return d.z.z + ' ' + d.z.c + ', ' + d.z.y + ' County. ' + num(d.f) + ' projected EVs in ' + year +
        '. Energy burden ' + d.z.eb + ' percent. Equity weight ' + d.w.toFixed(2) + '. Rank ' + d.rank + ' of ' + A.zips.length +
        (d.z.hb ? '. Top-quartile energy burden' : '') + (d.z.ap ? '. Position estimated from county centroid' : '') + '.';
    }
    function estLabel(g) {
      return g.n + ' zip codes in ' + g.county + ' County have no mapped position. Combined projected fleet ' +
        num(g.f) + ' EVs in ' + year + '. ' + g.hb + ' are top-quartile energy burden. Values are in the table view.';
    }
    function estTip(g) {
      return '<b>' + esc(g.county) + ' County</b><small>POSITION NOT MAPPED</small>' +
        '<dl><dt>Zip codes</dt><dd>' + g.n + '</dd>' +
        '<dt>Combined EVs ' + year + '</dt><dd>' + num(g.f) + '</dd>' +
        '<dt>Top-quartile burden</dt><dd>' + g.hb + '</dd></dl>';
    }
    function pkLabel(p) {
      return p.n + ' peaker plant. ' + p.fuel + ', ' + p.mw + ' megawatts. ' +
        (p.co2 ? num(p.co2) + ' tonnes CO2e' : 'no reported CO2e') + '. People of colour and low-income share ' + p.ej + ' percent.';
    }
    function tipFor(d) {
      return '<b>' + esc(d.z.z + ' · ' + d.z.c) + '</b><small>' + esc(d.z.y) + ' County' + (d.z.ap ? ' · position estimated' : '') + '</small>' +
        '<dl><dt>Projected EVs ' + year + '</dt><dd>' + num(d.f) + '</dd>' +
        '<dt>Energy burden</dt><dd>' + d.z.eb + '%</dd>' +
        '<dt>Equity weight</dt><dd>' + d.w.toFixed(2) + '</dd>' +
        '<dt>Displacement rank</dt><dd>' + d.rank + ' of ' + A.zips.length + '</dd></dl>';
    }
    function pkTip(p) {
      return '<b>' + esc(p.n) + '</b><small>PEAKER PLANT</small><dl>' +
        '<dt>Fuel</dt><dd>' + esc(p.fuel) + '</dd><dt>Capacity</dt><dd>' + p.mw + ' MW</dd>' +
        '<dt>CO₂e</dt><dd>' + (p.co2 ? num(p.co2) + ' t' : 'none reported') + '</dd>' +
        '<dt>POC + low income</dt><dd>' + p.ej + '%</dd></dl>';
    }

    var focusIdx = 0, current = [];

    function render() {
      var t = year - 2025;
      var rows = A.zips.map(function (z) {
        var f = fleetAt(z.e, z.K, z.r, t, scen), w = equity(z);
        return { z: z, f: f, w: w, bin: binOf(w, EDGES), r: radius(f), s: 0, rank: 0 };
      });
      var fmax = 0, ftot = 0;
      rows.forEach(function (d) { if (d.f > fmax) fmax = d.f; ftot += d.f; });
      /* Displacement score: the equity weight times this zip's own share of the
         projected fleet. It used to use the COUNTY's fleet share, which is identical
         for every zip in a county and always 1.0 for Cook — so the ranking could not
         change, and the year slider and scenario tabs moved nothing here. */
      rows.forEach(function (d) { d.s = d.w * (d.f / fmax); });
      var ranked = rows.slice().sort(function (a, b) { return b.s - a.s; });
      ranked.forEach(function (d, i) { d.rank = i + 1; });
      current = ranked;

      main.innerHTML = baseMain.under + markup(rows, pm, { focusable: true }) + baseMain.over;
      if (inset) inset.innerHTML = baseInset.under + markup(rows, pi, { focusable: false }) + baseInset.over;

      byId('at-ev').textContent = num(ftot);
      byId('at-mwh').textContent = num(ftot * PART[scen] * 10 / 1000);

      byId('atlist').innerHTML = ranked.slice(0, 10).map(function (d) {
        return '<li><span class="who">' + esc(d.z.z + ' · ' + d.z.c) +
          '<small>' + esc(d.z.y) + ' County · EB ' + d.z.eb + '% · ' + num(d.f) + ' EVs' + (d.z.ap ? ' · est.' : '') + '</small></span>' +
          '<span class="bar"><i style="width:' + (d.s / ranked[0].s * 100).toFixed(0) + '%;background:' + RAMP[d.bin] + '"></i></span></li>';
      }).join('');

      var hb20 = ranked.slice(0, 20).filter(function (d) { return d.z.hb; }).length;
      byId('athyp').textContent = hb20 + ' OF THE TOP 20 DISPLACEMENT ZIPS ARE TOP-QUARTILE ENERGY-BURDEN COMMUNITIES IN ' + year +
        ' UNDER THE ' + ['BASE', 'OPTIMISTIC', 'PESSIMISTIC'][scen] + ' SCENARIO.';

      byId('attable').innerHTML = table(
        ['ZIP · place', 'County', 'Projected EVs', 'Energy burden %', 'Equity weight', 'Rank', 'EIEC', 'Position'],
        ranked.map(function (d) {
          return [d.z.z + ' ' + d.z.c, d.z.y, num(d.f), d.z.eb.toFixed(1), d.w.toFixed(3), String(d.rank),
            d.z.hb ? 'yes' : '—', d.z.ap ? 'estimated' : 'station-derived'];
        }),
        'All ' + A.zips.length + ' ZIP codes ranked by peaker-displacement score in ' + year
      );

      bindMarks();
      walk = walkOrder();
      main.setAttribute('aria-label',
        'Map of ComEd territory, northern Illinois, in ' + year + ' under the ' + ['base', 'optimistic', 'pessimistic'][scen] +
        ' adoption scenario. ' + walk.length + ' marks: zip codes sized by projected EV fleet and coloured by equity weight, ' +
        'plus ' + A.peakers.length + ' peaker plants. Highest displacement: ' + ranked[0].z.c + ', ' + ranked[0].z.y + ' County. ' +
        hb20 + ' of the top 20 are top-quartile energy burden. ' +
        'Press the arrow keys to walk the marks in rank order, or open the table view below the map.');
    }
    var ATLAS_HINT = 'Focus the map and use the arrow keys, or hover a mark, to read its values here.';

    /* Mouse only — the keyboard path is the figure-level cursor below. */
    function bindMarks() {
      main.querySelectorAll('.zip').forEach(function (n) {
        var d = current.find(function (x) { return x.z.z === +n.getAttribute('data-z'); });
        if (!d) return;
        n.addEventListener('mousemove', function (e) { showTip(tipFor(d), e.clientX, e.clientY); });
        n.addEventListener('mouseleave', hideTip);
      });
      main.querySelectorAll('[data-est]').forEach(function (n) {
        var g = estGroups[n.getAttribute('data-est')];
        if (!g) return;
        n.addEventListener('mousemove', function (e) { showTip(estTip(g), e.clientX, e.clientY); });
        n.addEventListener('mouseleave', hideTip);
      });
      main.querySelectorAll('.pk').forEach(function (n) {
        var p = A.peakers.find(function (x) { return x.n === n.getAttribute('data-pk'); });
        if (!p) return;
        n.addEventListener('mousemove', function (e) { showTip(pkTip(p), e.clientX, e.clientY); });
        n.addEventListener('mouseleave', hideTip);
      });
    }

    /* The keyboard walks the located zip codes in displacement-rank order — the
       order the ranking is about, not the order the file happens to be in — then
       the unplaced county pools, then the peakers. */
    function walkOrder() {
      var out = [];
      current.forEach(function (d) {
        var n = main.querySelector('.zip[data-z="' + d.z.z + '"]');
        if (n) out.push({ node: n, say: label(d), tip: tipFor(d) });
      });
      main.querySelectorAll('[data-est]').forEach(function (n) {
        var g = estGroups[n.getAttribute('data-est')];
        if (g) out.push({ node: n, say: estLabel(g), tip: estTip(g) });
      });
      main.querySelectorAll('.pk').forEach(function (n) {
        var p = A.peakers.find(function (x) { return x.n === n.getAttribute('data-pk'); });
        if (p) out.push({ node: n, say: pkLabel(p), tip: pkTip(p) });
      });
      return out;
    }
    var walk = [];
    function drawAtCursor(i) {
      var c = main.querySelector('.kcursor');
      if (!c) return;
      if (i == null || !walk[i]) { c.innerHTML = ''; return; }
      var b = walk[i].node.getBBox();
      var cx = b.x + b.width / 2, cy = b.y + b.height / 2;
      var r = Math.max(b.width, b.height) / 2 + 5;
      c.innerHTML = '<circle class="atcursor" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r.toFixed(1) + '"/>';
    }
    keyboardFigure(main, {
      count: function () { return walk.length; },
      select: function (i) {
        drawAtCursor(i);
        readout.textContent = walk[i] ? walk[i].say : '';
        if (walk[i]) {
          var r = walk[i].node.getBoundingClientRect();
          showTip(walk[i].tip, r.left + r.width / 2, r.top);
        }
      },
      clear: function () { drawAtCursor(null); hideTip(); readout.textContent = ATLAS_HINT; }
    });

    /* legends — rendered once; both maps share every scale */
    (function legends() {
      var sizes = [1000, 10000, 30000];
      var g = '<svg class="lgsvg" viewBox="0 0 200 56" role="img" aria-label="Circle size shows projected electric vehicles: 1,000, 10,000 and 30,000">';
      var x = 16;
      sizes.forEach(function (v) {
        var r = radius(v);
        g += '<circle class="lgdot" cx="' + x + '" cy="34" r="' + r.toFixed(1) + '"/>';
        g += '<text class="lgtx" x="' + x + '" y="52" text-anchor="middle">' + (v / 1000) + 'k</text>';
        x += 2 * r + 34;
      });
      byId('lg-size').innerHTML = g + '</svg>';

      byId('lg-ramp').innerHTML = RAMP.map(function (c) {
        return '<i style="background:' + c + '"></i>';
      }).join('') + '<span class="lgends"><span>lower</span><span>higher</span></span>';
    })();

    byId('atpktable').innerHTML = table(
      ['Plant', 'Fuel', 'MW', 'CO₂e (t)', 'POC + low income %'],
      A.peakers.slice().sort(function (a, b) { return b.co2 - a.co2; }).map(function (p) {
        return [p.n, p.fuel, num(p.mw, 1), p.co2 ? num(p.co2) : 'none reported', String(p.ej)];
      }),
      'The 21 peaker plants in ComEd territory'
    );

    document.querySelectorAll('[data-as]').forEach(function (b) {
      b.addEventListener('click', function () {
        scen = +b.getAttribute('data-as');
        document.querySelectorAll('[data-as]').forEach(function (x) {
          var on = x === b;
          x.classList.toggle('on', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        render();
      });
    });
    var yr = byId('atyear');
    yr.addEventListener('input', function () {
      year = +yr.value;
      byId('atyearout').textContent = year;
      render();
    });
    function toggle(id, get, set) {
      byId(id).addEventListener('click', function () {
        set(!get());
        this.classList.toggle('on', get());
        this.setAttribute('aria-pressed', get() ? 'true' : 'false');
        render();
      });
    }
    toggle('athb', function () { return showHB; }, function (v) { showHB = v; });
    toggle('atpk', function () { return showPK; }, function (v) { showPK = v; });
    render();
  }

  /* ============================================================ boot */

  initEmissions();
  initTraj();
  initAtlas();

  /* Reveals stay transform-only. An opacity:0 reveal was removed from the shared
     script as a contrast flag (main.js) and had crept back into this page. */
  if (!reduced && typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
    document.querySelectorAll('.viz, .sgrid__cell, .flow__step').forEach(function (el) {
      gsap.from(el, { y: 24, duration: 0.7, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 92%' } });
    });
  }
})();
