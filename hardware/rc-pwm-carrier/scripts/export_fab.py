#!/usr/bin/env python3
"""Export JLCPCB fabrication files for the carrier board.

Outputs (under output/jlcpcb/):
  gerbers/         — copper, mask, silk, edge + drill files
  carrier-gerbers.zip
  carrier-bom.csv  — JLC columns: Comment, Designator, Footprint, LCSC
  carrier-cpl.csv  — JLC columns: Designator, Mid X, Mid Y, Layer, Rotation

Run with KiCad's bundled python.
"""
import csv
import subprocess
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJ = HERE.parent
CLI = r"C:\Program Files\KiCad\10.0\bin\kicad-cli.exe"
BOARD = PROJ / "carrier.kicad_pcb"
OUT = PROJ / "output" / "jlcpcb"
GERB = OUT / "gerbers"

# BOM: JLC assembles everything except bare test pads / holes.
# LCSC numbers: verified ones filled; blanks carry a search hint for the
# JLCPCB parts picker (their BOM tool matches by spec too).
BOM_ROWS = [
    # Comment, Designators, Footprint hint, LCSC
    ("10k 0603 1%",                        "R1,R3",  "0603",        "C25804"),
    ("15k 0603 1%",                        "R2,R4",  "0603",        ""),   # picker: 15kΩ 0603 1% basic
    ("10uF 25V X5R",                       "C1",     "0805",        "C15850"),
    ("100nF 50V X7R",                      "C2",     "0603",        "C14663"),
    ("22uF 25V X5R",                       "C3,C4",  "0805",        "C45783"),
    ("SS34 Schottky 3A 40V",               "D1,D2",  "SMA",         "C8678"),
    ("AP63205WU-7 buck 5V 2A",             "U2",     "TSOT-23-6",   "C2071056"),
    ("6.8uH 4x4mm power inductor >=1.5A",  "L1",     "SWPA4030S",   "C177241"),
    ("PTC resettable fuse 1.1A hold 1812", "F1",     "1812",        ""),   # picker: 1812 PTC ~1.1A ≥16V
    ("Pin header 1x3 P2.54 vertical THT",  "J1,J2",  "PinHeader_1x03", ""),  # picker: 2.54 1x3 male
    ("Socket female 1x22 P2.54 THT",       "U1",     "2x 1x22 socket", ""),  # picker: 2.54 1x22 female x2
]

def run(*args):
    r = subprocess.run([CLI, *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"kicad-cli failed: {' '.join(args)}\n{r.stdout}\n{r.stderr}")
    return r.stdout

def main():
    GERB.mkdir(parents=True, exist_ok=True)

    # ---- gerbers + drill (JLC-friendly settings)
    run("pcb", "export", "gerbers",
        "--layers", "F.Cu,B.Cu,F.Mask,B.Mask,F.Silkscreen,B.Silkscreen,Edge.Cuts",
        "--subtract-soldermask",
        "-o", str(GERB) + "\\", str(BOARD))
    run("pcb", "export", "drill",
        "--format", "excellon",
        "--drill-origin", "absolute",
        "--excellon-units", "mm",
        "--generate-map", "--map-format", "gerberx2",
        "-o", str(GERB) + "\\", str(BOARD))

    zpath = OUT / "carrier-gerbers.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(GERB.iterdir()):
            z.write(f, f.name)
    print(f"wrote {zpath} ({len(list(GERB.iterdir()))} files)")

    # ---- CPL from kicad position export
    pos_raw = OUT / "pos-raw.csv"
    run("pcb", "export", "pos",
        "--format", "csv", "--units", "mm", "--side", "front",
        "--exclude-dnp",
        "-o", str(pos_raw), str(BOARD))
    skip = {"TP1", "TP2", "TP3", "TP4", "H1", "H2", "H3", "H4"}
    cpl = OUT / "carrier-cpl.csv"
    with open(pos_raw, newline="", encoding="utf-8") as f_in, \
         open(cpl, "w", newline="", encoding="utf-8") as f_out:
        w = csv.writer(f_out)
        w.writerow(["Designator", "Mid X", "Mid Y", "Layer", "Rotation"])
        n = 0
        for row in csv.DictReader(f_in):
            ref = row["Ref"]
            if ref in skip:
                continue
            w.writerow([ref, f'{float(row["PosX"]):.4f}mm',
                        f'{float(row["PosY"]):.4f}mm',
                        "Top" if row["Side"] == "top" else "Bottom",
                        row["Rot"]])
            n += 1
    print(f"wrote {cpl} ({n} placements)")

    # ---- BOM
    bom = OUT / "carrier-bom.csv"
    with open(bom, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Comment", "Designator", "Footprint", "LCSC"])
        w.writerows(BOM_ROWS)
    print(f"wrote {bom} ({len(BOM_ROWS)} lines)")

if __name__ == "__main__":
    main()
