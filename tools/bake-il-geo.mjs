/**
 * bake-il-geo.mjs — one-time developer script. NOT loaded by the site at runtime.
 *
 * Emits js/il-geo.js: county boundary rings for the ComEd-territory map on
 * comed-v2x.html. Before this existed the "map" had no geography at all — 372 ZIP
 * circles in raw lon/lat space over a four-point dashed line standing in for Lake
 * Michigan.
 *
 * Run:  node tools/bake-il-geo.mjs
 *       node tools/bake-il-geo.mjs --selftest
 *
 * Source: plotly's mirror of the US Census county cartographic boundaries, plain
 * GeoJSON (no TopoJSON decode). properties.STATE is the FIPS state code,
 * properties.NAME the county name.
 *
 * Two things worth knowing before changing anything here:
 *
 * 1. SIMPLIFICATION TOLERANCE IS TIED TO THE RENDER SCALE. At the map's scale
 *    (~230 px per degree of longitude) a tolerance of 0.001 deg is about a quarter
 *    of a pixel — visually lossless. If the map is ever made significantly larger,
 *    re-bake at a smaller tolerance.
 *
 * 2. LAKE MICHIGAN NEEDS NO DATA. The census county polygons are clipped to the
 *    shoreline, so Cook's and Lake's eastern boundaries ARE the coast. The page
 *    paints one lake-colored rect behind everything and the land polygons on top;
 *    whatever is left uncovered is water. This is why the bake includes counties in
 *    Wisconsin, Indiana and Iowa that are outside ComEd territory — without them the
 *    surrounding land would render as lake.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_URL = 'https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json';
const CACHE = join(ROOT, 'tools', '.cache', 'us-counties.geojson');
const OUT = join(ROOT, 'js', 'il-geo.js');

/* Counties to include as context land, beyond ComEd territory. Without these the
   land north, east and west of the territory renders as Lake Michigan. */
const CONTEXT_STATES = { '17': 'IL', '55': 'WI', '18': 'IN', '19': 'IA' };

/* Generous bbox — wider than the drawn map, since the projection is fit to the data
   at runtime and the map's extent is allowed to change without a re-bake. */
const CLIP = { lon0: -91.60, lon1: -87.00, lat0: 40.10, lat1: 42.95 };

/* The census source is already generalized — Cook is only 129 points to begin with —
   so there is very little to win by simplifying territory counties hard, and the
   Lake Michigan shoreline is exactly the detail that makes the map recognizable.
   0.0003 deg is ~0.07px at render scale and keeps Cook at 54 of its 129 points. */
const TOLERANCE = 0.0003;
const DECIMALS = 3; // ~111m; ~0.26px at render scale

/* ---------- source ---------- */

