// Answer key for the Team Losi Racing 22X blank (2WD buggy), drawing boxes only, built 2026-09-24
// from TLR's 22X DC kit manual (TLR-1233): p54 is TLR's filled kit setup on this same layout, checked
// against the build steps; team sheets read from their PDF form fields. Notes and sources:
// tlr-22x-research.md. The printed table boxes (header, track conditions, drivetrain, aero, tires,
// shocks, electronics) are not keyed. Many PDF field names on this sheet are WRONG for their box
// ("Caster Angle" = kick-up, "St Rack Ball Insert" = inner camber-link insert, "Rr Outdrive" = which
// rear arm, "Rr Inner Camber Ht" = diff height, "F Block Mat" = spindle KPI, "Mud Guards" = side guards).
// Each entry: all = regexes that must ALL match the label, none = regexes that must NOT match.
// tier "firm" = settled by the manual; "loose" = the manual leaves it open, only the gist is checked.
const FRONT = /\bfront\b/i;
const REAR = /\brear\b/i;
const NOT_REAR = /^\s*rear\b|\brear (camber|shock|hub|arm|ride|axle|tower|ball|sway|anti)/i;
const NOT_FRONT = /^\s*front\b|\bfront (camber|shock|arm|ride|axle|tower|ball|steering|sway|anti)/i;

const front = (...all) => ({ all: [FRONT, ...all], none: [NOT_REAR] });
const rear = (...all) => ({ all: [REAR, ...all], none: [NOT_FRONT] });
const plain = (...all) => ({ all, none: [] });
const firm = (o, canon) => ({ ...o, tier: "firm", canon });
const loose = (o, canon) => ({ ...o, tier: "loose", canon });
const without = (o, ...none) => ({ ...o, none: [...o.none, ...none] });

const SHOCK = /shock|damper/i;
const SPACER = /spac|shim|washer/i;

