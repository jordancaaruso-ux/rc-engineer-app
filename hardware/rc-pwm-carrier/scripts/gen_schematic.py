#!/usr/bin/env python3
"""Generate carrier.kicad_sch for the RC PWM logger carrier board.

Connectivity strategy: no graphical wires — every used pin gets a global label
placed exactly on its connection point; unused pins get no_connect markers.
ERC is the correctness gate; a rendered PDF is the visual gate.

Usage:
  python gen_schematic.py --dump   # print pin tables of all source symbols
  python gen_schematic.py          # write ../carrier.kicad_sch
"""
import re
import sys
import uuid as uuidlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJ = HERE.parent
STOCK = Path(r"C:\Program Files\KiCad\10.0\share\kicad\symbols")
VENDOR = PROJ / "vendor"

# ---------------------------------------------------------------- s-expr utils

def read_text(p: Path) -> str:
    return p.read_text(encoding="utf-8")

def extract_symbol(lib_text: str, name: str) -> str:
    """Extract the balanced (symbol "name" ...) block from a .kicad_sym file."""
    needle = f'(symbol "{name}"'
    i = lib_text.find(needle)
    if i < 0:
        raise SystemExit(f"symbol {name!r} not found")
    depth = 0
    in_str = False
    j = i
    while j < len(lib_text):
        c = lib_text[j]
        if in_str:
            if c == '\\':
                j += 2
                continue
            if c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                return lib_text[i:j + 1]
        j += 1
    raise SystemExit(f"unbalanced s-expr for {name}")

PIN_RE = re.compile(
    r'\(pin\s+(\S+)\s+\S+\s*\(at\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(\d+)\)'
    r'.*?\(name\s+"([^"]*)".*?\(number\s+"([^"]*)"',
    re.S,
)

def pins_of(sym_text: str):
    """[(number, name, etype, x, y, angle)] — connection point coords, lib frame."""
    out = []
    for m in PIN_RE.finditer(sym_text):
        etype, x, y, ang, name, number = m.groups()
        out.append((number, name, etype, float(x), float(y), int(ang)))
    return out

def prop_of(sym_text: str, prop: str):
    m = re.search(r'\(property\s+"%s"\s+"([^"]*)"' % re.escape(prop), sym_text)
    return m.group(1) if m else ""

def set_prop(sym_text: str, prop: str, value: str) -> str:
    return re.sub(
        r'(\(property\s+"%s"\s+")[^"]*(")' % re.escape(prop),
        lambda m: m.group(1) + value + m.group(2),
        sym_text,
        count=1,
    )

# ---------------------------------------------------------------- symbol sources

SOURCES = {
    "Device:R_Small":                 (STOCK / "Device.kicad_sym", "R_Small"),
    "Device:C_Small":                 (STOCK / "Device.kicad_sym", "C_Small"),
    "Device:L_Small":                 (STOCK / "Device.kicad_sym", "L_Small"),
    "Device:Polyfuse_Small":          (STOCK / "Device.kicad_sym", "Polyfuse_Small"),
    "Diode:SS34":                     (STOCK / "Diode.kicad_sym", "SS34"),
    "Connector_Generic:Conn_01x03":   (STOCK / "Connector_Generic.kicad_sym", "Conn_01x03"),
    "Connector:TestPoint":            (STOCK / "Connector.kicad_sym", "TestPoint"),
    "Regulator_Switching:AP63203WU":  (STOCK / "Regulator_Switching.kicad_sym", "AP63203WU"),
    "power:PWR_FLAG":                 (STOCK / "power.kicad_sym", "PWR_FLAG"),
    "Espressif:ESP32-S3-DevKitC":     (VENDOR / "Espressif.kicad_sym", "ESP32-S3-DevKitC"),
}

def load_symbols():
    """defs[lib_id] -> [embeddable symbol def] with derived symbols FLATTENED
    (root body renamed to the child + the child's own property values), which
    is how eeschema embeds them; pins come from the chain root."""
    defs, pins = {}, {}
    for lib_id, (path, name) in SOURCES.items():
        lib_text = read_text(path)
        chain, cur, seen = [], name, {name}
        while True:
            t = extract_symbol(lib_text, cur)
            chain.append((cur, t))
            m = re.search(r'\(extends\s+"([^"]+)"\)', t)
            if not m:
                break
            cur = m.group(1)
            if cur in seen:
                raise SystemExit(f"extends cycle at {cur}")
            seen.add(cur)
        child_name, child_text = chain[0]
        root_name, root_text = chain[-1]
        text = root_text
        if len(chain) > 1:
            # graft child property values onto the root body
            for prop in ("Value", "Datasheet", "Description", "Footprint",
                         "ki_keywords", "ki_fp_filters"):
                v = prop_of(child_text, prop)
                if v:
                    text = set_prop(text, prop, v)
            # rename sub-units Root_N_M -> Child_N_M
            text = text.replace(f'(symbol "{root_name}_', f'(symbol "{child_name}_')
        text = text.replace(f'(symbol "{root_name}"', f'(symbol "{lib_id}"', 1)
        defs[lib_id] = [text]
        pins[lib_id] = pins_of(root_text)
    return defs, pins

