"""Remove schematic wire blocks whose segment touches x=205.74 mm (SD net column)."""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCH = ROOT / "V1.kicad_sch"
text = SCH.read_text(encoding="utf-8")

wire_block = re.compile(
    r"\t\(wire\n"
    r"\t\t\(pts \(xy (?P<x1>[-\d.]+) (?P<y1>[-\d.]+)\) \(xy (?P<x2>[-\d.]+) (?P<y2>[-\d.]+)\)\)\n"
    r"\t\t\(stroke[^\n]*\)\n"
    r"\t\t\(uuid \"(?P<u>[0-9a-f-]+)\"\)\n"
    r"\t\)\n",
    re.MULTILINE,
)

removed = 0

def has_sd_endpoint(m: re.Match) -> bool:
    x1, x2 = float(m.group("x1")), float(m.group("x2"))
    return abs(x1 - 205.74) < 0.01 or abs(x2 - 205.74) < 0.01


def repl(m: re.Match) -> str:
    global removed
    if has_sd_endpoint(m):
        removed += 1
        return ""
    return m.group(0)


new_text, n = wire_block.subn(repl, text)
print(f"removed {removed} wire block(s) touching x=205.74")
SCH.write_text(new_text, encoding="utf-8")
