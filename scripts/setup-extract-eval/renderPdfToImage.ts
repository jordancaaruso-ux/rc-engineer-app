/**
 * Render page 1 of a PDF to a PNG buffer using headless Chrome + the repo's own pdfjs-dist.
 * No new dependencies: a throwaway local HTTP server serves a harness page + pdf.mjs + the
 * PDF bytes; the page renders to canvas and POSTs the PNG data URL back; Chrome is killed.
 *
 * Windows notes: chrome lives at "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
 * --window-size is broken on this machine but irrelevant here (canvas render, not screenshot).
 */
import { createServer } from "node:http";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const PDFJS_DIR = join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build");

const HARNESS = `<!doctype html><html><body><script type="module">
  import * as pdfjs from "/pdf.mjs";
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
  const targetWidth = Number(new URLSearchParams(location.search).get("w") || "1684");
  try {
    const bytes = await (await fetch("/input.pdf")).arrayBuffer();
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = targetWidth / base.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    await fetch("/done", { method: "POST", body: canvas.toDataURL("image/png") });
  } catch (e) {
    await fetch("/done", { method: "POST", body: "ERROR:" + (e && e.message || String(e)) });
  }
</script></body></html>`;

export async function renderPdfPage1ToPng(pdfBytes: Buffer, targetWidth = 1684): Promise<Buffer> {
  const pdfMjs = readFileSync(join(PDFJS_DIR, "pdf.mjs"));
  const workerMjs = readFileSync(join(PDFJS_DIR, "pdf.worker.mjs"));

  return await new Promise<Buffer>((resolve, reject) => {
    let chrome: ReturnType<typeof spawn> | null = null;
    let profileDir: string | null = null;
    const timeout = setTimeout(() => finish(new Error("PDF render timed out (60s)")), 60000);

    function finish(err: Error | null, png?: Buffer) {
      clearTimeout(timeout);
      try { chrome?.kill(); } catch { /* already dead */ }
      server.close(() => {
        if (profileDir) { try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* locked */ } }
        if (err) reject(err);
        else resolve(png!);
      });
    }

    const server = createServer((req, res) => {
      const url = req.url ?? "/";
      if (url.startsWith("/harness")) { res.writeHead(200, { "Content-Type": "text/html" }); res.end(HARNESS); return; }
      if (url === "/pdf.mjs") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(pdfMjs); return; }
      if (url === "/pdf.worker.mjs") { res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(workerMjs); return; }
      if (url === "/input.pdf") { res.writeHead(200, { "Content-Type": "application/pdf" }); res.end(pdfBytes); return; }
      if (url === "/done" && req.method === "POST") {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          res.writeHead(200); res.end("ok");
          const body = Buffer.concat(chunks).toString("utf8");
          if (body.startsWith("ERROR:")) return finish(new Error(`pdfjs render failed: ${body.slice(6, 300)}`));
          const m = body.match(/^data:image\/png;base64,(.+)$/s);
          if (!m) return finish(new Error("Unexpected /done payload"));
          finish(null, Buffer.from(m[1]!, "base64"));
        });
        return;
      }
      res.writeHead(404); res.end();
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      profileDir = mkdtempSync(join(tmpdir(), "pdf-render-"));
      chrome = spawn(CHROME, [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--disable-extensions",
        `--user-data-dir=${profileDir}`,
        `http://127.0.0.1:${port}/harness?w=${targetWidth}`,
      ], { stdio: "ignore" });
      chrome.on("error", (e) => finish(new Error(`Chrome launch failed: ${e.message}`)));
    });
  });
}
