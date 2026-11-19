#!/usr/bin/env bun
/**
 * Postbuild check: the production build must ship a web manifest and a
 * service worker that precaches what the app needs offline. Fails the build
 * otherwise, so "installable as a PWA" cannot silently stop being true.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const dist = resolve(import.meta.dir, "..", "dist");
const read = (file: string) => readFile(resolve(dist, file), "utf8");
const problems: string[] = [];
const expect = (ok: boolean, what: string) => {
  if (!ok) problems.push(what);
};

const html = await read("index.html");
expect(
  /<link rel="manifest" href="\/manifest\.webmanifest"/.test(html),
  "index.html links the manifest",
);

const manifest = JSON.parse(await read("manifest.webmanifest")) as {
  start_url?: string;
  display?: string;
  icons?: { src: string; sizes: string; purpose?: string }[];
};
expect(manifest.start_url === "/", "manifest start_url is /");
expect(manifest.display === "standalone", "manifest display is standalone");
for (const size of ["192x192", "512x512"]) {
  expect(manifest.icons?.some((i) => i.sizes === size) ?? false, `manifest has a ${size} icon`);
}
expect(
  manifest.icons?.some((i) => i.purpose === "maskable") ?? false,
  "manifest has a maskable icon",
);
for (const icon of manifest.icons ?? []) {
  expect(await Bun.file(resolve(dist, icon.src)).exists(), `icon file ${icon.src} exists`);
}

const sw = await read("sw.js");
expect(sw.includes('"index.html"'), "service worker precaches index.html");
expect(/sqlite3-[\w-]+\.wasm/.test(sw), "service worker precaches the sqlite wasm");
expect(
  /sqlite3-opfs-async-proxy-[\w-]+\.js/.test(sw),
  "service worker precaches the OPFS proxy worker",
);
expect(!sw.includes("tax-data/"), "service worker does not precache tax data");

if (problems.length > 0) {
  console.error(
    `[check-pwa-build] failed:\n${problems.map((p) => `  - not true: ${p}`).join("\n")}`,
  );
  process.exit(1);
}
console.log("[check-pwa-build] manifest and service worker are in dist");
