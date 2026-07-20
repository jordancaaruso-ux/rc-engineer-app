#!/usr/bin/env python3
"""Generate carrier.kicad_pcb for the RC PWM logger carrier board.

Self-checking:
- PADMAP is verified against the exported schematic netlist (output/carrier.net)
  before anything is placed — the board cannot drift from the schematic.
- Footprint orientation is validated by querying real pad positions; parts are
  auto-flipped 180deg when a validator fails.
- All pad coordinates are printed for route review; DRC is the final gate.

Board plan (mm, page coords):
  outline (50,50)-(122,97)  = 72 x 47
  DevKit socket rows along X: row A y=58 (pads 1..22, GPIO4/5 + 5V/GND),
  row B y=80.86 (pads 23..44). USB/buttons end = pad-1 end (west).
  South strip y>=84: servo headers J1/J2 + dividers (west), power chain (east).
  GND pours both layers.
"""
import re
import sys
from pathlib import Path

import pcbnew
from pcbnew import VECTOR2I, FromMM

HERE = Path(__file__).resolve().parent
PROJ = HERE.parent
STOCK_FP = Path(r"C:\Program Files\KiCad\10.0\share\kicad\footprints")

def MM(x, y):
    return VECTOR2I(FromMM(float(x)), FromMM(float(y)))

# ------------------------------------------------------------------ net map

PADMAP = {
    "J1": {"1": "ST_PWM_RAW", "2": "VIN_RAW", "3": "GND"},
    "J2": {"1": "TH_PWM_RAW", "2": "VIN_RAW", "3": "GND"},
    "R1": {"1": "ST_PWM_RAW", "2": "ST_PWM_3V"},
    "R2": {"1": "ST_PWM_3V", "2": "GND"},
    "R3": {"1": "TH_PWM_RAW", "2": "TH_PWM_3V"},
    "R4": {"1": "TH_PWM_3V", "2": "GND"},
    "F1": {"1": "VIN_RAW", "2": "VIN_F"},
    "D1": {"1": "VIN_PROT", "2": "VIN_F"},
    "C1": {"1": "VIN_PROT", "2": "GND"},
    "U2": {"1": "P5V_BUCK", "2": "VIN_PROT", "3": "VIN_PROT",
           "4": "GND", "5": "SW", "6": "BST"},
    "C2": {"1": "BST", "2": "SW"},
    "L1": {"1": "SW", "2": "P5V_BUCK"},
    "C3": {"1": "P5V_BUCK", "2": "GND"},
    "C4": {"1": "P5V_BUCK", "2": "GND"},
    "D2": {"1": "P5V_DK", "2": "P5V_BUCK"},
    "U1": {"4": "ST_PWM_3V", "5": "TH_PWM_3V", "21": "P5V_DK",
           "22": "GND", "23": "GND", "24": "GND", "44": "GND"},
    "TP1": {"1": "ST_PWM_3V"},
    "TP2": {"1": "TH_PWM_3V"},
    "TP3": {"1": "P5V_DK"},
    "TP4": {"1": "GND"},
}

def verify_padmap_against_netlist():
    net_path = PROJ / "output" / "carrier.net"
    text = net_path.read_text(encoding="utf-8")
    nets_idx = text.index("(nets")
    want = {}
    current = None
    for m in re.finditer(
        r'\(name "([^"]+)"\)|\(node\s*\(ref "([^"]+)"\)\s*\(pin "([^"]+)"\)', text[nets_idx:]
    ):
        if m.group(1) is not None:
            current = m.group(1)
        else:
            ref, pin = m.group(2), m.group(3)
            if not current.startswith("unconnected-"):
                want.setdefault(ref, {})[pin] = current
    if want != PADMAP:
        for ref in sorted(set(want) | set(PADMAP)):
            if want.get(ref) != PADMAP.get(ref):
                print(f"MISMATCH {ref}: netlist={want.get(ref)} padmap={PADMAP.get(ref)}")
        raise SystemExit("PADMAP does not match schematic netlist")
    print("PADMAP verified against schematic netlist OK")

# ------------------------------------------------------------------ parts
# (ref, lib, fpname, anchor_kind, anchor_arg, target_xy, rot, validator)
# validator: lambda(pads dict name->(x,y)mm) -> bool ; auto-flip 180 if False.

