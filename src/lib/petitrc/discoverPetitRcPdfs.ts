import "server-only";

const PETITRC_HOSTS = new Set(["site.petitrc.com"]);

// PetitRC links can occasionally hang; prefer fail-fast so bulk imports keep moving.
const FETCH_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_FOLDERS = 80;
const DEFAULT_MAX_PDFS = 60;
// Small gap to be polite to PetitRC, but keep bulk runs practical.
const REQUEST_GAP_MS = 60;

const EXCLUDE_PATH_SUBSTRINGS = [
  "translation",
  "exploded",
  "manual",
  "instructions",
  "partslist",
  "quickreference",
  "weightbias",
  "newparts",
  "features",
  "pictures",
  "/review",
  "buildtips",
  "build/",
  "youtube",
  "setup.jpg",
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function assertAllowedPetitRcUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("Invalid URL.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("Only http(s) URLs are allowed.");
  }
  if (u.username || u.password) {
    throw new Error("URL must not include credentials.");
  }
  if (!PETITRC_HOSTS.has(u.hostname)) {
    throw new Error('Only site.petitrc.com URLs are supported (e.g. https://site.petitrc.com/...).');
  }
  if (u.protocol === "http:") {
    u = new URL(u.href.replace(/^http:/i, "https:"));
  }
  return u;
}

function hubDirectoryPath(u: URL): string {
  let p = u.pathname;
  if (!p.endsWith("/")) {
    const slash = p.lastIndexOf("/");
    p = slash >= 0 ? `${p.slice(0, slash + 1)}` : "/";
  }
  return p;
}

function sameDirectoryChildFolder(abs: URL, hub: URL, hubDir: string): boolean {
  if (abs.hostname !== hub.hostname) return false;
  if (!abs.pathname.endsWith("/")) return false;
  if (abs.pathname.length <= hubDir.length) return false;
  if (!abs.pathname.startsWith(hubDir)) return false;
  const tail = abs.pathname.slice(hubDir.length);
  if (!tail || tail.includes("..")) return false;
  const lower = abs.pathname.toLowerCase();
  for (const ex of EXCLUDE_PATH_SUBSTRINGS) {
    if (lower.includes(ex)) return false;
  }
  return true;
}

function shouldImportPdfPathname(pathname: string): boolean {
  const p = pathname.toLowerCase();
  if (!p.endsWith(".pdf")) return false;
  for (const ex of EXCLUDE_PATH_SUBSTRINGS) {
    if (p.includes(ex)) return false;
  }
  if (p.includes("_manual") || p.endsWith("manual.pdf")) return false;
  if (p.includes("instructions")) return false;
  if (p.includes("supplement") && !p.includes("setup")) return false;
  if (p.endsWith("/setup.pdf") || p.endsWith("setup.pdf")) return true;
  if (p.includes("editablesetupsheet")) return true;
  if (p.includes("setupsheet") || p.includes("setup_table") || p.includes("setuptable")) return true;
  return false;
}

function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return cleaned || "petitrc_setup.pdf";
}

