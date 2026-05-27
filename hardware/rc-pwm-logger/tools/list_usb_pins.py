import pathlib
import re

t = pathlib.Path(r"C:/Program Files/KiCad/10.0/share/kicad/symbols/Connector.kicad_sym").read_text(
    encoding="utf-8", errors="ignore"
)
needle = '(symbol "USB_C_Receptacle_USB2.0_16P"'
i = t.find(needle)
j = t.find("\n\t(symbol \"", i + 10)  # next top-level symbol - fragile
block = t[i:j]
# pin lines with number
for line in block.splitlines():
    if "\t\t\t(number " in line or '(name "' in line:
        if "number" in line or "(name" in line:
            if "number" in line:
                print(line.strip())