def PARTS():
    return [
        # Row A (pads 1-22: GPIO4/5, 5V, GND) SOUTH at y=80.86 facing the parts
        # strip; row B lands at y=58. Pad-1/USB end west; antenna end overhangs
        # the east edge (good for BLE). rot 90 maps local +y->+x, +x->-y.
        ("U1", "Carrier", "ESP32-S3-DevKitC", "pad", "1", (63, 80.86), 90,
         lambda p: abs(p["22"][0] - (p["1"][0] + 53.34)) < 0.05
                   and abs(p["22"][1] - p["1"][1]) < 0.05
                   and p["23"][1] < p["22"][1]),
        ("J1", "Connector_PinHeader_2.54mm", "PinHeader_1x03_P2.54mm_Vertical",
         "pad", "1", (63, 90), 90, lambda p: p["3"][0] > p["1"][0]),
        ("J2", "Connector_PinHeader_2.54mm", "PinHeader_1x03_P2.54mm_Vertical",
         "pad", "1", (76, 90), 90, lambda p: p["3"][0] > p["1"][0]),
        ("R1", "Resistor_SMD", "R_0603_1608Metric", "center", None, (63, 86), 90,
         lambda p: p["1"][1] > p["2"][1]),          # pad1 south, toward J1
        ("R2", "Resistor_SMD", "R_0603_1608Metric", "center", None, (66.5, 86), 90,
         lambda p: p["1"][1] < p["2"][1]),          # pad1 north (signal)
        ("R3", "Resistor_SMD", "R_0603_1608Metric", "center", None, (76, 86), 90,
         lambda p: p["1"][1] > p["2"][1]),
        ("R4", "Resistor_SMD", "R_0603_1608Metric", "center", None, (72.5, 86), 90,
         lambda p: p["1"][1] < p["2"][1]),
        ("F1", "Fuse", "Fuse_1812_4532Metric", "center", None, (86, 88), 0,
         lambda p: p["1"][0] < p["2"][0]),          # pad1 west
        ("D1", "Diode_SMD", "D_SMA", "center", None, (93, 88), 0,
         lambda p: p["2"][0] < p["1"][0]),          # anode west
        ("C1", "Capacitor_SMD", "C_0805_2012Metric", "center", None, (97.5, 92), 90,
         lambda p: p["1"][1] < p["2"][1]),          # pad1 north
        # TSOT-23-6 at rot 0: pads 1,2,3 (FB,EN,IN) down the left column,
        # 4,5,6 (GND,SW,BST) up the right column.
        ("U2", "Package_TO_SOT_SMD", "TSOT-23-6", "center", None, (101, 88), 0,
         lambda p: p["3"][0] < 101 and p["5"][0] > 101),
        ("C2", "Capacitor_SMD", "C_0603_1608Metric", "center", None, (104, 84.5), 0,
         lambda p: p["1"][0] < p["2"][0]),          # pad1 west (BST)
        ("L1", "Inductor_SMD", "L_Sunlord_SWPA4030S", "center", None, (108, 88), 0,
         lambda p: p["1"][0] < p["2"][0]),
        ("C3", "Capacitor_SMD", "C_0805_2012Metric", "center", None, (111, 92), 90,
         lambda p: p["1"][1] < p["2"][1]),
        ("C4", "Capacitor_SMD", "C_0805_2012Metric", "center", None, (114.5, 92), 90,
         lambda p: p["1"][1] < p["2"][1]),
        ("D2", "Diode_SMD", "D_SMA", "center", None, (117, 88), 0,
         lambda p: p["2"][0] < p["1"][0]),          # anode west, K -> east
        ("TP1", "TestPoint", "TestPoint_Pad_D1.5mm", "center", None, (59.5, 84), 0, None),
        ("TP2", "TestPoint", "TestPoint_Pad_D1.5mm", "center", None, (80, 84), 0, None),
        ("TP3", "TestPoint", "TestPoint_Pad_D1.5mm", "center", None, (120, 84.5), 0, None),
        ("TP4", "TestPoint", "TestPoint_Pad_D1.5mm", "center", None, (90, 93), 0, None),
        ("H1", "MountingHole", "MountingHole_3.2mm_M3", "center", None, (54, 54), 0, None),
        ("H2", "MountingHole", "MountingHole_3.2mm_M3", "center", None, (118, 53.2), 0, None),
        ("H3", "MountingHole", "MountingHole_3.2mm_M3", "center", None, (54, 93), 0, None),
        ("H4", "MountingHole", "MountingHole_3.2mm_M3", "center", None, (119.8, 94.8), 0, None),
    ]

# ------------------------------------------------------------------ helpers

def pad_xy(fp, num):
    p = fp.FindPadByNumber(num)
    c = p.GetPosition()
    return (pcbnew.ToMM(c.x), pcbnew.ToMM(c.y))

def pads_dict(fp):
    return {p.GetNumber(): (pcbnew.ToMM(p.GetPosition().x), pcbnew.ToMM(p.GetPosition().y))
            for p in fp.Pads() if p.GetNumber()}

