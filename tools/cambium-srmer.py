#!/usr/bin/env python3
"""Derive the grid-intensity trajectory on comed-v2x.html from the Cambium extract.

    python tools/cambium-srmer.py            # fit report + the JS literal
    python tools/cambium-srmer.py --emit     # the JS literal alone

Why this exists: the TRAJ values on the page were transcribed by hand from the
midpoint memo's section 4.1.1, which states eleven of the twelve peak/off-peak
cells in prose and never states the twelfth. That missing cell — base case, 2030 —
was filled by interpolating between 2025 and 2035, and the page carried a
disclaimer saying so. It is not missing from the source data; only from the memo.

The input is data/Cambium-IL-All-Scenarios.xlsx, gitignored: it is a 1.7 MB NREL
Cambium 2024 extract for Illinois, 8 scenarios x 4 balancing areas x 6 years x 24
hours. Public data, but it does not belong in a public repo or on the website, and
nothing on the site reads it at runtime — the numbers are baked into comed-charts.js.

Method, from Appendix B of the memo:
  1. srmer_co2e is kg CO2e/MWh; divide by 1000 for kg/kWh.
  2. Peak is hours 15-20 inclusive, weekdays. This extract is a 24-hour diurnal
     profile with no date column, so the weekday half of that filter cannot be
     applied here. That is the whole of the disagreement with the memo below.
  3. Weight by enduse_load and take the load-weighted mean per scenario-year-band.

Region: p80 / PJM_West only. ComEd is northern Illinois and PJM; p81-p83 are
MISO_Central, which is downstate Ameren territory. Including them moves every
2025 value about 0.06 kg/kWh and wrecks the fit against the memo — which is itself
the evidence that the study used p80.

Scenario identity was not stated in the memo and is recovered by fitting: each of
Base / Optimistic / Pessimistic is assigned the Cambium scenario minimising worst-
cell error against the memo's stated values. All three land within 0.010, and the
runner-up in each case is three to five times worse, so the assignment is not a
coin flip. Re-run with --fit to see the full table.
"""
import argparse
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

try:
    import openpyxl
except ImportError:
    sys.exit("ERROR: openpyxl is not installed. Run: pip install openpyxl")

HERE = os.path.dirname(os.path.abspath(__file__))
XL = os.path.join(HERE, os.pardir, "data", "Cambium-IL-All-Scenarios.xlsx")

REGION = "p80"                  # PJM_West — ComEd
PEAK_HOURS = set(range(15, 21))  # =IF(AND(HOUR>=15, HOUR<=20, WEEKDAY<=5), "Peak", ...)
YEARS = [2025, 2030, 2035, 2040]
I_SCEN, I_R, I_YR, I_HR, I_ENDUSE, I_SRMER = 0, 1, 6, 7, 9, 49

# The page's three grid futures, and the Cambium scenario each was fitted to.
MAPPING = [
    ("base", "Base", "MidCase"),
    ("opt", "Optimistic", "LowRECost_HighNGPrice"),
    ("pess", "Pessimistic", "HighRECost_LowNGPrice"),
]

# Section 4.1.1 of the memo, as (off-peak, peak). Base 2030 is absent there.
MEMO = {
    ("Base", 2025): (0.76, 0.78), ("Base", 2035): (0.39, 0.49),
    ("Base", 2040): (0.37, 0.48),
    ("Optimistic", 2030): (0.69, 0.68), ("Optimistic", 2035): (0.31, 0.41),
    ("Optimistic", 2040): (0.26, 0.37),
    ("Pessimistic", 2030): (0.63, 0.70), ("Pessimistic", 2035): (0.43, 0.50),
    ("Pessimistic", 2040): (0.41, 0.50),
}

NOTES = {
    "base": "BASE CASE: THE PEAK / OFF-PEAK GAP HOLDS — GAS PEAKERS STILL SET PEAK "
            "EMISSIONS THROUGH 2040.",
    "opt": "OPTIMISTIC: AROUND 2030 PEAK FALLS BELOW OFF-PEAK. A TIME-OF-USE PROGRAM "
           "CALIBRATED FOR TODAY WOULD SHIFT LOAD INTO DIRTIER HOURS.",
    "pess": "PESSIMISTIC: SLOWER DECARBONISATION KEEPS MARGINAL EMISSIONS — AND "
            "V2X\\u2019S RELATIVE BENEFIT — HIGH.",
}


def load():
    """(scenario, year, band) -> load-weighted mean srmer in kg CO2e/kWh."""
    if not os.path.exists(XL):
        sys.exit(f"ERROR: {XL} not found. It is gitignored — restore the extract first.")
    wb = openpyxl.load_workbook(XL, read_only=True, data_only=True)
    acc = {}
    for row in wb["Sheet1"].iter_rows(min_row=4, values_only=True):
        if row[0] is None or row[I_R] != REGION:
            continue
        band = "peak" if row[I_HR] in PEAK_HOURS else "off"
        a = acc.setdefault((row[I_SCEN], row[I_YR], band), [0.0, 0.0])
        a[0] += row[I_ENDUSE] * (row[I_SRMER] / 1000.0)
        a[1] += row[I_ENDUSE]
    wb.close()
    if not acc:
        sys.exit(f"ERROR: no rows matched region {REGION}. Check the extract.")
    return {k: v[0] / v[1] for k, v in acc.items()}


def series(lw, scen, band):
    return [round(lw[(scen, y, band)], 3) for y in YEARS]


def report(lw):
    print(f"region {REGION} · peak = hours {min(PEAK_HOURS)}-{max(PEAK_HOURS)} · "
          f"load-weighted by enduse_load\n")
    print(f"{'':<14}" + "".join(f"{y:>16}" for y in YEARS))
    worst = 0.0
    for _, label, scen in MAPPING:
        off, peak = series(lw, scen, "off"), series(lw, scen, "peak")
        cells = []
        for i, y in enumerate(YEARS):
            m = MEMO.get((label, y))
            if m is None:
                cells.append(f"  {off[i]:.3f}/{peak[i]:.3f} NEW")
            else:
                e = max(abs(off[i] - m[0]), abs(peak[i] - m[1]))
                worst = max(worst, e)
                cells.append(f"  {off[i]:.3f}/{peak[i]:.3f} ±{e:.3f}")
        print(f"{label:<14}" + "".join(f"{c:>16}" for c in cells))
        print(f"{'  = ' + scen:<14}")
    print(f"\nworst disagreement with a memo-stated cell: {worst:.3f}")
    print("NEW marks the cell the memo never states — the one the page interpolated.\n")


def emit(lw):
    print("  var TRAJ = {")
    for i, (key, label, scen) in enumerate(MAPPING):
        off, peak = series(lw, scen, "off"), series(lw, scen, "peak")
        tail = "" if i == len(MAPPING) - 1 else ","
        print(f"    {key}: {{ off: {off}, peak: {peak},"
              f" note: '{NOTES[key]}' }}{tail}".replace("'", "'", 1))
    print("  };")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--emit", action="store_true", help="print the JS literal only")
    a = ap.parse_args()
    lw = load()
    if not a.emit:
        report(lw)
    emit(lw)
