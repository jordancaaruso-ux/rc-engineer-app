import "server-only";

/**
 * Builds a keyword string that scores well against `content/vehicle-dynamics/*.md`
 * (token overlap) for the given canonical setup keys.
 */
export function buildVehicleDynamicsKbQueryFromChangedKeys(keys: readonly string[]): string {
  const parts = new Set<string>();
  for (const k of keys) {
    if (k.includes("upper_inner")) {
      parts.add("upper inner");
      parts.add("shims");
      parts.add("roll centre");
      parts.add("flatter");
      parts.add("angled");
      parts.add("track");
      parts.add("initial");
      parts.add("overall");
      parts.add("grip");
      parts.add("entry");
      parts.add("exit");
    }
    if (k.includes("upper_outer")) {
      parts.add("upper outer");
      parts.add("shims");
      parts.add("roll centre");
      parts.add("flatter");
      parts.add("angled");
      parts.add("net");
      parts.add("initial");
      parts.add("overall");
      parts.add("grip");
      parts.add("entry");
      parts.add("exit");
    }
    if (k.includes("under_lower_arm")) {
      parts.add("lower arm");
      parts.add("anti dive");
      parts.add("anti squat");
      parts.add("asymmetric");
      parts.add("roll centre");
      parts.add("support");
      parts.add("stiff");
      parts.add("rear");
      parts.add("front");
      parts.add("geometry");
      parts.add("forces");
      parts.add("spring");
      parts.add("arb");
      parts.add("initial");
      parts.add("overall");
      parts.add("grip");
      parts.add("entry");
      parts.add("exit");
      parts.add("mid");
      parts.add("corner");
      parts.add("understeer");
      parts.add("bumps");
    }
    if (k.includes("under_hub")) {
      parts.add("hub");
      parts.add("axle");
      parts.add("roll centre");
      parts.add("initial");
      parts.add("overall");
      parts.add("grip");
      parts.add("entry");
      parts.add("exit");
      parts.add("mid");
      parts.add("corner");
      parts.add("fishtail");
      parts.add("reactive");
    }
    if (k.includes("ride_height")) parts.add("ride height");
    if (k.includes("spring")) {
      parts.add("spring");
      parts.add("spring rate");
      parts.add("grip");
      parts.add("initial");
      parts.add("entry");
      parts.add("mid");
      parts.add("exit");
      parts.add("throttle");
      parts.add("hairpin");
      parts.add("load");
      parts.add("rotation");
      parts.add("oversteer");
      parts.add("understeer");
      parts.add("reactive");
    }
    if (k.includes("camber")) {
      parts.add("geometry");
      parts.add("camber");
      parts.add("side bite");
      parts.add("grip");
      parts.add("balance");
      parts.add("throttle");
    }
    if (k.includes("caster")) {
      parts.add("geometry");
      parts.add("caster");
      parts.add("turn");
      parts.add("rotation");
      parts.add("wheelbase");
      parts.add("throttle");
    }
    if ((k.startsWith("toe_") && !k.includes("toe_gain")) || k === "toe_front" || k === "toe_rear") {
      parts.add("geometry");
      parts.add("toe");
      parts.add("grip");
      parts.add("rotation");
      parts.add("entry");
      parts.add("exit");
    }
    if (k.includes("damper") || k.includes("damping")) {
      parts.add("damper");
      parts.add("oil");
      parts.add("damping");
      parts.add("reactive");
      parts.add("bumps");
      parts.add("grip");
      parts.add("initial");
      parts.add("entry");
      parts.add("mid");
      parts.add("rotation");
      parts.add("compliant");
    }
    if (k.includes("droop")) {
      parts.add("droop");
      parts.add("downstop");
      parts.add("extension");
      parts.add("travel");
      parts.add("grip");
      parts.add("entry");
      parts.add("mid");
      parts.add("exit");
      parts.add("throttle");
      parts.add("steering");
    }
    if (k.includes("downstop")) {
      parts.add("droop");
      parts.add("downstop");
      parts.add("travel");
      parts.add("extension");
      parts.add("entry");
      parts.add("mid");
      parts.add("exit");
      parts.add("throttle");
    }
    if (k.includes("arb")) {
      parts.add("roll");
      parts.add("sway bar");
      parts.add("hairpin");
      parts.add("understeer");
      parts.add("rotation");
      parts.add("grip");
      parts.add("entry");
      parts.add("mid");
      parts.add("throttle");
      parts.add("load");
    }
    if (k.includes("bump_steer")) {
      parts.add("bump steer");
      parts.add("compression");
      parts.add("throttle");
      parts.add("entry");
      parts.add("exit");
      parts.add("steering");
    }
    if (k.includes("toe_gain")) {
      parts.add("toe gain");
      parts.add("rear");
      parts.add("compression");
      parts.add("throttle");
      parts.add("mid");
      parts.add("corner");
      parts.add("exit");
      parts.add("grip");
      parts.add("understeer");
    }
    if (k === "chassis" || k.includes("top_deck") || k.includes("motor_mount")) {
      parts.add("flex");
      parts.add("chassis");
      parts.add("stiff");
      parts.add("grip");
      parts.add("rotation");
      parts.add("throttle");
      parts.add("precision");
      parts.add("bumps");
    }
  }
  if (parts.size === 0) {
    return "roll centre handling touring car";
  }
  return [...parts].join(" ");
}
