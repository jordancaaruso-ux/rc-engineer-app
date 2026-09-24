// Answer key for the Team Associated B7.1 / B7.1D blank (PetitRC B7.1_EditableSetupSheet.pdf), built
// 2026-09-24 from Associated's B7.1 Team Kit manual (1/22/2026): the kit setup sheet on p24 is a filled
// copy of this same sheet, checked washer by washer against the build steps (p5 front ballstud mount +
// steering rack, p6 servo link, p8-9 steering plate + caster block, p12-14 rear ballstud mount + hub).
// Drawing boxes the helpers got wrong or that print only "Ball Stud Spacing" are the ones that matter:
//   top front "Ball Stud Spacing"  = washers behind the STEERING RACK ballstud (steering link inner end)
//   middle front                   = washers under the INNER camber link ballstud (front ballstud mount)
//   bottom front                   = washers under the OUTER camber link ballstud (caster block link mount)
//   the two in the steering-block drawing = the SERVO link (spacer between its rod ends; washers under
//                                     the ballstud it sits on), not a camber link or a steering link
//   low 3-2-1 holes by the bulkhead = inner camber link position (ballstud mount); tower holes = shock
// Each entry: all = regexes that must ALL match the label, none = regexes that must NOT match.
// tier "firm" = what a racer would call it is settled; "loose" = only the gist is checked.
const FRONT = /\bfront\b/i;
const REAR = /\brear\b/i;
const NOT_REAR = /^\s*rear\b|\brear (camber|shock|hub|arm|ride|axle|tower|ball)/i;
const NOT_FRONT = /^\s*front\b|\bfront (camber|shock|arm|ride|axle|tower|ball|steering)/i;

const front = (...all) => ({ all: [FRONT, ...all], none: [NOT_REAR] });
const rear = (...all) => ({ all: [REAR, ...all], none: [NOT_FRONT] });
const plain = (...all) => ({ all, none: [] });
const firm = (o, canon) => ({ ...o, tier: "firm", canon });
const loose = (o, canon) => ({ ...o, tier: "loose", canon });
const without = (o, ...none) => ({ ...o, none: [...o.none, ...none] });

const CAMBER_LINK = /camber link|upper (inner|outer)|camber-link/i;
const SHOCK = /shock|damper/i;