def place(board, nets, ref, lib, fpname, kind, arg, target, rot, validator):
    libdir = PROJ / "Carrier.pretty" if lib == "Carrier" else STOCK_FP / f"{lib}.pretty"
    fp = pcbnew.FootprintLoad(str(libdir), fpname)
    if fp is None:
        raise SystemExit(f"footprint {lib}:{fpname} not found")
    fp.SetFPID(pcbnew.LIB_ID(lib, fpname))
    fp.Reference().SetText(ref)
    board.Add(fp)
    for attempt_rot in (rot, rot + 180):
        fp.SetOrientationDegrees(attempt_rot % 360)
        # anchor
        if kind == "pad":
            cur = pad_xy(fp, arg)
        else:
            c = fp.GetPosition()
            cur = (pcbnew.ToMM(c.x), pcbnew.ToMM(c.y))
        fp.Move(VECTOR2I(FromMM(target[0] - cur[0]), FromMM(target[1] - cur[1])))
        if validator is None or validator(pads_dict(fp)):
            break
    else:
        raise SystemExit(f"{ref}: no rotation satisfied validator")
    # assign nets
    for p in fp.Pads():
        num = p.GetNumber()
        if num and ref in PADMAP and num in PADMAP[ref]:
            p.SetNet(nets[PADMAP[ref][num]])
    return fp

def add_track(board, nets, net, width, pts, layer=None):
    for a, b in zip(pts, pts[1:]):
        if a == b:
            continue
        t = pcbnew.PCB_TRACK(board)
        t.SetStart(MM(*a))
        t.SetEnd(MM(*b))
        t.SetWidth(FromMM(width))
        t.SetLayer(layer if layer is not None else pcbnew.F_Cu)
        t.SetNet(nets[net])
        board.Add(t)

def add_via(board, nets, net, x, y):
    v = pcbnew.PCB_VIA(board)
    v.SetPosition(MM(x, y))
    v.SetDrill(FromMM(0.3))
    v.SetWidth(FromMM(0.6))
    v.SetNet(nets[net])
    board.Add(v)

# ------------------------------------------------------------------ main

