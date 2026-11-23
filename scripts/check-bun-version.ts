// Fails when a Dockerfile's oven/bun image tag names a different Bun than package.json's
// packageManager. CI reads the version from packageManager; the Dockerfiles repeat it by hand.
//   bun scripts/check-bun-version.ts
import { Glob } from "bun";

const root = `${import.meta.dir}/../`;
const pkg = await Bun.file(`${root}package.json`).json();
const want = /^bun@(\d+\.\d+\.\d+)$/.exec(pkg.packageManager ?? "")?.[1];
if (!want) {
  console.error(`package.json packageManager is not bun@x.y.z: ${pkg.packageManager}`);
  process.exit(1);
}

const problems: string[] = [];
let tags = 0;
for await (const path of new Glob("{apps,packages}/*/Dockerfile*").scan({ cwd: root })) {
  const lines = (await Bun.file(`${root}${path}`).text()).split("\n");
  lines.forEach((line, i) => {
    // FROM lines only, so prose in comments doesn't count. A tag without an exact x.y.z
    // (latest, alpine, 1.4) fails too: it can't be checked against packageManager.
    const m = /^\s*FROM\s+(?:--\S+\s+)*oven\/bun(?::(\S+))?/i.exec(line);
    if (!m) return;
    tags++;
    const got = /^(\d+\.\d+\.\d+)(?:-|$)/.exec(m[1] ?? "")?.[1];
    if (got !== want)
      problems.push(`${path}:${i + 1}: oven/bun:${m[1] ?? ""}, packageManager is bun@${want}`);
  });
}

if (tags === 0) problems.push("no oven/bun:<version> tags found in any Dockerfile");
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`ok: ${tags} oven/bun tags match packageManager bun@${want}`);
