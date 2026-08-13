/**
 * fix-atlas-geo.mjs — one-time data repair for js/atlas.js. Not loaded at runtime.
 *
 * Run:  node tools/fix-atlas-geo.mjs --check   (report only, writes nothing)
 *       node tools/fix-atlas-geo.mjs           (apply and rewrite js/atlas.js)
 *
 * WHY THIS EXISTS
 *
 * The atlas used to draw ZIP codes as dots in bare lon/lat space with no geography
 * behind them, so a dot in the wrong place was invisible — there was nothing for it
 * to be in the wrong place *relative to*. Adding real county polygons made 20 ZIPs
 * visibly wrong. Two separate defects:
 *
 *   1. ap=1 "county-anchored" positions are not county centroids. Seven Quad Cities
 *      ZIPs (Rock Island / Henry / Mercer, true longitude around -90.5) sit at about
 *      -88.1, roughly 200 km east, in the western Chicago suburbs. Every ap=1 ZIP is
 *      re-anchored here to a real centroid computed from the baked county polygons.
 *
 *   2. Thirteen ap=0 ZIPs carry a county label that disagrees with their coordinate:
 *      the Rockford 611xx ZIPs are labelled Ogle (Rockford is Winnebago), the Joliet
 *      604xx ZIPs are labelled Kendall (Joliet is Will), Aurora and St. Charles are
 *      labelled DuPage (both are Kane), Elgin is labelled Cook (Kane).
 *      For these the coordinate is the measured value and the county column is
 *      derived, so the county is corrected from the coordinate by point-in-polygon.
 *
 * THE ONE CASE POINT-IN-POLYGON GETS WRONG is handled by an explicit override below.
 * Do not remove the override table without re-reading its comment.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ATLAS = join(ROOT, 'js', 'atlas.js');
const GEO = join(ROOT, 'js', 'il-geo.js');
const CHECK_ONLY = process.argv.includes('--check');

/**
 * ZIPs where the coordinate is wrong and the county label is right, so
 * point-in-polygon would "correct" a good label using a bad coordinate.
 *
 * 60104 Bellwood is a village in Cook County at latitude 41.88. The dataset has
 * 42.3136 — a latitude up in Lake County, while the longitude is very nearly right.
 * It reads as a transcription error in one field. Trust the label, treat the
 * position as estimated, and let it be re-anchored to the Cook centroid.
 */
const OVERRIDES = {
  60104: { keepCounty: 'Cook', anchor: true, why: 'latitude 42.3136 is ~48 km north of Bellwood; longitude is correct' },
};

/* ---------- load ---------- */

/** Both files are `window.NAME = {...};` — anchor on the global, not on the first
    `=`, since il-geo.js carries a header comment that contains one. */
function loadGlobal(path, global) {
  const src = readFileSync(path, 'utf8');
  const at = src.indexOf(global);
  if (at === -1) throw new Error(`${path} does not define ${global}`);
  const json = src.slice(src.indexOf('=', at + global.length) + 1).trim().replace(/;\s*$/, '');
  return { src, data: JSON.parse(json) };
}

const loadAtlas = () => loadGlobal(ATLAS, 'window.ATLAS');
const loadGeo = () => loadGlobal(GEO, 'window.ILGEO').data;

/* ---------- geometry ---------- */

/** Flat [lon,lat,...] -> [[lon,lat],...] */
function pairs(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const countyRings = (c) => c.r.map(pairs);
const pointInCounty = (lon, lat, c) => countyRings(c).some((r) => pointInRing(lon, lat, r));

/** Great-circle-ish distance in km, flat-earth at this latitude. 1 deg lon = 83.4 km. */
function segKm(p, a, b) {
  let [x, y] = a;
  const dx = b[0] - x, dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  return Math.hypot((p[0] - x) * 83.4, (p[1] - y) * 111.3);
}

/** 0 if inside, otherwise km to the nearest boundary segment. */
function kmOutside(lon, lat, county) {
  if (pointInCounty(lon, lat, county)) return 0;
  let min = Infinity;
  for (const ring of countyRings(county)) {
    for (let i = 1; i < ring.length; i++) min = Math.min(min, segKm([lon, lat], ring[i - 1], ring[i]));
  }
  return min;
}

/**
 * How far outside its own county a ZIP has to fall before the county label is
 * treated as wrong rather than as boundary noise.
 *
 * This threshold is the whole reason this pass is safe. A ZIP centroid that sits
 * 2 km from a county line is not an error — it is a centroid near a border, and
 * which side of a simplified polygon it lands on is arbitrary. Deerfield measures
 * 2.33 km from Cook and 2.34 km from Lake; "correcting" it would be a coin flip
 * dressed up as a repair. Genuine label errors here are 10 km and up (Rockford
 * labelled Ogle, Joliet labelled Kendall), and the broken anchors are 160 km and up.
 */
const LABEL_ERROR_KM = 5;

/** Area-weighted centroid of the largest ring — the shoelace centroid, not a bbox centre. */
function centroid(county) {
  let best = null, bestArea = -1;
  for (const ring of countyRings(county)) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      a += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f;
    }
    a *= 0.5;
    if (Math.abs(a) > bestArea) { bestArea = Math.abs(a); best = [cx / (6 * a), cy / (6 * a), ring]; }
  }
  return best;
}

