import sys, time
sys.path.insert(0, r"c:\Users\Jordan\Documents\rc-engineer-app\hardware\rc-pwm-carrier\scripts")
import gen_schematic as g

for lib_id, (path, name) in g.SOURCES.items():
    t0 = time.time()
    raw = g.read_text(path)
    t1 = time.time()
    text = g.extract_symbol(raw, name)
    t2 = time.time()
    pins = g.pins_of(text)
    t3 = time.time()
    print(f"{lib_id}: read {t1-t0:.2f}s extract {t2-t1:.2f}s pins {t3-t2:.2f}s len {len(text)} npins {len(pins)}", flush=True)
