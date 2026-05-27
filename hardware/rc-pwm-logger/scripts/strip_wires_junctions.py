"""Remove wires, junctions, labels, global_labels, and no_connects from a KiCad 10 schematic."""
from __future__ import annotations

import re
import sys
from pathlib import Path


def strip_wires_junctions_and_labels(text: str) -> str:
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        if (
            text.startswith("(wire", i)
            or text.startswith("(junction", i)
            or text.startswith("(label", i)
            or text.startswith("(global_label", i)
            or text.startswith("(no_connect", i)
        ):
            depth = 0
            j = i
            while j < n:
                if text[j] == "(":
                    depth += 1
                elif text[j] == ")":
                    depth -= 1
                    if depth == 0:
                        j += 1
                        break
                j += 1
            out.append("\n")
            i = j
            continue
        out.append(text[i])
        i += 1
    return "".join(out)


def main() -> int:
    path = Path(__file__).resolve().parents[1] / "V1.kicad_sch"
    if len(sys.argv) > 1:
        path = Path(sys.argv[1])
    raw = path.read_text(encoding="utf-8")
    stripped = strip_wires_junctions_and_labels(raw)
    # Collapse excessive blank lines left where wires were
    stripped = re.sub(r"\n{4,}", "\n\n\n", stripped)
    path.write_text(stripped, encoding="utf-8")
    print(f"Stripped wires/junctions: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