# ---------------------------------------------------------------- dump mode

def dump():
    defs, pins = load_symbols()
    for lib_id in SOURCES:
        print(f"\n=== {lib_id}  (default fp: {prop_of(defs[lib_id][0], 'Footprint') or '-'})")
        for num, name, etype, x, y, ang in sorted(pins[lib_id], key=lambda p: (len(p[0]), p[0])):
            print(f"  pin {num:>3}  {name:<12} {etype:<14} at ({x:7.2f},{y:7.2f}) ang {ang}")

# ---------------------------------------------------------------- part list
# nets: dict pin_number -> net name; missing pins get no_connect.
# DevKitC nets are filled by NAME in build() because its numbering must be
# read from the dump, never assumed.

PARTS = [
    # ref, lib_id, value, footprint, (x, y), {pin: net}
    ("J1", "Connector_Generic:Conn_01x03", "SERVO_STEERING",
     "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical", (40, 60),
     {"1": "ST_PWM_RAW", "2": "VIN_RAW", "3": "GND"}),
    ("J2", "Connector_Generic:Conn_01x03", "SERVO_THROTTLE",
     "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical", (40, 100),
     {"1": "TH_PWM_RAW", "2": "VIN_RAW", "3": "GND"}),

    ("R1", "Device:R_Small", "10k", "Resistor_SMD:R_0603_1608Metric", (75, 55),
     {"1": "ST_PWM_RAW", "2": "ST_PWM_3V"}),
    ("R2", "Device:R_Small", "15k", "Resistor_SMD:R_0603_1608Metric", (95, 65),
     {"1": "ST_PWM_3V", "2": "GND"}),
    ("R3", "Device:R_Small", "10k", "Resistor_SMD:R_0603_1608Metric", (75, 95),
     {"1": "TH_PWM_RAW", "2": "TH_PWM_3V"}),
    ("R4", "Device:R_Small", "15k", "Resistor_SMD:R_0603_1608Metric", (95, 105),
     {"1": "TH_PWM_3V", "2": "GND"}),

    ("F1", "Device:Polyfuse_Small", "PTC 1.1A", "Fuse:Fuse_1812_4532Metric", (60, 150),
     {"1": "VIN_RAW", "2": "VIN_F"}),
    ("D1", "Diode:SS34", "SS34", "Diode_SMD:D_SMA", (85, 150),
     {"2": "VIN_F", "1": "VIN_PROT"}),          # 2=A, 1=K (verify in dump)
    ("C1", "Device:C_Small", "10uF/25V", "Capacitor_SMD:C_0805_2012Metric", (105, 165),
     {"1": "VIN_PROT", "2": "GND"}),
    ("U2", "Regulator_Switching:AP63203WU", "AP63205WU-7",
     "Package_TO_SOT_SMD:TSOT-23-6", (130, 155), {}),   # filled by name in build()
    ("C2", "Device:C_Small", "100nF", "Capacitor_SMD:C_0603_1608Metric", (150, 135),
     {"1": "BST", "2": "SW"}),
    ("L1", "Device:L_Small", "6.8uH", "Inductor_SMD:L_Sunlord_SWPA4030S", (165, 150),
     {"1": "SW", "2": "P5V_BUCK"}),
    ("C3", "Device:C_Small", "22uF", "Capacitor_SMD:C_0805_2012Metric", (175, 165),
     {"1": "P5V_BUCK", "2": "GND"}),
    ("C4", "Device:C_Small", "22uF", "Capacitor_SMD:C_0805_2012Metric", (185, 165),
     {"1": "P5V_BUCK", "2": "GND"}),
    ("D2", "Diode:SS34", "SS34", "Diode_SMD:D_SMA", (205, 150),
     {"2": "P5V_BUCK", "1": "P5V_DK"}),

    ("U1", "Espressif:ESP32-S3-DevKitC", "ESP32-S3-DevKitC-1",
     "Carrier:ESP32-S3-DevKitC", (300, 130), {}),        # filled by name in build()

    ("TP1", "Connector:TestPoint", "ST_PWM_3V", "TestPoint:TestPoint_Pad_D1.5mm", (75, 220),
     {"1": "ST_PWM_3V"}),
    ("TP2", "Connector:TestPoint", "TH_PWM_3V", "TestPoint:TestPoint_Pad_D1.5mm", (95, 220),
     {"1": "TH_PWM_3V"}),
    ("TP3", "Connector:TestPoint", "P5V_DK", "TestPoint:TestPoint_Pad_D1.5mm", (115, 220),
     {"1": "P5V_DK"}),
    ("TP4", "Connector:TestPoint", "GND", "TestPoint:TestPoint_Pad_D1.5mm", (135, 220),
     {"1": "GND"}),

    ("#FLG01", "power:PWR_FLAG", "PWR_FLAG", "", (60, 245), {"1": "VIN_RAW"}),
    ("#FLG02", "power:PWR_FLAG", "PWR_FLAG", "", (80, 245), {"1": "GND"}),
    ("#FLG03", "power:PWR_FLAG", "PWR_FLAG", "", (100, 245), {"1": "P5V_BUCK"}),
    ("#FLG04", "power:PWR_FLAG", "PWR_FLAG", "", (120, 245), {"1": "P5V_DK"}),
    ("#FLG05", "power:PWR_FLAG", "PWR_FLAG", "", (140, 245), {"1": "VIN_PROT"}),
]

