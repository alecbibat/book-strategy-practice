import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CSP, cacheControl, createAppServer } from "../../server.mjs";

let root = "";
let server: http.Server;
let port = 0;

interface Reply { status: number; headers: http.IncomingHttpHeaders; body: Buffer }

/** Raw request, so paths like /..%2f reach the server unnormalised. */
function request(rawPath: string, opts: { method?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: rawPath, method: opts.method || "GET", headers: opts.headers }, res => {
      const chunks: Buffer[] = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "sd-server-"));
  const site = path.join(root, "dist");
  mkdirSync(path.join(site, "assets"), { recursive: true });
  writeFileSync(path.join(site, "index.html"), "<!doctype html><title>t</title>" + "x".repeat(4000));
  writeFileSync(path.join(site, "assets", "index-abc123.js"), "console.log(1);" + " ".repeat(3000));
  writeFileSync(path.join(site, "sw.js"), "self.addEventListener('fetch',()=>{});");
  writeFileSync(path.join(site, "icon-192.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(path.join(root, "secret.txt"), "do not serve");
  server = createAppServer({ root: site });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>(r => server.close(() => r()));
  rmSync(root, { recursive: true, force: true });
});

describe("server", () => {
  it("serves the page with security headers and revalidation", async () => {
    const r = await request("/");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(r.headers["cache-control"]).toBe("no-cache");
    expect(r.headers["content-security-policy"]).toBe(CSP);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.body.toString()).toContain("<title>t</title>");
  });

  it("caches hashed assets for a year and compresses text", async () => {
    const r = await request("/assets/index-abc123.js", { headers: { "Accept-Encoding": "gzip" } });
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(r.headers["content-encoding"]).toBe("gzip");
    expect(r.headers.vary).toBe("Accept-Encoding");
    expect(zlib.gunzipSync(r.body).toString()).toMatch(/^console\.log\(1\);/);
    const br = await request("/assets/index-abc123.js", { headers: { "Accept-Encoding": "gzip, deflate, br" } });
    expect(br.headers["content-encoding"]).toBe("br");
    expect(zlib.brotliDecompressSync(br.body).toString()).toMatch(/^console\.log\(1\);/);
  });

  it("never lets the service worker go stale", async () => {
    expect((await request("/sw.js")).headers["cache-control"]).toBe("no-cache");
    expect(cacheControl("manifest.webmanifest")).toBe("no-cache");
    expect(cacheControl("icon-192.png")).toBe("public, max-age=86400");
  });

  it("sends binary files as-is with a length", async () => {
    const r = await request("/icon-192.png", { headers: { "Accept-Encoding": "gzip" } });
    expect(r.headers["content-type"]).toBe("image/png");
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect(r.headers["content-length"]).toBe("4");
  });

  it("answers conditional requests with 304", async () => {
    const first = await request("/");
    const again = await request("/", { headers: { "If-None-Match": String(first.headers.etag) } });
    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);
  });

  it("stays inside the site folder", async () => {
    for (const p of ["/../secret.txt", "/..%2fsecret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt", "/..%5csecret.txt"]) {
      const r = await request(p);
      expect([400, 404]).toContain(r.status);
      expect(r.body.toString()).not.toContain("do not serve");
    }
  });

  it("rejects bad paths and methods", async () => {
    expect((await request("/%E0%A4%A")).status).toBe(400);
    expect((await request("/%00")).status).toBe(400);
    expect((await request("/nope.js")).status).toBe(404);
    expect((await request("/assets")).status).toBe(404);
    const post = await request("/", { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe("GET, HEAD");
  });

  it("answers HEAD without a body", async () => {
    const r = await request("/", { method: "HEAD" });
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(0);
  });

  it("sends Heroku's plain-HTTP visitors to HTTPS and pins HTTPS once there", async () => {
    const r = await request("/assets/index-abc123.js?x=1", { headers: { "X-Forwarded-Proto": "http", Host: "example.herokuapp.com" } });
    expect(r.status).toBe(301);
    expect(r.headers.location).toBe("https://example.herokuapp.com/assets/index-abc123.js?x=1");
    const s = await request("/", { headers: { "X-Forwarded-Proto": "https" } });
    expect(s.headers["strict-transport-security"]).toMatch(/max-age=\d+/);
  });
});
