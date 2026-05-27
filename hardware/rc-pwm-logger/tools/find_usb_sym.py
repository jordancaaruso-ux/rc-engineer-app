import pathlib
import re

p = pathlib.Path(r"C:\Program Files\KiCad\10.0\share\kicad\symbols\Connector.kicad_sym")
text = p.read_text(encoding="utf-8", errors="ignore")
for m in re.finditer(r'\(symbol "(USB_C[^"]+)"', text):
    print(m.group(1))
