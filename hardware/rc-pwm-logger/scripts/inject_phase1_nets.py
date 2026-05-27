"""
Inject Phase-1 schematic connectivity into V1.kicad_sch using explicit (wire)
segments, (label) ties, (global_label) for USB data, injected (symbol) PWR_FLAG
instances, and (no_connect) markers. Run after strip_wires_junctions.py.

U1 power pins: KiCad ERC for this placed device reports pin 1 GND @ (129.54,83.82)
and pin 2 +3V3 @ (129.54,27.94). ``kicad-cli sch erc`` hotspot coordinates are
authoritative for hookup; symbol-library mental math alone has disagreed here.

Run twice when iterating: ``strip`` → ``inject`` → ``kicad-cli sch erc`` → ``inject``
so optional ``(no_connect ...)`` markers can be derived from the updated ERC log.
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path

INJ_PWR_REFS = ("#PWRflj3v3", "#PWRfljgnd")  # fljgnd is scrub-only (no longer injected)


def _u() -> str:
    return str(uuid.uuid4())


def scrub_injected_pwr_flags(text: str) -> str:
    """Remove prior injector-owned PWR_FLAG symbols so re-runs do not duplicate."""
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        k = text.find("\t(symbol", i)
        if k == -1:
            out.append(text[i:])
            break
        out.append(text[i:k])
        depth = 0
        j = k
        while j < n:
            if text[j] == "(":
                depth += 1
            elif text[j] == ")":
                depth -= 1
                if depth == 0:
                    j += 1
                    break
            j += 1
        block = text[k:j]
        if not any(ref in block for ref in INJ_PWR_REFS):
            out.append(block)
        i = j
    return "".join(out)


def wire(x1: float, y1: float, x2: float, y2: float) -> str:
    return (
        f"\t(wire\n"
        f"\t\t(pts (xy {x1} {y1}) (xy {x2} {y2}))\n"
        f"\t\t(stroke (width 0) (type solid))\n"
        f"\t\t(uuid \"{_u()}\")\n"
        f"\t)\n"
    )


def label(name: str, x: float, y: float, rot: int = 0) -> str:
    return (
        f"\t(label \"{name}\"\n"
        f"\t\t(at {x} {y} {rot})\n"
        f"\t\t(fields_autoplaced yes)\n"
        f"\t\t(uuid \"{_u()}\")\n"
        f"\t\t(effects (font (size 1.27 1.27)) (justify left bottom))\n"
        f"\t)\n"
    )


def global_label(text: str, shape: str, x: float, y: float, rot: int = 0) -> str:
    return (
        f"\t(global_label \"{text}\"\n"
        f"\t\t(shape {shape})\n"
        f"\t\t(at {x} {y} {rot})\n"
        f"\t\t(fields_autoplaced yes)\n"
        f"\t\t(uuid \"{_u()}\")\n"
        f"\t\t(effects (font (size 1.27 1.27)) (justify left bottom))\n"
        f"\t)\n"
    )


def junction(x: float, y: float) -> str:
    return (
        f"\t(junction (at {x} {y})\n"
        f"\t\t(diameter 0)\n"
        f"\t\t(uuid \"{_u()}\")\n"
        f"\t)\n"
    )


def no_connect_at(x: float, y: float) -> str:
    return (
        f"\t(no_connect\n"
        f"\t\t(at {x} {y})\n"
        f"\t\t(uuid \"{_u()}\")\n"
        f"\t)\n"
    )


def R(x: float, y: float) -> tuple[float, float]:
    return (round(float(x), 2), round(float(y), 2))


PIN_NC_RE = re.compile(
    r"\[pin_not_connected\]:[^\n]*\n[^\n]*\n\s*@\(([0-9.]+) mm, ([0-9.]+) mm\): Symbol (\S+) Pin",
    re.MULTILINE,
)


def nc_markers_from_erc_file(erc_path: Path) -> str:
    """Emit ``(no_connect ...)`` for stale U1 ``pin_not_connected`` coords from the last ERC run."""
    if not erc_path.is_file():
        return ""
    txt = erc_path.read_text(encoding="utf-8", errors="ignore")
    u1_skip = {
        R(129.54, 27.94),  # +3V3 (ERC)
        R(129.54, 83.82),  # GND (ERC)
        R(114.3, 33.02),  # EN (ERC)
        R(114.3, 38.1),  # IO0 (ERC)
        R(144.78, 43.18),  # USB_D- (ERC)
        R(144.78, 45.72),  # USB_D+ (ERC)
        R(144.78, 55.88),  # IO37 / TP1
        R(144.78, 53.34),  # IO36 / TP2
    }
    seen: set[tuple[float, float]] = set()
    parts: list[str] = []
    for m in PIN_NC_RE.finditer(txt):
        x, y, sym = float(m.group(1)), float(m.group(2)), m.group(3)
        if sym != "U1":
            continue
        key = R(x, y)
        if key in u1_skip or key in seen:
            continue
        seen.add(key)
        parts.append(no_connect_at(x, y))
    return "".join(parts)


def pwr_flag_inj(ref: str, x: float, y: float) -> str:
    sid = _u()
    pin_uuid = _u()
    ref_y = y - 6.35
    val_y = y - 5.08
    return (
        f"\t(symbol\n"
        f"\t\t(lib_id \"power:PWR_FLAG\")\n"
        f"\t\t(at {x} {y} 0)\n"
        f"\t\t(unit 1)\n"
        f"\t\t(body_style 1)\n"
        f"\t\t(exclude_from_sim no)\n"
        f"\t\t(in_bom yes)\n"
        f"\t\t(on_board yes)\n"
        f"\t\t(in_pos_files yes)\n"
        f"\t\t(dnp no)\n"
        f"\t\t(uuid \"{sid}\")\n"
        f"\t\t(property \"Reference\" \"{ref}\"\n"
        f"\t\t\t(at {x} {ref_y} 0)\n"
        f"\t\t\t(hide yes)\n"
        f"\t\t\t(show_name no)\n"
        f"\t\t\t(do_not_autoplace no)\n"
        f"\t\t\t(effects\n"
        f"\t\t\t\t(font\n"
        f"\t\t\t\t\t(size 1.27 1.27)\n"
        f"\t\t\t\t)\n"
        f"\t\t\t)\n"
        f"\t\t)\n"
        f"\t\t(property \"Value\" \"PWR_FLAG\"\n"
        f"\t\t\t(at {x} {val_y} 0)\n"
        f"\t\t\t(show_name no)\n"
        f"\t\t\t(do_not_autoplace no)\n"
        f"\t\t\t(effects\n"
        f"\t\t\t\t(font\n"
        f"\t\t\t\t\t(size 1.27 1.27)\n"
        f"\t\t\t\t)\n"
        f"\t\t\t)\n"
        f"\t\t)\n"
        f"\t\t(property \"Footprint\" \"\"\n"
        f"\t\t\t(at {x} {y} 0)\n"
        f"\t\t\t(hide yes)\n"
        f"\t\t\t(show_name no)\n"
        f"\t\t\t(do_not_autoplace no)\n"
        f"\t\t\t(effects\n"
        f"\t\t\t\t(font\n"
        f"\t\t\t\t\t(size 1.27 1.27)\n"
        f"\t\t\t\t)\n"
        f"\t\t\t)\n"
        f"\t\t)\n"
        f"\t\t(property \"Datasheet\" \"~\"\n"
        f"\t\t\t(at {x} {y} 0)\n"
        f"\t\t\t(hide yes)\n"
        f"\t\t\t(show_name no)\n"
        f"\t\t\t(do_not_autoplace no)\n"
        f"\t\t\t(effects\n"
        f"\t\t\t\t(font\n"
        f"\t\t\t\t\t(size 1.27 1.27)\n"
        f"\t\t\t\t)\n"
        f"\t\t\t)\n"
        f"\t\t)\n"
        f"\t\t(property \"Description\" \"\"\n"
        f"\t\t\t(at {x} {y} 0)\n"
        f"\t\t\t(show_name no)\n"
        f"\t\t\t(do_not_autoplace no)\n"
        f"\t\t\t(effects\n"
        f"\t\t\t\t(font\n"
        f"\t\t\t\t\t(size 1.27 1.27)\n"
        f"\t\t\t\t)\n"
        f"\t\t\t)\n"
        f"\t\t)\n"
        f"\t\t(pin \"1\"\n"
        f"\t\t\t(uuid \"{pin_uuid}\")\n"
        f"\t\t)\n"
        f"\t\t(instances\n"
        f"\t\t\t(project \"V1\"\n"
        f"\t\t\t\t(path \"/0bada30c-8290-43b0-bfb3-208e0b077b74\"\n"
        f"\t\t\t\t\t(reference \"{ref}\")\n"
        f"\t\t\t\t\t(unit 1)\n"
        f"\t\t\t\t)\n"
        f"\t\t\t)\n"
        f"\t\t)\n"
        f"\t)\n"
    )


def build_block() -> str:
    b: list[str] = []
    a = b.append

    # --- Injected PWR_FLAG symbols (scrubbed on each run) ---
    a(pwr_flag_inj("#PWRflj3v3", 172.72, 27.94))
    a(pwr_flag_inj("#PWRfljgnd", 175.26, 120.0))
    a(wire(172.72, 27.94, 154.94, 27.94))  # +3V3 rail tee (ERC hotspot column)
    a(wire(175.26, 120.0, 170.18, 120.0))  # GND PWR_FLAG -> south GND bus (away from Type-C CC routing)

    # --- VIN path: J1+ -> F1 -> D1(anode) -> D1(cathode) -> bulk caps & U2 VIN ---
    a(wire(25.4, 40.64, 45.72, 40.64))
    a(wire(45.72, 40.64, 45.72, 43.18))  # F1 pin1
    a(wire(45.72, 38.1, 58.42, 38.1))
    a(wire(58.42, 38.1, 58.42, 40.64))  # D1 pin2 (anode)
    a(wire(53.34, 40.64, 53.34, 53.34))
    a(wire(53.34, 53.34, 71.12, 53.34))  # D1 pin1 (cathode) -> U2 VIN

    # --- Primary GND spine: south bus at y=120 mm collects returns, then up the left edge ---
    a(wire(25.4, 43.18, 25.4, 120.0))  # J1 pin2 -> GND bus
    a(wire(25.4, 120.0, 170.18, 120.0))  # east GND bus
    a(junction(25.4, 120.0))
    a(wire(25.4, 120.0, 25.4, 25.4))
    a(wire(25.4, 25.4, 71.12, 25.4))
    a(junction(71.12, 25.4))
    a(wire(71.12, 25.4, 71.12, 27.94))  # into U2 GND (pin 6)

    # --- Input bulk caps ---
    a(wire(63.5, 30.48, 71.12, 53.34))  # C1 pin1 -> VIN
    a(wire(63.5, 25.4, 71.12, 27.94))  # C1 pin2 -> GND
    a(wire(63.5, 53.34, 71.12, 53.34))  # C2 pin1 -> VIN
    a(wire(63.5, 48.26, 71.12, 48.26))
    a(wire(71.12, 48.26, 71.12, 27.94))  # C2 pin2 -> GND (Manhattan)

    # --- SW -> L1 pin1 ---
    a(wire(81.28, 45.72, 93.98, 45.72))
    a(wire(93.98, 45.72, 93.98, 39.37))  # L1 pin1

    # --- VOUT: L1 pin2 -> FB -> VOS -> output caps ---
    a(wire(93.98, 31.75, 81.28, 31.75))
    a(junction(93.98, 31.75))
    a(wire(81.28, 31.75, 81.28, 35.56))  # FB
    a(wire(81.28, 35.56, 81.28, 40.64))  # VOS
    a(wire(81.28, 40.64, 96.52, 40.64))
    a(wire(96.52, 40.64, 96.52, 30.48))
    a(wire(96.52, 30.48, 104.14, 30.48))  # C3 pin1
    a(wire(104.14, 25.4, 71.12, 27.94))  # C3 pin2 -> GND
    a(wire(96.52, 40.64, 104.14, 50.8))  # branch to C4 pin1
    a(wire(104.14, 45.72, 71.12, 27.94))  # C4 pin2 -> GND

    # --- Buck mode pins ---
    a(wire(60.96, 38.1, 71.12, 27.94))  # FSW -> GND
    a(wire(60.96, 40.64, 60.96, 53.34))
    a(wire(60.96, 53.34, 71.12, 53.34))  # DEF -> VIN
    a(wire(60.96, 43.18, 71.12, 27.94))  # SS/TR -> GND
    a(wire(81.28, 38.1, 81.28, 40.64))  # PG -> VOUT/VOS

    # --- Buck enable R1 ---
    a(wire(60.96, 55.88, 71.12, 53.34))  # R1 pin1 -> VIN
    a(wire(60.96, 60.96, 60.96, 45.72))
    a(junction(60.96, 45.72))
    a(wire(60.96, 45.72, 71.12, 45.72))  # R1 pin2 -> U2 EN
    a(junction(71.12, 45.72))

    # --- +3V3 distribution: north bus (y=20.32), then tie to U1 +3V3 @ (129.54,27.94) (ERC) ---
    a(wire(93.98, 31.75, 93.98, 20.32))
    a(wire(93.98, 20.32, 154.94, 20.32))
    a(junction(93.98, 20.32))
    a(junction(116.84, 20.32))
    a(junction(149.86, 20.32))
    a(junction(154.94, 20.32))
    a(wire(119.38, 20.32, 119.38, 30.48))  # power:+3V3 symbol
    a(wire(116.84, 20.32, 116.84, 35.56))  # R5 pin1 (top)
    a(wire(149.86, 20.32, 149.86, 27.94))
    a(wire(154.94, 20.32, 154.94, 27.94))
    a(wire(129.54, 27.94, 154.94, 27.94))  # U1 +3V3 (ERC pin 2)
    a(junction(129.54, 27.94))
    a(junction(149.86, 27.94))
    a(junction(154.94, 27.94))
    a(label("+3V3", 154.94, 20.32))
    a(wire(114.3, 86.36, 121.92, 86.36))
    a(label("+3V3", 121.92, 86.36))

    # --- MCU local decoupling C5/C6 (pin1 +3V3 side per field placement on this sheet) ---
    a(wire(149.86, 43.18, 149.86, 27.94))
    a(wire(149.86, 48.26, 149.86, 120.0))
    a(wire(149.86, 63.5, 149.86, 27.94))
    a(wire(149.86, 68.58, 149.86, 120.0))

    # --- U1 GND @ (129.54, 83.82) per ERC ---
    a(wire(129.54, 83.82, 129.54, 120.0))
    a(junction(129.54, 83.82))
    a(junction(129.54, 120.0))

    # --- EN pull-up R5 -> U1 EN (ERC hotspot) ---
    a(wire(116.84, 30.48, 116.84, 33.02))
    a(wire(116.84, 33.02, 114.3, 33.02))

    # --- IO0 strap R2 (ERC hotspot) ---
    a(wire(114.3, 81.28, 114.3, 38.1))

    # --- USB-C: shield / GND pads (ERC hotspots on this sheet) ---
    # SH: use one continuous vertical through the ERC-reported SH hotspot (stubs still showed as dangling).
    a(wire(27.94, 124.46, 27.94, 120.0))
    a(junction(27.94, 121.92))
    a(junction(27.94, 120.0))
    a(wire(35.56, 121.92, 38.1, 121.92))
    a(wire(38.1, 121.92, 38.1, 120.0))
    a(junction(35.56, 121.92))
    a(junction(38.1, 120.0))

    # USB2 data: short stubs + global labels (J2 B6 D+ uses ERC hotspot y=104.14)
    a(wire(50.8, 96.52, 54.61, 96.52))  # J2 A6 (D+)
    a(global_label("USB_DP", "bidirectional", 54.61, 96.52, 0))
    a(wire(50.8, 104.14, 54.61, 104.14))  # J2 B6 (D+)
    a(global_label("USB_DP", "bidirectional", 54.61, 104.14, 0))
    a(wire(50.8, 101.6, 54.61, 101.6))  # J2 A7 (D-)
    a(global_label("USB_DM", "bidirectional", 54.61, 101.6, 0))
    a(wire(50.8, 99.06, 54.61, 99.06))  # J2 B7 (D-)
    a(global_label("USB_DM", "bidirectional", 54.61, 99.06, 0))
    a(wire(144.78, 45.72, 148.59, 45.72))  # U1 USB_D+ (ERC)
    a(global_label("USB_DP", "bidirectional", 148.59, 45.72, 0))
    a(wire(144.78, 43.18, 148.59, 43.18))  # U1 USB_D- (ERC)
    a(global_label("USB_DM", "bidirectional", 148.59, 43.18, 0))

    # CC pulldowns (ERC A5/B5 + R3/R4 pin1 @ 111.76)
    a(wire(50.8, 88.9, 40.64, 88.9))
    a(wire(40.64, 88.9, 40.64, 111.76))
    a(wire(40.64, 111.76, 25.4, 111.76))  # R3 pin1
    a(junction(25.4, 111.76))
    a(wire(25.4, 116.84, 25.4, 120.0))  # R3 pin2 -> GND bus
    a(junction(25.4, 116.84))
    a(wire(50.8, 91.44, 48.26, 91.44))
    a(wire(48.26, 91.44, 48.26, 111.76))
    a(wire(48.26, 111.76, 45.72, 111.76))  # R4 pin1
    a(junction(45.72, 111.76))
    a(wire(45.72, 116.84, 50.8, 116.84))
    a(wire(50.8, 116.84, 50.8, 120.0))  # R4 pin2 -> GND bus (staggered tee)
    a(junction(45.72, 116.84))
    a(junction(50.8, 120.0))

    # --- UART test points (IO37 / pin30, IO36 / pin29; IO36 uses ERC y=53.34) ---
    a(wire(144.78, 55.88, 157.48, 55.88))
    a(wire(157.48, 55.88, 157.48, 78.74))
    a(wire(157.48, 78.74, 160.02, 78.74))  # TP1
    a(wire(144.78, 53.34, 162.56, 53.34))
    a(wire(162.56, 53.34, 162.56, 78.74))
    a(wire(162.56, 78.74, 165.1, 78.74))  # TP2

    # --- GND power symbol tie ---
    a(wire(20.32, 35.56, 25.4, 35.56))
    a(wire(25.4, 35.56, 25.4, 120.0))

    # --- PWR_FLAG on VIN ---
    a(wire(17.78, 27.94, 22.86, 27.94))
    a(wire(22.86, 27.94, 22.86, 40.64))
    a(wire(22.86, 40.64, 25.4, 40.64))

    # --- TP3 GND test point ---
    a(wire(170.18, 78.74, 170.18, 120.0))

    # --- Type-C unused USB2-only pins (explicit NC) ---
    a(no_connect_at(50.8, 83.82))  # J2 A4 VBUS (not used on this 5V input board)
    a(no_connect_at(50.8, 111.76))  # J2 A8 SBU1
    a(no_connect_at(50.8, 114.3))  # J2 B8 SBU2

    a(nc_markers_from_erc_file(Path(__file__).resolve().parents[1] / "output" / "erc_latest.txt"))

    return "".join(b)


def main() -> int:
    path = Path(__file__).resolve().parents[1] / "V1.kicad_sch"
    text = path.read_text(encoding="utf-8")
    text = scrub_injected_pwr_flags(text)
    needle = "\t(sheet_instances\n"
    idx = text.find(needle)
    if idx == -1:
        raise SystemExit("Could not find sheet_instances anchor")
    block = build_block()
    path.write_text(text[:idx] + "\n" + block + text[idx:], encoding="utf-8")
    print(f"Injected nets into {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