# DevKitC pins mapped by NAME — exact names from --dump (Espressif symbol).
DEVKIT_NET_BY_NAME = {
    "GPIO4/ADC1_CH3": "ST_PWM_3V",   # steering, matches board_pins.h
    "GPIO5/ADC1_CH4": "TH_PWM_3V",   # throttle
    "5V": "P5V_DK",
    "GND": "GND",       # applies to every pin with this name (4 stacked pins)
}
# AP6320x pins mapped by NAME — exact names from --dump: FB EN IN GND SW BST.
BUCK_NET_BY_NAME = {
    "IN": "VIN_PROT",
    "EN": "VIN_PROT",   # tied to IN = always on
    "SW": "SW",
    "BST": "BST",
    "GND": "GND",
    "FB": "P5V_BUCK",   # fixed 5V part: FB ties directly to VOUT
}

# ---------------------------------------------------------------- emit

SHEET_UUID = "7c1a4b1e-0001-4c2e-9a3f-c0ffee000001"

def su():
    return str(uuidlib.uuid4())

GRID = 1.27

def snap(v):
    return round(round(v / GRID) * GRID, 4)

def sheet_xy(sym_xy, pin_xy):
    (X, Y), (px, py) = sym_xy, pin_xy
    return (round(X + px, 4), round(Y - py, 4))

def label_angle(px, py):
    # place text extending away from the symbol body, sheet frame
    if abs(px) >= abs(py):
        return 0 if px >= 0 else 180
    return 90 if py > 0 else 270