module.exports = {
  // front corner (part 03)
  "Front Tower": firm(without(front(/tower/i), /hole/i), "Front shock tower: -2mm / Std / +2mm"),
  "F Upper Shock": firm(without(plain(SHOCK, /tower|upper|top/i), /camber/i), "Front upper shock position (tower hole)"),
  Text52: firm(without(front(/camber/i, /outer|caster block|mount/i), /inner/i, /steer|bump/i), "Front camber link outer ballstud washers"),
  "Steering Hub Height": loose(plain(/(axle|hub|hex).*(spac|shim|width)|(spac|shim).*(axle|hub|hex)|track width/i), "Front axle spacer (spindle to hex): 1.0 / 0.5 / 0.0"),
  Text54: firm(without(front(/camber/i, /inner|bulkhead|post|insert/i), /outer/i, /steer|bump/i), "Front camber link inner ballstud washers"),
  "Front Shock Lower": firm(without(plain(SHOCK, /arm|lower|bottom/i), /camber/i), "Front lower shock position (arm hole)"),
  "Front VLA": loose(plain(/(spindle|steering (block|hub)|knuckle|kingpin|hub).*(height|bush)|(height|bush).*(spindle|steering (block|hub)|knuckle|kingpin|hub)/i), "Front spindle height (kingpin bushings): 0.7 / 1.7 / 2.7mm"),
  "Caster Angle": firm(plain(/kick/i), "Front kick-up: 20 / 22.5 / 25 deg"),
  "Front Drive Shim": firm(plain(/pivot|arm mount|block|bridge|bulkhead/i, /material|composite|alumin|brass/i), "Front arm pivot block material: composite / aluminum / brass"),
  "Front Hub Angle": loose(plain(/camber|steer|link/i), "Camber mount A / B / C on the caster block (or steering link attach)"),
  Text58: firm(plain(/weight|brass|\bg\b|gram/i), "Brass pivot weight (g)"),

  // front table (part 04)
  Text29: firm(front(/ride height/i), "Front ride height"), Text30: firm(front(/camber/i), "Front camber"),
  Text31: firm(front(/toe/i), "Front toe"), Text32: firm(front(/sway|anti-?roll|\barb\b/i), "Front sway bar"),
  Text33: firm(plain(/note/i), "Front suspension notes"),

  // steering + front camber insert (part 05)
  "St Rack Ball Insert": firm({ all: [/camber/i, /inner|insert|post|hole|position/i], none: [/steer|rack/i] }, "Front camber link inner insert: hole 3 / 1 / 2"),
  "Steering Rack Material": firm(plain(/bellcrank|steering|rack/i, /material|composite|alumin/i), "Steering bellcrank / rack material"),
  Text42: firm({ all: [/bellcrank|rack|steering link|tie ?rod|bump/i, /inner|bellcrank|rack/i], none: [/camber/i] }, "Tie rod inner ballstud washers (under the bellcrank)"),

  // spindle (part 06) + caster block (part 07)
  "F Block Mat": firm(plain(/kpi|kingpin|inclination/i), "Spindle KPI: 2 / 4 / 6 / 8 deg"),
  "Steering Hub Ball": firm(plain(/spindle|steering block|knuckle|steering hub/i, /width|narrow|wide|\bn\b|\bw\b/i), "Spindle width: narrow / wide"),
  Text60: firm({ all: [/bump|steering (arm|link)|tie ?rod/i], none: [/camber/i] }, "Tie rod outer ballstud washers (bump steer)"),
  Text49: loose(plain(/steering arm|spindle|bump|tie ?rod/i), "Steering arm spacer"),
  "F Block Ht": firm({ all: [/caster/i], none: [/kick|width|narrow|wide/i] }, "Front caster insert: -5 / -2.5 / 0 / +2.5 / +5"),
  "Steering Rack Ball": firm(plain(/caster block/i, /width|narrow|wide|\bn\b|\bw\b/i), "Caster block width: narrow / wide"),

  // rear table (part 09)
  Text61: firm(rear(/ride height/i), "Rear ride height"), Text62: firm(rear(/camber/i), "Rear camber"),
  Text63: firm(rear(/sway|anti-?roll|\barb\b/i), "Rear sway bar"), Text64: firm(plain(/note/i), "Rear suspension notes"),

  // rear corner (part 08)
  "Rr Tower": firm(without(rear(/tower/i), /hole/i), "Rear shock tower: -2mm / Std / +2mm"),
  "Rr Upper Shock": firm(without(plain(SHOCK, /tower|upper|top/i), /camber/i), "Rear upper shock position (tower hole)"),
  "Rr Inner Camber": firm(without(rear(/camber/i, /inner|block|hole|position/i), /outer|hub/i, SHOCK), "Rear camber link inner hole (camber block)"),
  "Rear Bone": firm(plain(/drive ?shaft|bone|cva|universal/i), "Rear driveshaft: X66-X69 / Uni"),
  Text73: firm(without(rear(/camber/i, /outer|hub/i), /inner/i), "Rear camber link outer ballstud washers"),
  "Rr Drive Hex": firm(rear(/hex/i), "Rear wheel hex (mm)"),
  Text78: firm(without(rear(/camber/i, /inner|block|gearbox/i), /outer|hub/i), "Rear camber link inner ballstud washers"),
  "Rr Shock Lower": firm(without(plain(SHOCK, /arm|lower|bottom/i), /camber/i), "Rear lower shock position (arm)"),
  "Rr Outdrive": loose(plain(/arm/i), "Rear arm: 74 / 75"),
  "Rr Inner Camber Ht": loose(plain(/diff/i), "Diff height insert: 0 to +4"),

  // rear hub (part 10), CVA (part 11), C / D blocks (part 12)
  "Rr Hub Material": firm(rear(/hub/i, /material|composite|alumin|hrc|type/i), "Rear hub: composite / aluminum / HRC"),
  "Rr Hub Ball": firm(without(rear(/camber/i, /outer|hub|mount|hole|position/i), /inner/i), "Rear camber link outer hole A / B / C (hub mount)"),
  "Rr Hub Ht": firm(plain(/axle|hub|hinge.?pin/i, /height|insert/i), "Rear axle height (hub insert): 0 to +4"),
  "CVA Position": firm(plain(/cva|cross.?pin|axle|drive ?shaft|bone/i, /hole|position|pin/i), "Rear CVA cross-pin hole: 4 / 3 / 2 / 1"),
  "D Block": firm(plain(/d.?block|rear (pivot|mount|block)|\brr\b/i, /pin|pill|insert|position/i), "D block (rear pivot) hinge-pin position"),
  "C Block": firm(plain(/c.?block|front (pivot|mount|block)|\brf\b/i, /pin|pill|insert|position/i), "C block (front pivot) hinge-pin position"),

  // chassis top view (parts 18-19)
  Text153: firm(plain(/hub/i, SPACER, /front|forward|fwd|ahead/i), "Rear hub spacer in front of the hub (wheelbase)"),
  Text154: firm(plain(/hub/i, SPACER, /behind|rear side|aft|back|rearward|after/i), "Rear hub spacer behind the hub"),
  "Check Box144": firm(plain(/weight|brass/i), "Battery brass weight 19g"),
  "Check Box145": firm(plain(/weight|brass/i), "Battery brass weight 26g"),
  "Check Box146": firm(plain(/weight|brass/i), "Battery brass weight 37g"),
  "Check Box147": firm(plain(/weight|other/i), "Other weight"), Text27: firm(plain(/weight|\bg\b|gram/i), "Other weight (g)"),
  "Rr Arm Material": firm(plain(/chassis/i), "Chassis plate: +3 / STD / -3mm"),
  "Transmission Brace": firm(plain(/motor (plate|mount)/i), "Motor plate: carbon / aluminum"),
  "Check Box169": firm(plain(/brace|waterfall/i), "Waterfall brace: standard"),
  "Check Box170": firm(plain(/brace|waterfall/i), "Waterfall brace: Stiffezel"),
  Transmission: firm(rear(/arm/i), "Rear arms: standard / Stiffezel"),
  "Check Box140": firm(plain(/electronic|radio|tray/i), "Electronics tray: carbon / aluminum / steel"),
  "Check Box160": firm(plain(/battery/i, /position|holder|hole/i), "Battery holder position"),
  "Check Box161": firm(plain(/battery/i, /position|holder|hole/i), "Battery holder position"),
  "Check Box162": firm(plain(/battery/i, /position|holder|hole/i), "Battery holder position"),
  "Check Box163": firm(plain(/battery/i, /position|holder|hole/i), "Battery holder position"),
  "Check Box164": firm(plain(/battery/i, /position|holder|hole/i), "Battery holder position"),
  "Check Box165": loose(plain(/battery|carbon/i), "Carbon battery mount"),
  Text76: loose(plain(/battery|carbon|mount|holder/i), "Carbon battery mount, write-in"),
  "Check Box168": firm(plain(/(\bc\b.*(block|pivot|mount))|((block|pivot|mount).*\bc\b)/i, /material|alumin|brass/i), "C pivot block material: aluminum / brass"),
  "Mud Guards": firm(plain(/side ?guard|side rail|guard/i), "Side guards: soft / standard / Stiffezel"),
  Text166: firm(plain(/arm|hinge|pin|c.?block/i, SPACER, /front|forward|fwd|c.?block/i), "Rear arm inner pin spacer in front of the arm"),
  Text148: firm(plain(/arm|hinge|pin|d.?block/i, SPACER, /behind|rear side|aft|back|d.?block/i), "Rear arm inner pin spacer behind the arm"),
  "Ff Arm Material": firm(front(/arm/i), "Front arms: standard / Stiffezel"),
  Text173: firm(plain(/total/i, /weight/i), "Total weight"),
  Text174: firm(front(/weight|%|percent|balance|distribution/i), "Front weight %"),
  Text175: firm(rear(/weight|%|percent|balance|distribution/i), "Rear weight %"),
};
