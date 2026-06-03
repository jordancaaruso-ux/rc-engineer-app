const html = await fetch("https://speedhive.mylaps.com/", {
  signal: AbortSignal.timeout(20000),
}).then((r) => r.text());

for (const re of [
  /https:\/\/[^"'\s]*b2clogin[^"'\s]*/gi,
  /B2C_[A-Z0-9_]+/g,
  /clientId["':\s]+([a-f0-9-]{36})/gi,
  /tenantId["':\s]+([a-z0-9]+)/gi,
]) {
  const hits = [...html.matchAll(re)].map((m) => m[0] || m[1]).slice(0, 8);
  if (hits.length) console.log(re.source, hits);
}