module.exports = {
  // header
  Text1: firm(plain(/driver/i), "Driver"), Text2: firm(plain(/event/i), "Event"),
  Text3: firm(plain(/qualif/i), "Qualifying"), Text4: firm(plain(/main/i), "Main"),
  Text5: firm(plain(/date/i), "Date"), Text6: firm({ all: [/track/i], none: [/temp/i] }, "Track"),
  Text7: firm(plain(/finish/i), "Finish"), Text8: firm(plain(/best/i, /lap/i), "Best lap time"),

  // front table
  Text9: firm(front(/ride height/i), "Front ride height"), Text10: firm(front(/camber/i), "Front camber"),
  Text11: firm(front(/toe/i), "Front toe"), Text12: firm(front(/anti-?roll|\barb\b|sway/i), "Front anti-roll bar"),
  Text13: firm(front(/arm/i), "Front arm type"), Text14: firm(front(/tower/i), "Front shock tower"),
  Text15: firm(front(/hex/i), "Front wheel hex"), Text16: firm(plain(/steering block/i), "Steering block"),
  Text17: firm(plain(/bulkhead/i, /type/i), "Front bulkhead type"),
  Text18: firm(plain(/steering stop/i), "Steering stop spacing"), Text19: firm(front(/note/i), "Front suspension notes"),
  "Check Box100": firm(plain(/caster/i, /insert/i), "Caster block insert (0 / +2.5 / +5)"),
  "Check Box101": firm(plain(/kick-?up/i), "Kick-up angle"),
  "Check Box102": firm(plain(/caster block/i, /spac|position|shim|fwd|back/i), "Caster block spacing: fwd / back"),
  "Check Box80": firm(plain(/ball ?stud mount/i), "Front ballstud mount: standard / -2mm"),

  // steering-block drawing: the servo link, bump steer, steering plate, front axle height
  Text20: firm(plain(/servo/i), "Servo link spacer (between the two rod ends)"),
  Text21: loose(plain(/servo/i), "Washers under the ballstud the servo link sits on (bellcrank)"),
  Text22: firm(plain(/bump ?steer/i), "Bump steer washers (steering plate ballstud)"),
  "Check Box81": firm({ all: [/plate|steering (block )?arm/i], none: [/camber/i] }, "Steering plate on top / bottom of the steering block arm"),
  Text23: firm(plain(/steering plate|steering (block )?arm/i), "Steering plate (which one)"),
  "Check Box104": firm(front(/axle/i, /height/i), "Front axle height"),

  // front corner drawing
  Text24: firm({ all: [/rack|steering link|tie ?rod|ackermann/i], none: [/camber/i] }, "Steering rack ballstud washers (steering link inner end)"),
  Text25: firm(without(front(CAMBER_LINK, /inner|ball ?stud mount|bulkhead/i), /outer/i, /steering|bump/i), "Front camber link inner ballstud washers"),
  Text26: firm(without(front(CAMBER_LINK, /outer|caster block|hub/i), /inner/i, /steering|bump/i), "Front camber link outer ballstud washers"),
  "Check Box83": firm(without(front(SHOCK, /tower|upper|top/i), /camber/i), "Front shock tower holes"),
  "Check Box84": firm(without(front(CAMBER_LINK, /inner|mount|hole|position/i), /shock/i, /steering/i), "Front camber link inner position (ballstud mount holes)"),
  "Check Box85": firm(without(front(SHOCK, /arm|lower|bottom/i), /camber/i), "Front shock position on the arm"),
  Text27: firm(plain(/caster block/i, /link mount/i), "Caster block link mount"),
  Text28: firm(plain(/bulkhead/i, /spac|shim|height/i), "Front bulkhead spacing"),
  "Check Box103": firm(plain(/bellcrank|rack/i), "Steering bellcrank position: up / down"),

  // rear table
  Text29: firm(rear(/ride height/i), "Rear ride height"), Text30: firm(rear(/camber/i), "Rear camber"),
  Text31: firm(rear(/anti-?roll|\barb\b|sway/i), "Rear anti-roll bar"), Text32: firm(rear(/arm/i), "Rear arm type"),
  Text33: firm(rear(/tower/i), "Rear shock tower"), Text34: firm(rear(/hex/i), "Rear wheel hex"),
  Text35: firm(rear(/note/i), "Rear suspension notes"),
  "Check Box106": firm(plain(/arm/i, /spac|position/i), "Rear arm spacing: fwd / mid / back"),
  "Check Box107": firm(plain(/hub/i, /type/i), "Rear hub type: std / HRC"),
  Text79: loose(plain(/hub/i), "Rear hub type, other"),
  "Check Box108": firm(plain(/hub/i, /spac|position|wheelbase/i), "Rear hub spacing: fwd / mid / back"),
  "Check Box109": firm(plain(/drive ?shaft|cva|universal/i), "Rear drive shafts: CVA / universals"),

  // rear mounts + axle height
  "Check Box105": firm(plain(/\bc\b.*mount|mount.*\bc\b/i, /material|alumin|steel/i), "C mount material"),
  "Check Box120": firm(plain(/\bd\b.*mount|mount.*\bd\b/i, /material|alumin|steel/i), "D mount material"),
  "Check Box126": firm(plain(/\bc\b.*mount|mount.*\bc\b|c block/i, /pin|pill|insert|position/i), "C mount (front pivot of the rear arms) hinge-pin position"),
  "Check Box127": firm(plain(/\bd\b.*mount|mount.*\bd\b|d block/i, /pin|pill|insert|position/i), "D mount (rear pivot of the rear arms) hinge-pin position"),
  "Check Box95": firm(rear(/axle/i, /height/i), "Rear axle height"),

  // rear corner drawing
  Text36: firm(without(rear(/camber link/i, /spac|washer|shim|hub|mount/i), /inner/i, /gearbox/i), "Rear camber link spacing (washers under the hub link mount)"),
  Text37: firm(without(rear(/ball ?stud|upper outer|outer/i, /hub|outer/i), /inner/i, /gearbox/i), "Rear camber link outer ballstud washers (hub)"),
  Text38: firm(without(rear(CAMBER_LINK, /inner|gearbox|mount/i), /outer/i, /\bhub\b/i), "Rear camber link inner ballstud washers (gearbox mount)"),
  "Check Box90": firm(without(rear(SHOCK, /tower|upper|top/i), /camber/i), "Rear shock tower holes"),
  "Check Box91": firm(without(rear(CAMBER_LINK, /inner|mount|hole|position/i), /shock/i), "Rear camber link inner position (ballstud mount holes)"),
  "Check Box92": firm(without(rear(SHOCK, /arm|lower|bottom/i), /camber/i), "Rear shock position on the arm"),

  // electronics
  Text39: firm(plain(/radio/i), "Radio"), Text40: firm({ all: [/servo/i], none: [/weight/i] }, "Servo"),
  Text41: firm(plain(/throttle/i), "Throttle EPA"), Text42: firm(plain(/brake/i), "Brake EPA"),
  Text43: firm({ all: [/\besc\b|speed control/i], none: [/setting/i] }, "ESC"),
  Text44: firm(plain(/\besc\b|speed control/i, /setting/i), "ESC settings"),
  Text45: firm(plain(/motor/i), "Motor / wind"), Text46: firm(plain(/timing/i), "Timing"),
  Text47: firm(plain(/pinion/i), "Pinion"), Text48: firm(plain(/spur/i), "Spur"),
  "Check Box110": firm(plain(/battery/i, /mount|std|offset/i), "Battery mount: std / offset"),
  Text49: loose(plain(/offset|battery/i), "Battery offset amount"),
  "Check Box111": firm(plain(/battery/i, /position/i), "Battery position 1-5"),
  Text50: firm({ all: [/battery/i], none: [/weight/i] }, "Battery"), Text51: firm(plain(/weight/i), "Battery weight"),
  Text52: firm(plain(/note/i), "Electronics notes"),

  // drivetrain + slipper
  "Check Box112": firm(plain(/diff/i), "Diff: ball / gear"),
  Text53: loose(plain(/height|diff/i), "Diff height"), Text54: loose(plain(/setting|diff/i), "Diff setting"),
  Text55: firm(plain(/note/i), "Drivetrain notes"),
  Text56: firm(plain(/slipper/i), "Slipper type"), Text57: firm(plain(/pad/i), "Slipper pads"),
  Text58: firm(plain(/slipper|setting/i), "Slipper setting"), Text59: firm(plain(/note/i), "Slipper notes"),

  // shocks
  Text60: firm(front(/piston/i), "Front piston"), Text61: firm(rear(/piston/i), "Rear piston"),
  Text62: loose(front(/thick/i), "Front piston thickness"), Text63: loose(rear(/thick/i), "Rear piston thickness"),
  Text64: firm(front(/oil|fluid/i), "Front shock oil"), Text65: firm(rear(/oil|fluid/i), "Rear shock oil"),
  Text66: firm(front(/spring/i), "Front spring"), Text67: firm(rear(/spring/i), "Rear spring"),
  Text68: loose(front(/limit/i), "Front limiters, in"), Text69: loose(front(/limit/i), "Front limiters, out"),
  Text70: loose(rear(/limit/i), "Rear limiters, in"), Text71: loose(rear(/limit/i), "Rear limiters, out"),
  Text72: firm(front(/stroke/i), "Front stroke"), Text73: firm(rear(/stroke/i), "Rear stroke"),
  Text74: firm(front(/eyelet/i), "Front eyelet"), Text75: firm(rear(/eyelet/i), "Rear eyelet"),
  "Check Box113": firm(front(/cup/i), "Front cup offset"), "Check Box114": firm(rear(/cup/i), "Rear cup offset"),
  "Check Box115": firm(plain(/kashima/i), "Kashima bodies"), "Check Box116": firm(plain(/chrome/i), "Chrome shafts"),
  "Check Box117": firm(plain(/machined|spacer/i), "Machined spacers"), Text76: firm(plain(/note/i), "Shock notes"),

  // track, tyres, body
  Text77: firm(plain(/size/i), "Track size"), Text78: firm(plain(/composition/i), "Track composition"),
  "Combo Box119": firm(plain(/traction/i), "Traction"), Text80: firm(plain(/moisture/i), "Moisture"),
  "Check Box121": firm(plain(/surface/i), "Surface: bumpy / smooth"), Text81: loose(plain(/surface/i), "Surface, other"),
  Text82: firm(plain(/temp/i), "Track temperature"), Text83: firm(plain(/note/i), "Track notes"),
  Text84: firm(front(/tire|tyre/i), "Front tires"), Text85: firm(front(/compound/i), "Front compound"),
  Text86: firm(front(/insert/i), "Front insert"), Text87: firm(rear(/tire|tyre/i), "Rear tires"),
  Text88: firm(rear(/compound/i), "Rear compound"), Text89: firm(rear(/insert/i), "Rear insert"),
  Text90: firm(plain(/wheel/i), "Wheels (F/R)"), Text91: firm(plain(/note/i), "Tire notes"),
  Text92: firm({ all: [/body/i], none: [/weight/i] }, "Body"), Text93: firm(plain(/front wing/i), "Front wing"),
  Text94: firm(plain(/rear wing/i), "Rear wing"), Text95: firm(plain(/chassis/i, /length|lenght/i), "Chassis length"),
  Text96: firm(plain(/servo/i, /weight/i), "Servo weights"), Text97: firm(plain(/electronic/i, /weight/i), "Electronics weights"),
  Text98: firm(plain(/total/i, /weight/i), "Total vehicle weight"), "Check Box118": firm(plain(/wing/i, /angle/i), "Wing angle"),
  Text99: firm(plain(/note|comment/i), "Vehicle comments"),
};
