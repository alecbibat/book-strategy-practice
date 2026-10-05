// Production server for Heroku (or any Node host): serves the built app in dist/ with caching,
// compression and security headers. No dependencies; run `npm run build` first, then `npm start`.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";

/** @type {Record<string, string>} */
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff"
};
const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json)|image\/svg\+xml)/;

// The advisor's odds engine runs in a worker created from a blob: URL; cards and the felt use inline
// style attributes and a data: SVG texture. Everything else comes from this origin.
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'"
].join("; ");

/** @type {Record<string, string>} */
const SECURITY_HEADERS = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()"
};

/**
 * Hashed build output never changes, so it can be cached for a year. The page, the service worker and
 * the manifest must be revalidated so updates reach people.
 * @param {string} rel path relative to the site root, with forward slashes
 */
export function cacheControl(rel) {
  if (rel.startsWith("assets/")) return "public, max-age=31536000, immutable";
  if (rel === "index.html" || rel === "sw.js" || rel.endsWith(".webmanifest")) return "no-cache";
  return "public, max-age=86400";
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {string} body
 * @param {Record<string, string>} [extra]
 */
function sendText(res, status, body, extra = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...extra });
  res.end(body);
}

/**
 * @param {{ root: string }} options
 * @returns {http.Server}
 */
export function createAppServer({ root }) {
  const rootDir = path.resolve(root);
  return http.createServer((req, res) => {
    handle(req, res, rootDir).catch(() => {
      if (!res.headersSent) sendText(res, 500, "Server error");
      else res.destroy();
    });
  });
}

/**
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} rootDir
 */
async function handle(req, res, rootDir) {
  // Heroku's router terminates TLS and says how the request came in. The service worker and
  // install prompt need HTTPS, so send plain-HTTP visitors over.
  const proto = req.headers["x-forwarded-proto"];
  if (proto === "http" && req.headers.host) {
    res.writeHead(301, { Location: "https://" + req.headers.host + (req.url || "/"), "Cache-Control": "no-store" });
    res.end();
    return;
  }
  /** @type {Record<string, string>} */
  const hsts = proto === "https" ? { "Strict-Transport-Security": "max-age=63072000; includeSubDomains" } : {};

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method not allowed", { Allow: "GET, HEAD", ...hsts });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
  } catch {
    sendText(res, 400, "Bad request", hsts);
    return;
  }
  if (pathname.includes("\0") || pathname.includes("\\")) {
    sendText(res, 400, "Bad request", hsts);
    return;
  }
  if (pathname.endsWith("/")) pathname += "index.html";

  const file = path.join(rootDir, pathname);
  if (!file.startsWith(rootDir + path.sep)) {
    sendText(res, 404, "Not found", hsts);
    return;
  }
  const info = await stat(file).catch(() => null);
  if (!info || !info.isFile()) {
    sendText(res, 404, "Not found", hsts);
    return;
  }

  const rel = path.relative(rootDir, file).split(path.sep).join("/");
  const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
  const etag = 'W/"' + info.size.toString(16) + "-" + Math.floor(info.mtimeMs).toString(16) + '"';
  /** @type {Record<string, string>} */
  const headers = { ...SECURITY_HEADERS, ...hsts, "Content-Type": type, "Cache-Control": cacheControl(rel), ETag: etag };

  const compressible = COMPRESSIBLE.test(type) && info.size > 1024;
  if (compressible) headers.Vary = "Accept-Encoding";

  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  const accept = String(req.headers["accept-encoding"] || "");
  /** @type {zlib.BrotliCompress | zlib.Gzip | null} */
  let encoder = null;
  if (compressible && /\bbr\b/.test(accept)) {
    headers["Content-Encoding"] = "br";
    encoder = zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
  } else if (compressible && /\bgzip\b/.test(accept)) {
    headers["Content-Encoding"] = "gzip";
    encoder = zlib.createGzip({ level: 6 });
  } else {
    headers["Content-Length"] = String(info.size);
  }

  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = createReadStream(file);
  stream.on("error", () => res.destroy());
  if (encoder) stream.pipe(encoder).pipe(res);
  else stream.pipe(res);
}

// Run directly: `node server.mjs`
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(process.env.STATIC_DIR || path.join(here, "dist"));
  const index = await stat(path.join(root, "index.html")).catch(() => null);
  if (!index) {
    console.error("No build found at " + root + ". Run `npm run build` first.");
    process.exit(1);
  }
  const port = Number(process.env.PORT) || 3000;
  const server = createAppServer({ root });
  server.listen(port, () => console.log("Strategy Drill listening on port " + port));
  // Heroku sends SIGTERM before restarting a dyno: finish in-flight requests, then exit.
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}
