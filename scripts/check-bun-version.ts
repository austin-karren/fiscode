// Fails when a Dockerfile's oven/bun image tag names a different Bun than package.json's
// packageManager. CI reads the version from packageManager; the Dockerfiles repeat it by hand.
//   bun scripts/check-bun-version.ts
import { Glob } from "bun";

const root = new URL("..", import.meta.url).pathname;
const pkg = await Bun.file(`${root}package.json`).json();
const want = /^bun@(\d+\.\d+\.\d+)$/.exec(pkg.packageManager ?? "")?.[1];
if (!want) {
  console.error(`package.json packageManager is not bun@x.y.z: ${pkg.packageManager}`);
  process.exit(1);
}

const problems: string[] = [];
let tags = 0;
for await (const path of new Glob("**/Dockerfile*").scan({ cwd: root })) {
  if (path.includes("node_modules/")) continue;
  const lines = (await Bun.file(`${root}${path}`).text()).split("\n");
  lines.forEach((line, i) => {
    // Only versioned tags; the prose "oven/bun:alpine" in a comment has no version.
    for (const m of line.matchAll(/oven\/bun:(\d+\.\d+\.\d+)/g)) {
      tags++;
      if (m[1] !== want)
        problems.push(`${path}:${i + 1}: oven/bun:${m[1]}, packageManager is bun@${want}`);
    }
  });
}

if (tags === 0) problems.push("no oven/bun:<version> tags found in any Dockerfile");
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`ok: ${tags} oven/bun tags match packageManager bun@${want}`);
