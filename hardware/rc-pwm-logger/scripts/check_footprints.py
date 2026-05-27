"""Report schematic symbols that still need a board footprint."""

from __future__ import annotations

import re
from pathlib import Path

sch = Path(__file__).resolve().parents[1] / "V1.kicad_sch"
lines = sch.read_text(encoding="utf-8").splitlines()

# Sheet instances: a line that is exactly "\t(symbol" followed by "\t\t(lib_id ..."
ref_re = re.compile(r'\(property "Reference" "([^"]+)"')
fp_re = re.compile(r'\(property "Footprint" "([^"]*)"')


def collect_sheet_symbol_blocks() -> list[tuple[int, list[str]]]:
    blocks: list[tuple[int, list[str]]] = []
    i = 0
    while i < len(lines) - 1:
        if lines[i] == "\t(symbol" and "(lib_id" in lines[i + 1]:
            start = i
            block: list[str] = []
            j = i
            while j < len(lines):
                line = lines[j]
                block.append(line)
                j += 1
                if j > i and line == "\t)":
                    break
            blocks.append((start + 1, block))
            i = j
            continue
        i += 1
    return blocks


def main() -> None:
    empty_libdef_lines = sum(1 for ln in lines if '(property "Footprint" ""' in ln)

    missing: list[tuple[str, int, str | None]] = []
    for start_line, block in collect_sheet_symbol_blocks():
        block_txt = "\n".join(block)
        ref_m = ref_re.search(block_txt)
        fp_m = fp_re.search(block_txt)
        ref = ref_m.group(1) if ref_m else "?"
        fp = fp_m.group(1) if fp_m else ""
        if fp == "":
            lib_m = re.search(r'\(lib_id "([^"]+)"\)', block_txt)
            lib = lib_m.group(1) if lib_m else "?"
            missing.append((ref, start_line, lib))

    print("lib/sheet lines with (property Footprint \"\") string:", empty_libdef_lines)
    print("placed symbols with empty Footprint field:", len(missing))
    for ref, ln, lib in sorted(missing, key=lambda x: x[0]):
        print(f"  {ref:12}  lib_id={lib}  (symbol starts line {ln})")

    watch = {"U1", "U2", "R3", "R7", "J2", "J4", "F1"}
    print("sample refs:")
    for start_line, block in collect_sheet_symbol_blocks():
        block_txt = "\n".join(block)
        ref_m = ref_re.search(block_txt)
        if not ref_m:
            continue
        ref = ref_m.group(1)
        if ref not in watch:
            continue
        fp_m = fp_re.search(block_txt)
        fp = fp_m.group(1) if fp_m else ""
        print(f"  {ref}: {fp or '(empty)'}")


if __name__ == "__main__":
    main()