/** Build `Driver_Date_variant.pdf`-style names from the path under the hub. */
export function buildPetitRcOriginalFilename(pdfUrl: URL, hubDir: string): string {
  const rel = pdfUrl.pathname.slice(hubDir.length).replace(/^\/+/, "");
  const parts = rel.split("/").filter(Boolean);
  if (parts.length === 0) return sanitizeFilename("petitrc_setup.pdf");
  const last = parts[parts.length - 1] ?? "";
  const baseParts = last.toLowerCase() === "setup.pdf" ? parts.slice(0, -1) : parts;
  let stem = baseParts.join("_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (!stem) stem = "setup";
  if (!stem.toLowerCase().endsWith(".pdf")) {
    stem = `${stem}.pdf`;
  }
  return sanitizeFilename(stem);
}

function extractHrefTargets(html: string): string[] {
  const out: string[] = [];
  const re = /href\s*=\s*(["'])([^"']*)\1/gi;
  for (;;) {
    const m = re.exec(html);
    if (!m) break;
    const v = m[2]?.trim();
    if (v && !v.startsWith("#") && !v.toLowerCase().startsWith("javascript:")) {
      out.push(v);
    }
  }
  return out;
}

async function petitrcFetch(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (compatible; RC-Engineer/1.0; +https://github.com/) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
  } finally {
    clearTimeout(t);
  }
}

async function petitrcFetchHtml(url: string): Promise<string> {
  const res = await petitrcFetch(url);
  if (!res.ok) {
    throw new Error(`PetitRC fetch failed ${res.status} for ${url}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("text/html") && !ct.toLowerCase().includes("text/plain")) {
    // Some legacy pages may report octet-stream; still try text
  }
  return await res.text();
}

export type PetitRcDiscoveredPdf = {
  url: string;
  suggestedFilename: string;
};

/**
 * Crawl a PetitRC car / listing URL and collect setup PDF links (filled setup.pdf trees,
 * EditableSetupSheet-style PDFs, etc.). Best-effort: site HTML varies by manufacturer.
 */
export async function discoverPetitRcSetupPdfs(
  seedUrl: string,
  options?: { maxFolders?: number; maxPdfs?: number }
): Promise<PetitRcDiscoveredPdf[]> {
  const maxFolders = options?.maxFolders ?? DEFAULT_MAX_FOLDERS;
  const maxPdfs = options?.maxPdfs ?? DEFAULT_MAX_PDFS;

  const hub = assertAllowedPetitRcUrl(seedUrl);
  const hubDir = hubDirectoryPath(hub);

  const byUrl = new Map<string, string>();

  const considerPdf = (absHref: string) => {
    let u: URL;
    try {
      u = new URL(absHref, hub.href);
    } catch {
      return;
    }
    if (u.hostname !== hub.hostname) return;
    if (u.protocol !== "https:") return;
    if (!shouldImportPdfPathname(u.pathname)) return;
    if (!u.pathname.startsWith(hubDir) && !u.pathname.startsWith("/reglages/") && !u.pathname.startsWith("/setup/")) {
      // Allow same-site PDFs under common roots when hub is shallow
    }
    if (!u.pathname.startsWith(hubDir)) {
      // Only PDFs under the same directory tree as the pasted hub
      return;
    }
    const name = buildPetitRcOriginalFilename(u, hubDir);
    byUrl.set(u.href, name);
  };

  const considerFolder = async (folderUrl: string) => {
    await sleep(REQUEST_GAP_MS);
    const html = await petitrcFetchHtml(folderUrl);
    const folder = new URL(folderUrl);
    for (const href of extractHrefTargets(html)) {
      let abs: URL;
      try {
        abs = new URL(href, folder.href);
      } catch {
        continue;
      }
      if (abs.hostname !== hub.hostname) continue;
      if (abs.pathname.toLowerCase().endsWith(".pdf")) {
        considerPdf(abs.href);
      }
    }
    // Letter variants (a/, b/, …) with setup.pdf inside
    for (const href of extractHrefTargets(html)) {
      let abs: URL;
      try {
        abs = new URL(href, folder.href);
      } catch {
        continue;
      }
      if (abs.hostname !== hub.hostname) continue;
      if (!abs.pathname.startsWith(folder.pathname)) continue;
      const rel = abs.pathname.slice(folder.pathname.length);
      if (!/^[a-z]\/?$/i.test(rel)) continue;
      const variantDir = abs.pathname.endsWith("/") ? abs.pathname : `${abs.pathname}/`;
      const variantUrl = new URL(variantDir, folder.origin).href;
      await sleep(REQUEST_GAP_MS);
      try {
        const inner = await petitrcFetchHtml(variantUrl);
        for (const h2 of extractHrefTargets(inner)) {
          let p: URL;
          try {
            p = new URL(h2, variantUrl);
          } catch {
            continue;
          }
          if (p.hostname !== hub.hostname) continue;
          if (p.pathname.toLowerCase().endsWith("setup.pdf")) {
            considerPdf(p.href);
          }
        }
      } catch {
        // ignore broken variant
      }
    }
  };

  await sleep(REQUEST_GAP_MS);
  const mainHtml = await petitrcFetchHtml(hub.href.endsWith("/") ? hub.href : `${hub.origin}${hubDir}`);
  const mainBase = hub.href.endsWith("/") ? hub.href : `${hub.origin}${hubDir}`;

  for (const href of extractHrefTargets(mainHtml)) {
    let abs: URL;
    try {
      abs = new URL(href, mainBase);
    } catch {
      continue;
    }
    if (abs.hostname !== hub.hostname) continue;
    if (abs.pathname.toLowerCase().endsWith(".pdf")) {
      considerPdf(abs.href);
    }
  }

  const folderUrls: string[] = [];
  const seenFolder = new Set<string>();
  for (const href of extractHrefTargets(mainHtml)) {
    let abs: URL;
    try {
      abs = new URL(href, mainBase);
    } catch {
      continue;
    }
    if (!sameDirectoryChildFolder(abs, hub, hubDir)) continue;
    const key = abs.href.endsWith("/") ? abs.href : `${abs.href}/`;
    if (seenFolder.has(key)) continue;
    seenFolder.add(key);
    folderUrls.push(key);
  }

  // Stable ordering helps reproducibility, but if maxFolders is too low it also
  // repeatedly returns the same prefix. The caller should pass a sufficiently large maxFolders.
  folderUrls.sort();
  for (const f of folderUrls.slice(0, maxFolders)) {
    if (byUrl.size >= maxPdfs) break;
    try {
      await considerFolder(f);
    } catch {
      // skip unreadable folder
    }
  }

  // Single setup page: user pasted .../Driver_Date/ — not listed as child of self
  if (byUrl.size === 0 && hub.pathname.endsWith("/") && hub.pathname !== hubDir) {
    try {
      await considerFolder(hub.href.endsWith("/") ? hub.href : `${hub.href}/`);
    } catch {
      /* empty */
    }
  }

  const out: PetitRcDiscoveredPdf[] = [...byUrl.entries()].slice(0, maxPdfs).map(([url, suggestedFilename]) => ({
    url,
    suggestedFilename,
  }));
  return out;
}

export async function fetchPetitRcPdfBytes(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const u = assertAllowedPetitRcUrl(url);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(u.href, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        Accept: "application/pdf,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (compatible; RC-Engineer/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) {
      throw new Error(`Download failed HTTP ${res.status}`);
    }
    const ct = res.headers.get("content-type") ?? "application/octet-stream";
    const buf = new Uint8Array(await res.arrayBuffer());
    return { bytes: buf, contentType: ct };
  } finally {
    clearTimeout(t);
  }
}