async function loadSource() {
  if (existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, 'utf8'));
  process.stderr.write('fetching county boundaries (~3.2 MB)...\n');
  const res = await fetch(SRC_URL);
  if (!res.ok) throw new Error(`source fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, text);
  return JSON.parse(text);
}

/** The 25 ComEd counties, read from atlas.js so the two files cannot drift apart. */
function comedCounties() {
  const js = readFileSync(join(ROOT, 'js', 'atlas.js'), 'utf8');
  const data = JSON.parse(js.slice(js.indexOf('=') + 1).trim().replace(/;$/, ''));
  return Object.keys(data.counties);
}

/* ---------- geometry ---------- */

function ringsOf(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  return polys.flat();
}

function intersectsClip(geom) {
  for (const ring of ringsOf(geom)) {
    for (const [lon, lat] of ring) {
      if (lon >= CLIP.lon0 && lon <= CLIP.lon1 && lat >= CLIP.lat0 && lat <= CLIP.lat1) return true;
    }
  }
  return false;
}

/** Perpendicular distance from p to the segment ab, in degrees. */
function segDist(p, a, b) {
  let [x, y] = a;
  let dx = b[0] - x, dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  return Math.hypot(p[0] - x, p[1] - y);
}

/** Douglas–Peucker, iterative so a pathological ring cannot blow the stack. */
function simplify(points, tol) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let worst = 0, idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = segDist(points[i], points[lo], points[hi]);
      if (d > worst) { worst = d; idx = i; }
    }
    if (idx !== -1 && worst > tol) {
      keep[idx] = 1;
      stack.push([lo, idx], [idx, hi]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Simplify, round, drop consecutive duplicates, flatten to [lon,lat,lon,lat,...]. */
function bakeRing(ring, tol) {
  const k = 10 ** DECIMALS;
  const round = (v) => Math.round(v * k) / k;
  const simplified = simplify(ring, tol);
  const flat = [];
  let px = NaN, py = NaN;
  for (const [lon, lat] of simplified) {
    const x = round(lon), y = round(lat);
    if (x === px && y === py) continue; // rounding can collapse neighbours
    flat.push(x, y);
    px = x; py = y;
  }
  return flat.length >= 8 ? flat : null; // < 4 points is not a polygon
}

/* ---------- bake ---------- */

async function bake(comedNames) {
  const geo = await loadSource();
  const wanted = new Set(comedNames);
  const out = {};
  const matched = new Set();
  let rawPoints = 0, keptPoints = 0;

  for (const f of geo.features) {
    const { STATE, NAME } = f.properties;
    if (!CONTEXT_STATES[STATE]) continue;
    if (!intersectsClip(f.geometry)) continue;

    const territory = STATE === '17' && wanted.has(NAME);
    if (territory) matched.add(NAME);

    /* Context land is only ever a backdrop, so it can be simplified much harder. */
    const tol = territory ? TOLERANCE : TOLERANCE * 8;
    const rings = [];
    for (const ring of ringsOf(f.geometry)) {
      rawPoints += ring.length;
      const baked = bakeRing(ring, tol);
      if (baked) { rings.push(baked); keptPoints += baked.length / 2; }
    }
    if (!rings.length) continue;

    out[f.properties.GEO_ID.slice(-5)] = {
      n: NAME,
      s: CONTEXT_STATES[STATE],
      t: territory ? 1 : 0,
      r: rings,
    };
  }

  /* THE ZERO-INPUT TEST, as a permanent guard rather than a one-off check.
     A county that matches nothing emits no ring, and a missing county looks
     exactly like a clean render. Fail loudly instead. */
  const missing = comedNames.filter((n) => !matched.has(n));
  if (missing.length) {
    throw new Error(
      `${missing.length} ComEd county name(s) matched no census feature: ${missing.join(', ')}.\n` +
      `A silently-missing county renders as nothing, which is indistinguishable from correct output.`
    );
  }

  return { out, rawPoints, keptPoints };
}

/* ---------- self-test ---------- */

async function selftest() {
  let failures = 0;
  const check = (name, ok, detail = '') => {
    process.stdout.write(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}\n`);
    if (!ok) failures++;
  };

  // The guard must fire on a county that does not exist.
  let threw = false;
  try { await bake([...comedCounties(), 'Nonexistent Parish']); }
  catch (e) { threw = /matched no census feature/.test(e.message); }
  check('unmatched county name throws instead of emitting an empty ring', threw);

  // Simplification must not silently empty a real ring.
  const square = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
  check('a real ring survives simplification', bakeRing(square, TOLERANCE) !== null);
  check('a degenerate ring is dropped, not emitted', bakeRing([[0, 0], [0, 0]], TOLERANCE) === null);

  const { out } = await bake(comedCounties());
  const terr = Object.values(out).filter((c) => c.t === 1);
  check('all 25 ComEd counties present', terr.length === 25, `got ${terr.length}`);
  check('context land present', Object.values(out).some((c) => c.t === 0));
  /* The eastern edge of Cook and Lake IS the Lake Michigan shoreline — the only
     reason this page needs no lake dataset. Simplification is allowed to thin it,
     but not to straighten it into a coastline-shaped nothing, so assert on the
     shoreline points specifically rather than on a whole-ring count. */
  const eastEdge = (fips) => {
    const pts = [];
    for (const ring of out[fips].r) {
      for (let i = 0; i < ring.length; i += 2) if (ring[i] > -87.72) pts.push([ring[i], ring[i + 1]]);
    }
    return pts;
  };
  const cookShore = eastEdge('17031');
  check('Cook is clipped to the shoreline, not squared off',
    Math.max(...cookShore.map((p) => p[0])) < -87.4, `east edge ${Math.max(...cookShore.map((p) => p[0]))}`);
  check('the shoreline keeps its curve', cookShore.length >= 8, `${cookShore.length} shoreline pts`);
  check('Cook keeps most of its source detail',
    out['17031'].r[0].length / 2 >= 45, `${out['17031'].r[0].length / 2} of 129 source pts`);

  process.stdout.write(failures ? `\n${failures} check(s) failed\n` : '\nall checks passed\n');
  process.exit(failures ? 1 : 0);
}

/* ---------- main ---------- */

if (process.argv.includes('--selftest')) {
  await selftest();
} else {
  const names = comedCounties();
  const { out, rawPoints, keptPoints } = await bake(names);

  const body = Object.entries(out)
    .map(([fips, c]) => `"${fips}":{"n":${JSON.stringify(c.n)},"s":"${c.s}","t":${c.t},"r":[${c.r.map((r) => '[' + r.join(',') + ']').join(',')}]}`)
    .join(',\n');

  const header =
    `/* GENERATED by tools/bake-il-geo.mjs — do not edit by hand.\n` +
    `   County boundaries for the ComEd territory map on comed-v2x.html.\n` +
    `   Source: US Census cartographic boundaries via plotly/datasets.\n` +
    `   Douglas-Peucker tolerance ${TOLERANCE} deg, coordinates at ${DECIMALS} dp —\n` +
    `   both tuned to the current render scale (~230 px/deg). Re-bake if the map grows.\n` +
    `   t:1 = ComEd territory, t:0 = surrounding land drawn so the lake reads correctly.\n` +
    `   Rings are flat [lon,lat,lon,lat,...] and are projected at runtime. */\n`;

  writeFileSync(OUT, `${header}window.ILGEO = {\n${body}\n};\n`);

  const bytes = readFileSync(OUT).length;
  const terr = Object.values(out).filter((c) => c.t === 1).length;
  process.stdout.write(
    `wrote js/il-geo.js — ${Object.keys(out).length} counties ` +
    `(${terr} ComEd + ${Object.keys(out).length - terr} context), ` +
    `${keptPoints} pts from ${rawPoints}, ${(bytes / 1024).toFixed(1)} KB\n`
  );
}
