// Answer key for the ARC A11 blank, built from the 6x render + ARC's A11 manual (upper A-arm on two
// linkages, "Hub Shims 0.5-1.5mm", "Bumpsteer shim range 5-8mm", ATS = rear toe-change linkage,
// 4x11 track-width shims, up-stop plate, eccentric axle/diff height).
// Each entry: all = regexes that must ALL match the label, none = regexes that must NOT match.
// tier "firm" = I am sure what a racer would call it; "loose" = only the gist is checked.
const FRONT = /\bfront\b|\bff\b|\bfr\b/i;
const REAR = /\brear\b|\brf\b|\brr\b/i;
const NOT_REAR_END = /^\s*rear\b|\brear (upper|lower|hub|toe|end|axle|suspension|arm|shock|camber|ride|down-?stop|up-?stop|track|wheel|caster)/i;
const NOT_FRONT_END = /^\s*front\b|\bfront (upper|lower|hub|toe|end|axle|suspension|arm|shock|camber|ride|down-?stop|up-?stop|track|wheel|steering|caster)/i;
const UPPER = /upper|camber link|a-?arm|top link|upper link/i;
const INNER = /inner|inboard|bulkhead|chassis end|chassis side|tower end/i;
const LOWER_MOUNT = /lower arm|suspension mount|arm mount|pivot mount|lower mount|suspension block|holder|bulkhead|arm pivot|under.?arm/i;
const FWD_PIVOT = /\bff\b|\brf\b|forward|front (link|pivot|mount|ball|stud|side|block|holder|position|pin)|leading|(nearest|towards?|closest to) the (nose|front)/i;
const AFT_PIVOT = /\bfr\b|\brr\b|rearward|rear (link|pivot|mount|ball|stud|side|block|holder|position|pin)|trailing|(nearest|towards?|closest to) the (tail|rear)/i;

const front = (...all) => ({ all: [FRONT, ...all], none: [NOT_REAR_END] });
const rear = (...all) => ({ all: [REAR, ...all], none: [NOT_FRONT_END] });
const plain = (...all) => ({ all, none: [] });
const firm = (o, canon) => ({ ...o, tier: "firm", canon });
const loose = (o, canon) => ({ ...o, tier: "loose", canon });
const without = (o, ...none) => ({ ...o, none: [...o.none, ...none] });

