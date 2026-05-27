import pathlib

needle = '(symbol "USB_C_Receptacle_USB2.0_16P"'
t = pathlib.Path(r"C:/Program Files/KiCad/10.0/share/kicad/symbols/Connector.kicad_sym").read_text(
    encoding="utf-8", errors="ignore"
)
i = t.find(needle)
print("idx", i)
print(t[i : i + 4500])