/**
 * Place the anchored ZIPs of one county on a tight golden-angle spiral around its
 * centroid. Deterministic, and every point is verified to land inside the county.
 *
 * The radius is deliberately small. These positions are unknown, not approximate —
 * spreading them across the county would invent a distribution the data does not
 * have, and in Cook it would scatter city-of-Chicago 606xx ZIPs out into the far
 * suburbs. A tight cluster reads as what it is: a pile of estimates sitting on a
 * county centroid. The map draws them in a distinct style and the table view flags
 * them, so nobody mistakes the cluster for a finding.
 */
const SPREAD_FRAC = 0.15;

function spread(county, n) {
  const [cx, cy] = centroid(county);
  if (n === 1) return [[cx, cy]];
  let maxR = 0;
  for (const ring of countyRings(county)) {
    for (const [x, y] of ring) maxR = Math.max(maxR, Math.hypot(x - cx, y - cy));
  }
  const out = [];
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const frac = Math.sqrt((i + 0.5) / n);
    const theta = i * GOLDEN;
    let r = frac * maxR * SPREAD_FRAC;
    let p = null;
    // Shrink toward the centroid until the point is genuinely inside the county.
    for (let attempt = 0; attempt < 12; attempt++) {
      const cand = [cx + Math.cos(theta) * r * 1.32, cy + Math.sin(theta) * r];
      if (pointInCounty(cand[0], cand[1], county)) { p = cand; break; }
      r *= 0.72;
    }
    out.push(p || [cx, cy]);
  }
  return out;
}

/* ---------- repair ---------- */

const { src, data } = loadAtlas();
const geo = loadGeo();
const byName = {};
for (const k in geo) if (geo[k].t === 1) byName[geo[k].n] = geo[k];

const missing = [...new Set(data.zips.map((z) => z.y))].filter((n) => !byName[n]);
if (missing.length) throw new Error(`county referenced by zips but absent from il-geo.js: ${missing.join(', ')}`);

const relabelled = [], reanchored = [], flagged = [];

/* Pass 1 — correct county labels from coordinates, for trusted coordinates only,
   and only where the disagreement is too large to be boundary noise. */
for (const z of data.zips) {
  const ov = OVERRIDES[z.z];
  if (z.ap || ov?.keepCounty) continue;
  const off = kmOutside(z.lo, z.la, byName[z.y]);
  if (off <= LABEL_ERROR_KM) continue;
  const hit = Object.values(byName).find((c) => pointInCounty(z.lo, z.la, c));
  if (hit) {
    relabelled.push([z.z, z.c, z.y, hit.n, `${off.toFixed(0)} km outside ${z.y}`]);
    z.y = hit.n;
  } else {
    flagged.push([z.z, z.c, z.y, `${off.toFixed(0)} km outside its county and inside no other`]);
  }
}

/* Pass 2 — re-anchor every estimated position to a real centroid. */
for (const zip of Object.keys(OVERRIDES)) {
  const z = data.zips.find((x) => x.z === +zip);
  if (z && OVERRIDES[zip].anchor) { z.ap = 1; flagged.push([z.z, z.c, z.y, OVERRIDES[zip].why]); }
}

const groups = {};
for (const z of data.zips) if (z.ap) (groups[z.y] ??= []).push(z);
for (const name in groups) {
  const list = groups[name].sort((a, b) => a.z - b.z); // deterministic
  const pts = spread(byName[name], list.length);
  list.forEach((z, i) => {
    const moved = Math.hypot((z.lo - pts[i][0]) * 83.4, (z.la - pts[i][1]) * 111.3);
    z.lo = Math.round(pts[i][0] * 1e4) / 1e4;
    z.la = Math.round(pts[i][1] * 1e4) / 1e4;
    if (moved > 25) reanchored.push([z.z, z.c, z.y, `${moved.toFixed(0)} km`]);
  });
}

/* ---------- verify ---------- */

const stillWrong = data.zips
  .map((z) => [z, kmOutside(z.lo, z.la, byName[z.y])])
  .filter(([, km]) => km > LABEL_ERROR_KM);

console.log(`county labels corrected from coordinates: ${relabelled.length}`);
relabelled.forEach((r) => console.log(`   ${r[0]} ${r[1]}: ${r[2]} -> ${r[3]}  (${r[4]})`));
console.log(`\nestimated positions moved more than 25 km: ${reanchored.length}`);
reanchored.forEach((r) => console.log(`   ${r[0]} ${r[1]} (${r[2]}): ${r[3]}`));
console.log(`\nmanually overridden / flagged: ${flagged.length}`);
flagged.forEach((r) => console.log(`   ${r[0]} ${r[1]} (${r[2]}): ${r[3]}`));
console.log(`\nzips more than ${LABEL_ERROR_KM} km outside their own county after repair: ${stillWrong.length}`);
stillWrong.forEach(([z, km]) => console.log(`   ${z.z} ${z.c} (${z.y}) — ${km.toFixed(1)} km`));

if (stillWrong.length) { console.error('\nrepair incomplete — not writing'); process.exit(1); }

const anchored = data.zips.filter((z) => z.ap).length;
console.log(`\n${data.zips.length} zips · ${anchored} position-estimated · ${data.zips.length - anchored} station-derived`);

if (CHECK_ONLY) { console.log('\n--check: nothing written'); process.exit(0); }

const prefix = src.slice(0, src.indexOf('=') + 1);
writeFileSync(ATLAS, `${prefix}${JSON.stringify(data)};\n`);
console.log(`\nwrote js/atlas.js`);