def main():
    verify_padmap_against_netlist()

    board = pcbnew.CreateEmptyBoard()

    net_names = sorted({n for m in PADMAP.values() for n in m.values()})
    nets = {}
    for n in net_names:
        ni = pcbnew.NETINFO_ITEM(board, n)
        board.Add(ni)
        nets[n] = ni

    fps = {}
    for spec in PARTS():
        fps[spec[0]] = place(board, nets, *spec)

    # silkscreen hygiene: hide refs that duplicate better labels or sit off-board
    for ref in ("H1", "H2", "H3", "H4", "TP1", "TP2", "TP3", "TP4", "J1", "J2"):
        fps[ref].Reference().SetVisible(False)
    fps["R4"].Reference().SetPosition(MM(70.9, 86))   # clear of R3's ref + own pad

    # ---- report all pad positions (route review)
    for ref in ("U1", "J1", "J2", "U2", "L1", "D1", "D2", "F1",
                "R1", "R2", "R3", "R4", "C1", "C2", "C3", "C4"):
        pd = pads_dict(fps[ref])
        keys = sorted(pd, key=lambda k: (len(k), k))
        if ref == "U1":
            keys = [k for k in keys if k in PADMAP["U1"]]
        print(ref, {k: (round(pd[k][0], 2), round(pd[k][1], 2)) for k in keys})

    print("stage: outline", flush=True)
    # ---- board outline
    rect = pcbnew.PCB_SHAPE(board)
    rect.SetShape(pcbnew.SHAPE_T_RECT)
    rect.SetStart(MM(50, 50))
    rect.SetEnd(MM(122, 97))
    rect.SetLayer(pcbnew.Edge_Cuts)
    rect.SetWidth(FromMM(0.1))
    board.Add(rect)

    # ---- silkscreen
    for text, x, y, size in (
        ("ST", 60.5, 90, 1.0), ("TH", 73.3, 90, 1.0),
        ("S + -", 65.5, 92.2, 0.9), ("S + -", 78.5, 92.2, 0.9),
        ("JRC RC-PWM CARRIER rev A", 86, 95.4, 1.2),
    ):
        t = pcbnew.PCB_TEXT(board)
        t.SetText(text)
        t.SetPosition(MM(x, y))
        t.SetLayer(pcbnew.F_SilkS)
        t.SetTextSize(VECTOR2I(FromMM(size), FromMM(size)))
        t.SetTextThickness(FromMM(0.15))
        board.Add(t)

    print("stage: routes", flush=True)
    # ---- routes (pad-anchored waypoints)
    P = lambda ref, num: pad_xy(fps[ref], num)

    u1_4, u1_5, u1_21 = P("U1", "4"), P("U1", "5"), P("U1", "21")
    d2k = P("D2", "1")

    # steering signal
    add_track(board, nets, "ST_PWM_RAW", 0.3, [P("J1", "1"), P("R1", "1")])
    add_track(board, nets, "ST_PWM_3V", 0.3,
              [P("R1", "2"), (63, 83.5), (u1_4[0], 83.5), u1_4])
    add_track(board, nets, "ST_PWM_3V", 0.3, [P("R2", "1"), (66.5, 83.5)])
    add_track(board, nets, "ST_PWM_3V", 0.3, [P("TP1", "1"), (63, 84)])
    # throttle signal
    add_track(board, nets, "TH_PWM_RAW", 0.3, [P("J2", "1"), P("R3", "1")])
    add_track(board, nets, "TH_PWM_3V", 0.3,
              [P("R3", "2"), (76, 83), (u1_5[0], 83), u1_5])
    add_track(board, nets, "TH_PWM_3V", 0.3, [P("R4", "1"), (72.5, 83), (u1_5[0], 83)])
    add_track(board, nets, "TH_PWM_3V", 0.3, [P("TP2", "1"), (76, 84)])
    # input power
    j12, j22, f11 = P("J1", "2"), P("J2", "2"), P("F1", "1")
    add_track(board, nets, "VIN_RAW", 0.8,
              [j12, (j12[0], 93.5), (j22[0], 93.5), j22])
    add_track(board, nets, "VIN_RAW", 0.8, [f11, (f11[0], 93.5), (j22[0], 93.5)])
    add_track(board, nets, "VIN_F", 0.8, [P("F1", "2"), P("D1", "2")])
    d1k, u23, u22, u21p = P("D1", "1"), P("U2", "3"), P("U2", "2"), P("U2", "1")
    xin = u23[0] - 1.5
    add_track(board, nets, "VIN_PROT", 0.8, [d1k, (xin, d1k[1]), (xin, u23[1]), u23])
    add_track(board, nets, "VIN_PROT", 0.3, [u22, (xin, u22[1])])
    c11 = P("C1", "1")
    add_track(board, nets, "VIN_PROT", 0.5, [c11, (c11[0], 88)])
    # switch node + bootstrap
    u25, l11 = P("U2", "5"), P("L1", "1")
    add_track(board, nets, "SW", 0.6, [u25, (u25[0] + 1.2, u25[1]), (u25[0] + 1.2, 88), l11])
    c22 = P("C2", "2")
    add_track(board, nets, "SW", 0.4, [c22, (c22[0] + 0.8, c22[1]), (c22[0] + 0.8, 88)])
    u26, c21 = P("U2", "6"), P("C2", "1")
    add_track(board, nets, "BST", 0.3, [u26, (u26[0] + 0.5, u26[1]),
                                        (u26[0] + 0.5, c21[1]), c21])
    # 5V rail
    l12, d2a = P("L1", "2"), P("D2", "2")
    add_track(board, nets, "P5V_BUCK", 0.8, [l12, d2a])
    c31, c41 = P("C3", "1"), P("C4", "1")
    add_track(board, nets, "P5V_BUCK", 0.5, [c31, (c31[0], 88)])
    add_track(board, nets, "P5V_BUCK", 0.5, [c41, (c41[0], 88)])
    # FB sense (pad1, top-left): short back-layer jump over the left column
    fb_y = 85.8
    add_track(board, nets, "P5V_BUCK", 0.3, [u21p, (u21p[0], fb_y)])
    add_via(board, nets, "P5V_BUCK", u21p[0], fb_y)
    add_track(board, nets, "P5V_BUCK", 0.3,
              [(u21p[0], fb_y), (c31[0], fb_y)], layer=pcbnew.B_Cu)
    add_via(board, nets, "P5V_BUCK", c31[0], fb_y)
    add_track(board, nets, "P5V_BUCK", 0.3, [(c31[0], fb_y), c31])
    # 5V to devkit
    add_track(board, nets, "P5V_DK", 0.8,
              [d2k, (d2k[0], 83.5), (u1_21[0], 83.5), u1_21])
    add_track(board, nets, "P5V_DK", 0.4, [P("TP3", "1"), (d2k[0], 84.5)])

    print("stage: zones", flush=True)
    # ---- GND zones, both layers
    for layer in (pcbnew.F_Cu, pcbnew.B_Cu):
        z = pcbnew.ZONE(board)
        z.SetLayer(layer)
        z.SetNetCode(nets["GND"].GetNetCode())
        ol = z.Outline()
        ol.NewOutline()
        for x, y in ((50, 50), (122, 50), (122, 97), (50, 97)):
            ol.Append(FromMM(x), FromMM(y))
        z.SetMinThickness(FromMM(0.25))
        board.Add(z)

    # Zones are saved UNFILLED — ZONE_FILLER crashes in headless pcbnew 10.0.2.
    # Fill via: kicad-cli pcb drc --refill-zones --save-board
    out = PROJ / "carrier.kicad_pcb"
    pcbnew.SaveBoard(str(out), board)
    print(f"wrote {out} (zones unfilled; refill via kicad-cli drc)")

if __name__ == "__main__":
    main()
