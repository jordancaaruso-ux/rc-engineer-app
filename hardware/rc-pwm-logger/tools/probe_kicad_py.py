import importlib

for m in ["kicad_sch", "eeschema", "sch", "kicad"]:
    try:
        importlib.import_module(m)
        print("ok", m)
    except Exception as e:
        print("no", m, type(e).__name__)