module.exports = {
  // header + paperwork
  Text1: firm(plain(/driver/i), "Driver"), Text2: firm(plain(/date/i), "Date"),
  Text3: firm({ all: [/track/i], none: [/temp/i] }, "Track"), Text4: firm(plain(/event/i), "Event"),
  Text5: firm(plain(/city/i), "City"), Text6: firm(plain(/air/i, /temp/i), "Air temperature"),
  Text7: firm(plain(/track/i, /temp/i), "Track temperature"), Text8: firm(plain(/qualif/i), "Qualifying"),
  Text9: firm(plain(/best/i, /lap/i), "Best lap time"), Text10: firm(plain(/final/i), "Final"),
  Text11: firm(plain(/race/i, /length|duration|time/i), "Race length"),
  "Check Box5": firm(plain(/carpet|asphalt|surface/i), "Surface: carpet / asphalt"),
  "Check Box6": firm(plain(/indoor|outdoor/i), "Indoor / outdoor"),
  C02_CARPET: firm(plain(/bump|smooth|condition/i), "Track condition: bumpy / smooth"),
  C02_ASPHALT: firm(plain(/bump|smooth|condition/i), "Track condition: bumpy / smooth"),
  C02_TECHNICAL: firm(plain(/layout|technical|mixed|fast|type|character/i), "Layout: technical / mixed / fast"),
  C02_MIXED: firm(plain(/layout|technical|mixed|fast|type|character/i), "Layout"),
  C02_FAST: firm(plain(/layout|technical|mixed|fast|type|character/i), "Layout"),
  C02_LOW: firm(plain(/traction|grip/i), "Traction"), C02_MEDIUM: firm(plain(/traction|grip/i), "Traction"),
  C02_HIGH: firm(plain(/traction|grip/i), "Traction"),
  // drivetrain + electronics
  C03_Belt_FRON: firm(plain(/belt/i), "Belt: std / soft"),
  Text12: firm(plain(/diff/i, /oil|cst/i), "Diff oil (cSt)"), Text13: loose(plain(/diff/i), "Diff (g)"),
  Motor: firm(plain(/motor/i), "Motor"), ESC: firm(plain(/esc|speed control/i), "ESC"),
  Spur: firm(plain(/spur/i), "Spur"), Pinion: firm(plain(/pinion/i), "Pinion"),
  DP: firm(plain(/pitch|\bdp\b/i), "Pitch"), FDR: firm(plain(/fdr|final drive|ratio/i), "FDR"),
  // shocks, bars, tyres, body
  Text14: firm(front(/shock|damper/i, /oil|cst/i), "Front shock oil"), Text15: firm(rear(/shock|damper/i, /oil|cst/i), "Rear shock oil"),
  C05_SPRING_PDS_Front: firm(front(/cap|hole|open|bleed/i), "Front shock cap hole"),
  C05_SPRING_PDS_Rear: firm(rear(/cap|hole|open|bleed/i), "Rear shock cap hole"),
  Text16: firm(front(/spring/i), "Front spring"), Text17: firm(rear(/spring/i), "Rear spring"),
  Text18: firm(front(/piston/i), "Front piston"), Text19: firm(rear(/piston/i), "Rear piston"),
  Text20: firm(front(/rebound/i), "Front rebound"), Text21: firm(rear(/rebound/i), "Rear rebound"),
  Text22: firm(front(/anti-?roll|\barb\b|sway/i), "Front anti-roll bar"), Text23: firm(rear(/anti-?roll|\barb\b|sway/i), "Rear anti-roll bar"),
  Text24: firm(plain(/tyre|tire/i), "Tyres"), Text25: firm({ all: [/additive/i], none: [/time/i] }, "Additive"),
  Text26: firm(plain(/additive/i, /time/i), "Additive time"), Text27: firm(plain(/glue|wall|diam/i), "Front tyre glued wall diameter"),
  C06_TREATEDAREA_FL1: loose(plain(/treat|additive|area/i), "Treated area FL"),
  C06_TREATEDAREA_FR1: loose(plain(/treat|additive|area/i), "Treated area FR"),
  C06_TREATEDAREA_RL1: loose(plain(/treat|additive|area/i), "Treated area RL"),
  C06_TREATEDAREA_RR1: loose(plain(/treat|additive|area/i), "Treated area RR"),
  Text28: firm(plain(/height/i, /body|nose|front/i), "Body height (nose)"), Text29: firm(plain(/tower/i), "Body tower edge"),
  Text30: firm(plain(/window/i), "Body window edge"), Text31: firm({ all: [/height/i, /rear|post/i], none: [/wing/i] }, "Rear body height (at the rear body post)"),
  Text32: firm({ all: [/body/i], none: [/height|tower|window/i] }, "Body"), Text33: firm({ all: [/wing/i], none: [/height/i] }, "Wing"),
  Text34: loose(plain(/note|comment/i), "Notes"),
  // parts + screws (bottom band)
  C1_UPPERDECK: firm(plain(/top deck|upper deck/i), "Top deck"),
  "C1_UPPER_CUT-1": firm(plain(/cut/i), "Top deck cut"), "C1_UPPER_CUT-2": firm(plain(/cut/i), "Top deck cut"),
  "C1_UPPER_CUT-3": firm(plain(/cut/i), "Top deck cut"), "C1_UPPER_CUT-4": firm(plain(/cut/i), "Top deck cut"),
  C18_BUMPER: firm(plain(/bumper/i), "Bumper"),
  "C18_ARM-F": firm(front(/arm/i), "Front arms"), "C18_ARM-R": firm(rear(/arm/i), "Rear arms"),
  "C4_R158041-O": firm(front(/arm|short/i), "Front short arms + mount screws"),
  "C4_R158042-O": firm(rear(/arm|short/i), "Rear short arms + mount screws"),
  "C4_MOTER-1": firm(plain(/motor/i, /mount|screw/i), "Motor mount screw"), "C4_MOTER-2": firm(plain(/motor/i, /mount|screw/i), "Motor mount screw"),
  "C4_MOTER-3": firm(plain(/motor/i, /mount|screw/i), "Motor mount screw"), "C4_MOTER-4": firm(plain(/motor/i, /mount|screw/i), "Motor mount screw"),
  C18_CHASSIS: firm(plain(/chassis/i), "Chassis"),
  "C18_LOWERSHOCK-F": firm(front(/shock/i, /mount|lower/i), "Front lower shock mount"),
  "C18_LOWERSHOCK-R": firm(rear(/shock/i, /mount|lower/i), "Rear lower shock mount"),
  // top view
  Text72: firm(plain(/toe/i, /out/i), "Front toe out"), Text73: firm(plain(/toe/i, /\bin\b/i), "Front toe in"),
  Text74: firm(plain(/steer/i, /max|lock|angle/i), "Max steering angle (outside wheel)"),
  Text77: firm(plain(/steer/i, /max|lock|angle/i), "Max steering angle (outside wheel)"),
  Text75: loose(rear(/toe/i), "Rear toe"), Text76: loose(rear(/toe/i), "Rear toe"),
  C11_STEERING: firm(plain(/steer|ackerman/i, /outside|inside|position|hole|ackerman/i), "Ackermann: outside / inside"),
  Text78: loose(plain(/weight|ballast/i), "Ballast weight"), Text79: loose(plain(/weight|ballast/i), "Ballast weight"),
  Text81: loose(plain(/weight|ballast/i), "Ballast weight"), Text82: loose(plain(/weight|ballast/i), "Ballast weight"),
  Text83: loose(plain(/weight|ballast/i), "Ballast weight"), Text84: loose(plain(/weight|ballast/i), "Ballast weight"),
  Text85: loose(plain(/weight|ballast/i), "Ballast weight"), Text86: loose(plain(/weight|ballast/i), "Ballast weight"),
  Text87: loose(plain(/weight|ballast/i), "Ballast weight"),
  Text80: firm(plain(/battery/i, /weight/i), "Battery weight"),
  C18_R158020: loose(plain(/158020/i), "R158020 fitted"), C18_R158025: loose(plain(/158025/i), "R158025 fitted"),
  c19_Screw_Front: loose(plain(/158025/i), "R158025 fitted"),
  C18_DIFFHEIGHT_REAR: firm(rear(/diff/i, /height/i), "Rear diff height"),
  C18_AXLE: firm(plain(/axle/i, /height/i), "Front axle height"),
  C18_REAR_BODYPOST: firm(plain(/body ?post|body mount/i), "Rear body post"),
  "C11_ChassisServo-1": loose(plain(/screw|deck|flex/i), "Top deck screw"),
  // FRONT geometry block
  Text51: firm(front(/camber/i), "Front camber R"), Text52: firm(front(/camber/i), "Front camber L"),
  Text58: firm(front(/ride height/i), "Front ride height"),
  Text53: firm(without(front(/kingpin|upper|a-?arm|camber|hub|upright|post/i, /height/i), /inner/i), "Front upper arm outer post (kingpin) height"),
  Text54: firm(front(/shock|damper/i), "Front shock shims"),
  "c19_Screw_Rear-1": loose(plain(/screw/i, /fix|remov|fitted/i), "Front upper screw fix / remove"),
  c19_Screw_Rear: loose(plain(/screw/i, /fix|remov|fitted/i), "Front lower screw fix / remove"),
  Text55: firm(without(front(/hub|upright|c-?hub|knuckle/i), /upper/i), "Front under hub shims"),
  Text56: firm(without(front(/upper/i, /outer|upright|hub|knuckle|c-?hub/i), /inner/i), "Front upper outer shims"),
  Text57: firm(front(/hex|track width|wheel (spacer|shim)|axle (spacer|shim)|track/i), "Front track width (hex) shims"),
  Text66: firm(front(/down-?stop|droop/i), "Front downstop"), Text68: firm(front(/down-?stop|droop/i), "Front downstop"),
  Text67: firm(front(/up-?stop|up.?travel/i), "Front up-stop"),
  // REAR geometry block
  Text60: firm(rear(/camber/i), "Rear camber R"), Text61: firm(rear(/camber/i), "Rear camber L"),
  Text59: firm(rear(/ride height/i), "Rear ride height"),
  Text62: firm(rear(/shock|damper/i), "Rear shock shims"),
  C11_CHASSIS_Shock_F: loose(plain(/screw/i, /fix|remov|fitted/i), "Rear upper screw fix / remove"),
  C11_CHASSIS_Shock_R: loose(plain(/screw/i, /fix|remov|fitted/i), "Rear lower screw fix / remove"),
  Text63: firm(without(rear(/hub|upright|c-?hub|knuckle/i), /upper/i), "Rear under hub shims"),
  Text64: firm(without(rear(/upper/i, /outer|upright|hub|knuckle|c-?hub/i), /inner/i), "Rear upper outer shims"),
  Text65: firm(rear(/hex|track width|wheel (spacer|shim)|axle (spacer|shim)|track/i), "Rear track width (hex) shims"),
  Text70: firm(rear(/down-?stop|droop/i), "Rear downstop"), Text71: firm(rear(/down-?stop|droop/i), "Rear downstop"),
  Text69: firm(rear(/up-?stop|up.?travel/i), "Rear up-stop"),
  // TOP BAND: side views of both ends (front of car drawn LEFT)
  Text38: firm(front(/caster/i), "Front caster"), Text44: firm(rear(/caster|kick/i), "Rear caster"),
  Text35: firm(front(UPPER, INNER, FWD_PIVOT), "Front upper inner shims, front link (FF)"),
  Text39: firm(front(UPPER, INNER, AFT_PIVOT), "Front upper inner shims, rear link (FR)"),
  Text40: firm(front(/bump.?steer/i), "Front bump steer shims"),
  Text42: firm(rear(/\bats\b|toe/i), "Rear ATS shims (toe change)"),
  Text43: firm(rear(UPPER, INNER, FWD_PIVOT), "Rear upper inner shims, front link (RF)"),
  Text45: firm(rear(UPPER, INNER, AFT_PIVOT), "Rear upper inner shims, rear link (RR)"),
  Text36: loose(front(/wheelbase|hinge|pivot pin|fore.?aft|(hub|upright|c-?hub|caster block|knuckle).{0,20}(position|spacer|fore|aft|front|rear)/i), "Front hub fore/aft spacers (wheelbase)"),
  Text46: loose(rear(/wheelbase|hinge|pivot pin|fore.?aft|(hub|upright|c-?hub|caster block|knuckle).{0,20}(position|spacer|fore|aft|front|rear)/i), "Rear hub fore/aft spacers (wheelbase)"),
  Text37: firm(without(front(LOWER_MOUNT, FWD_PIVOT), /upper/i), "Front under lower arm shims, front pivot (FF)"),
  Text47: firm(without(front(LOWER_MOUNT, AFT_PIVOT), /upper/i), "Front under lower arm shims, rear pivot (FR)"),
  Text49: firm(without(rear(LOWER_MOUNT, FWD_PIVOT), /upper/i), "Rear under lower arm shims, front pivot (RF)"),
  Text50: firm(without(rear(LOWER_MOUNT, AFT_PIVOT), /upper/i), "Rear under lower arm shims, rear pivot (RR)"),
  // excluded (not resolvable from the sheet or the manual): Text41, Text48
};