def build():
    defs, pins = load_symbols()

    # resolve name-mapped parts; snap all origins to the connection grid
    resolved = []
    for ref, lib_id, value, fp, xy, netmap in PARTS:
        xy = (snap(xy[0]), snap(xy[1]))
        nm = dict(netmap)
        by_name = None
        if lib_id == "Espressif:ESP32-S3-DevKitC":
            by_name = DEVKIT_NET_BY_NAME
        elif lib_id == "Regulator_Switching:AP63203WU":
            by_name = BUCK_NET_BY_NAME
        if by_name is not None:
            for num, name, _etype, _x, _y, _a in pins[lib_id]:
                if name in by_name:
                    nm[num] = by_name[name]
        resolved.append((ref, lib_id, value, fp, xy, nm))

    body = []
    labels = []
    ncs = []
    for ref, lib_id, value, fp, xy, netmap in resolved:
        X, Y = xy
        symu = su()
        pin_lines = []
        for num, name, _etype, px, py, ang in pins[lib_id]:
            pin_lines.append(f'\t\t(pin "{num}"\n\t\t\t(uuid "{su()}")\n\t\t)')
            lx, ly = sheet_xy((X, Y), (px, py))
            if num in netmap:
                a = label_angle(px, py)
                labels.append(
                    f'\t(global_label "{netmap[num]}"\n'
                    f'\t\t(shape passive)\n'
                    f'\t\t(at {lx} {ly} {a})\n'
                    f'\t\t(effects\n\t\t\t(font\n\t\t\t\t(size 1.27 1.27)\n\t\t\t)\n'
                    f'\t\t\t(justify {"right" if a == 180 else "left"})\n\t\t)\n'
                    f'\t\t(uuid "{su()}")\n\t)'
                )
            else:
                ncs.append(f'\t(no_connect\n\t\t(at {lx} {ly})\n\t\t(uuid "{su()}")\n\t)')

        hide_ref = "#" in ref
        # keep name/value text clear of tall symbol bodies
        prop_dy = 50 if "DevKitC" in lib_id else 6
        props = []
        props.append(
            f'\t\t(property "Reference" "{ref}"\n'
            f'\t\t\t(at {X} {Y - prop_dy} 0)\n'
            + ('\t\t\t(hide yes)\n' if hide_ref else '')
            + '\t\t\t(effects\n\t\t\t\t(font\n\t\t\t\t\t(size 1.27 1.27)\n\t\t\t\t)\n\t\t\t)\n\t\t)'
        )
        props.append(
            f'\t\t(property "Value" "{value}"\n'
            f'\t\t\t(at {X} {Y + prop_dy} 0)\n'
            + ('\t\t\t(hide yes)\n' if hide_ref else '')
            + '\t\t\t(effects\n\t\t\t\t(font\n\t\t\t\t\t(size 1.27 1.27)\n\t\t\t\t)\n\t\t\t)\n\t\t)'
        )
        for pn, pv in (("Footprint", fp), ("Datasheet", "~"), ("Description", "")):
            props.append(
                f'\t\t(property "{pn}" "{pv}"\n'
                f'\t\t\t(at {X} {Y} 0)\n\t\t\t(hide yes)\n'
                f'\t\t\t(effects\n\t\t\t\t(font\n\t\t\t\t\t(size 1.27 1.27)\n\t\t\t\t)\n\t\t\t)\n\t\t)'
            )

        body.append(
            '\t(symbol\n'
            f'\t\t(lib_id "{lib_id}")\n'
            f'\t\t(at {X} {Y} 0)\n'
            '\t\t(unit 1)\n\t\t(body_style 1)\n\t\t(exclude_from_sim no)\n'
            '\t\t(in_bom yes)\n\t\t(on_board yes)\n\t\t(in_pos_files yes)\n\t\t(dnp no)\n'
            f'\t\t(uuid "{symu}")\n'
            + "\n".join(props) + "\n"
            + "\n".join(pin_lines) + "\n"
            '\t\t(instances\n'
            '\t\t\t(project "carrier"\n'
            f'\t\t\t\t(path "/{SHEET_UUID}"\n'
            f'\t\t\t\t\t(reference "{ref}")\n\t\t\t\t\t(unit 1)\n'
            '\t\t\t\t)\n\t\t\t)\n\t\t)\n\t)'
        )

    lib_symbols = "\n".join(
        "\t\t" + d.replace("\n", "\n\t\t") for k in SOURCES for d in defs[k]
    )

    sch = (
        '(kicad_sch\n'
        '\t(version 20260306)\n'
        '\t(generator "gen_schematic.py")\n'
        '\t(generator_version "10.0")\n'
        f'\t(uuid "{SHEET_UUID}")\n'
        '\t(paper "A3")\n'
        '\t(title_block\n'
        '\t\t(title "RC PWM Logger — Carrier rev A")\n'
        '\t\t(date "2026-07-18")\n'
        '\t\t(company "JRC Race Engineer")\n'
        '\t\t(comment 1 "ESP32-S3-DevKitC-1 carrier — listener-only PWM tap. No wires: global-label netlist.")\n'
        '\t)\n'
        '\t(lib_symbols\n' + lib_symbols + '\n\t)\n'
        + "\n".join(labels) + "\n"
        + "\n".join(ncs) + "\n"
        + "\n".join(body) + "\n"
        '\t(sheet_instances\n\t\t(path "/"\n\t\t\t(page "1")\n\t\t)\n\t)\n'
        '\t(embedded_fonts no)\n'
        ')\n'
    )
    out = PROJ / "carrier.kicad_sch"
    out.write_text(sch, encoding="utf-8")
    print(f"wrote {out} ({len(sch)} bytes)")

if __name__ == "__main__":
    if "--dump" in sys.argv:
        dump()
    else:
        build()
