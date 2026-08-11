import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * What the "upload a sheet you've filled in" door accepts, and what it says when it refuses.
 *
 * Both decisions here have been made more than once and lost more than once, so they are pinned to
 * real files rather than to anyone's memory:
 *
 *  - **No image sheets.** Not a photo, not a scan, and not a flat PDF the app quietly turns into a
 *    picture of itself. Until 2026-08-11 `quick-create` rasterized a form-less PDF to a PNG and
 *    told the driver "your sheet is saved, values will import once it's supported" — which was
 *    never going to happen, because reading it needs a hand-drawn image map for that exact chassis.
 *  - **A refusal has to say which file to go and find.** Xray publishes the fillable and the flat
 *    version of the same sheet on the same page under nearly the same name, which is what makes
 *    this the commonest mistake a driver can make.
 *
 * The two fixtures are exactly that pair: `x4_2026_set_up_editable_v02.pdf` has 201 boxes in its
 * form layer, `x4_2026_set_up_blank.pdf` has none.
 */

const GOLD = "scripts/setup-extract-eval/gold/xray-x4-2026/files";
const EDITABLE = `${GOLD}/x4_2026_set_up_editable_v02.pdf`;
const FLAT = `${GOLD}/x4_2026_set_up_blank.pdf`;

async function postSheet(request: import("@playwright/test").APIRequestContext, path: string) {
  const res = await request.post("/api/setup-documents/quick-create", {
    multipart: {
      file: {
        name: path.split("/").pop()!,
        mimeType: "application/pdf",
        buffer: readFileSync(path),
      },
    },
    timeout: 120_000,
  });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

test("a flat PDF is refused, and told which file to look for", async ({ request }) => {
  const { status, body } = await postSheet(request, FLAT);

  expect(status, "a picture of a sheet must not be accepted").toBe(400);
  expect(body.notFillable, "refused for the right reason, not merely refused").toBe(true);
  expect(String(body.error)).toMatch(/nothing to type into/i);
  // The point of the message: it names the file to go and find, rather than just saying no.
  expect(String(body.error)).toMatch(/editable|fillable/i);
  // The promise that used to be made here, and could not be kept.
  expect(String(body.error)).not.toMatch(/once it.s supported|values will import/i);
  expect(body.documentId, "nothing is stored for a refused upload").toBeUndefined();
});

test("the editable version of the same sheet still gets through", async ({ request }) => {
  const { status, body } = await postSheet(request, EDITABLE);

  expect(body.notFillable, "the fillable sheet must not trip the form-layer gate").toBeUndefined();
  expect(status, `editable sheet refused: ${JSON.stringify(body).slice(0, 300)}`).toBeLessThan(400);
});
