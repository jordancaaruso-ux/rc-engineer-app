import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// pdf-lib path used by extractPdfFormFields
const {
  PDFDocument,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} = await import("pdf-lib");

function readFieldValue(field) {
  try {
    if (field instanceof PDFTextField) return { value: field.getText() ?? "" };
    if (field instanceof PDFCheckBox) return { value: field.isChecked() ? "1" : "" };
    if (field instanceof PDFDropdown) {
      const sel = field.getSelected();
      return { value: sel.length ? sel.join(", ") : "" };
    }
    if (field instanceof PDFOptionList) {
      const sel = field.getSelected();
      return { value: sel.length ? sel.join(", ") : "" };
    }
    if (field instanceof PDFRadioGroup) return { value: field.getSelected() ?? "" };
    return { value: "" };
  } catch (e) {
    return { value: "", readError: e instanceof Error ? e.message : String(e) };
  }
}

async function extractPdfFormFields(buffer) {
  try {
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const rawFields = form.getFields();
    const fields = rawFields.map((field) => {
      const name = field.getName();
      const { value, readError } = readFieldValue(field);
      return { name, value, readError };
    });
    return { hasFormFields: fields.length > 0, fields, loadError: undefined };
  } catch (e) {
    return {
      hasFormFields: false,
      fields: [],
      loadError: e instanceof Error ? e.message : String(e),
    };
  }
}

function fingerprint(extraction) {
  const names = extraction.fields
    .map((f) => (f.name ?? "").trim())
    .filter(Boolean)
    .map((n) => n.toLowerCase())
    .sort();
  const uniq = [];
  let prev = "";
  for (const n of names) {
    if (n === prev) continue;
    uniq.push(n);
    prev = n;
  }
  return uniq;
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function pickExactCalibration(pdfNames, candidates) {
  const matches = candidates.filter((c) => arraysEqual(pdfNames, c.names));
  if (matches.length === 1) return { kind: "exact", name: matches[0].calibrationName };
  if (matches.length > 1) return { kind: "ambiguous", names: matches.map((m) => m.calibrationName) };
  return { kind: "none" };
}

const paths = [
  "C:/Users/Jordan/Downloads/Soren test.pdf",
  "C:/Users/Jordan/Downloads/MTC3_EditableSetupSheet_CW.pdf",
];

const extractions = {};
const fps = {};
for (const p of paths) {
  const buf = readFileSync(p);
  const ext = await extractPdfFormFields(buf);
  const fp = fingerprint(ext);
  extractions[p] = ext;
  fps[p] = fp;
  console.log("\n===", p.split("/").pop(), "===");
  console.log("loadError:", ext.loadError ?? null);
  console.log("fields:", ext.fields.length, "fp:", fp.length);
  console.log("readErrors:", ext.fields.filter((f) => f.readError).length);
}

const sorenPath = paths[0];
const cwPath = paths[1];
console.log("\n--- Fingerprint match ---");
console.log("equal:", arraysEqual(fps[sorenPath], fps[cwPath]));

// Simulate: Mugen cal example IS soren file (common wizard path)
const candidates = [
  { calibrationId: "mugen", calibrationName: "Mugen MTC3", names: fps[sorenPath] },
  { calibrationId: "a800", calibrationName: "A800", names: ["camber_front", "camber_rear"] },
];

for (const p of paths) {
  const pick = pickExactCalibration(fps[p], candidates);
  console.log(p.split("/").pop(), "pick:", pick);
}

// Simulate mapping: count non-empty mapped fields (like import)
// Without real calibration JSON, count text/checkbox non-empty as proxy
function countNonempty(extraction) {
  return extraction.fields.filter((f) => {
    if (f.readError) return false;
    const v = (f.value ?? "").trim();
    return v !== "" && v !== "all off";
  }).length;
}

console.log("\n--- Nonempty fields (parse proxy) ---");
for (const p of paths) {
  console.log(p.split("/").pop(), countNonempty(extractions[p]));
}
