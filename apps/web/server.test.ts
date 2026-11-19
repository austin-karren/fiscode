// Runs under Bun (`bun test server.test.ts`), not vitest: the server uses
// hono/bun's static file handler, which needs the Bun runtime. Requests go
// straight to `app.fetch`; no port is bound.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "./server";

const IMMUTABLE = "public, max-age=31536000, immutable";

let dist: string;
let get: (path: string, method?: string) => Promise<Response>;

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), "fiscode-dist-"));
  await mkdir(join(dist, "assets"));
  await mkdir(join(dist, "tax-data", "v1"), { recursive: true });
  await writeFile(join(dist, "index.html"), "<!doctype html><title>fiscode</title>");
  await writeFile(join(dist, "assets", "index-abc123.js"), "console.log(1)");
  await writeFile(join(dist, "icon.svg"), "<svg/>");
  await writeFile(join(dist, "tax-data", "v1", "2026.json"), "{}");
  const app = createApp(dist);
  get = async (path, method = "GET") =>
    app.fetch(new Request(`http://localhost${path}`, { method }));
});

afterAll(() => rm(dist, { recursive: true, force: true }));

describe("the HTML document", () => {
  test.each(["/", "/index.html", "/income", "/year-end", "/some/deep/route"])(
    "%s is the app shell, never stored, with the isolation headers",
    async (path) => {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain("<title>fiscode</title>");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
      expect(res.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
    },
  );

  test("HEAD / carries the same headers", async () => {
    const res = await get("/", "HEAD");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("files that do not exist", () => {
  test.each([
    "/assets/index-old999.js",
    "/assets/gone.css",
    "/assets/no-extension",
    "/assets/",
    "/missing.png",
    "/sw.js",
    "/tax-data/v1/1999.json",
    "/deep/route/file.map",
  ])("%s is a 404, not the app shell, and is not cached as immutable", async (path) => {
    const res = await get(path);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("<title>fiscode</title>");
    expect(res.headers.get("cache-control") ?? "").not.toContain("immutable");
    expect(res.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
  });
});

describe("files that exist", () => {
  test("a hashed asset keeps its long immutable cache", async () => {
    const res = await get("/assets/index-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("cache-control")).toBe(IMMUTABLE);
    expect(res.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
  });

  test("a root file is served as itself, with no immutable cache", async () => {
    const res = await get("/icon.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(res.headers.get("cache-control")).toBeNull();
  });

  test("tax data is unchanged: JSON, no cache header", async () => {
    const res = await get("/tax-data/v1/2026.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBeNull();
  });

  test("/healthz is unchanged", async () => {
    const res = await get("/healthz");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(res.headers.get("cache-control")).toBeNull();
  });
});
