import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedSetupDocumentBlobUrl } from "@/lib/setupDocuments/blobStorageRef";

const env = { BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_Ab12CdEf34Gh_secretpart" };
const own = "https://ab12cdef34gh.private.blob.vercel-storage.com";

test("our store, setup-documents prefix: allowed (store id is lowercased from the token)", () => {
  assert.equal(isAllowedSetupDocumentBlobUrl(`${own}/setup-documents/2026-09-24-abc.pdf`, env), true);
  assert.equal(
    isAllowedSetupDocumentBlobUrl(
      "https://ab12cdef34gh.public.blob.vercel-storage.com/setup-documents/a.pdf",
      env
    ),
    true
  );
});

test("another store's address is refused, even under setup-documents/", () => {
  assert.equal(
    isAllowedSetupDocumentBlobUrl(
      "https://someoneelse123.public.blob.vercel-storage.com/setup-documents/huge.pdf",
      env
    ),
    false
  );
});

test("our store but outside setup-documents/ is refused", () => {
  assert.equal(isAllowedSetupDocumentBlobUrl(`${own}/videos/a.mp4`, env), false);
  assert.equal(isAllowedSetupDocumentBlobUrl(`${own}/x/setup-documents/a.pdf`, env), false);
});

test("not https, not a URL, or no token: refused", () => {
  assert.equal(
    isAllowedSetupDocumentBlobUrl("http://ab12cdef34gh.private.blob.vercel-storage.com/setup-documents/a.pdf", env),
    false
  );
  assert.equal(isAllowedSetupDocumentBlobUrl("/uploads/setup-documents/a.pdf", env), false);
  assert.equal(isAllowedSetupDocumentBlobUrl(`${own}/setup-documents/a.pdf`, {}), false);
});
