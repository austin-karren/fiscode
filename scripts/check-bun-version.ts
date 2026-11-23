// Fails when a Dockerfile's oven/bun image tag names a different Bun than package.json's
// packageManager. CI reads the version from packageManager; the Dockerfiles repeat it by hand.
//   bun scripts/check-bun-version.ts
const root = `${import.meta.dir}/../`;
const pkg = await Bun.file(`${root}package.json`).json();
const want = /^bun@(\d+\.\d+\.\d+)$/.exec(pkg.packageManager ?? "")?.[1];
if (!want) {
  console.error(`package.json packageManager is not bun@x.y.z: ${pkg.packageManager}`);
  process.exit(1);
}

// Every Dockerfile git knows about, tracked or new (not ignored): the root, nested folders,
// Dockerfile.* and *.Dockerfile. node_modules and .git never appear in this list.
const files = Bun.spawnSync(["git", "ls-files", "-co", "--exclude-standard"], { cwd: root })
  .stdout.toString()
  .split("\n")
  .filter((f) => /(^|\/)(Dockerfile(\.[^/]*)?|[^/]+\.Dockerfile)$/.test(f));

const problems: string[] = [];
let tags = 0;
for (const path of files) {
  const lines = (await Bun.file(`${root}${path}`).text()).split("\n");
  for (const [i, line] of lines.entries()) {
    // FROM lines only, so prose in comments doesn't count.
    const image = /^\s*FROM\s+(?:--\S+\s+)*(\S+)/i.exec(line)?.[1];
    // Any registry prefix (docker.io/, a mirror:port/); "bun" must end the name, so oven/bunny
    // isn't ours.
    const ref = image && /^(?:[\w.-]+(?::\d+)?\/)?oven\/bun(?=[:@]|$)(.*)$/i.exec(image);
    if (!ref) continue;
    tags++;
    const rest = ref[1]!;
    // A tag that isn't an exact x.y.z (latest, alpine, 1.4, ${BUN_VERSION}) fails: it can't be
    // checked against packageManager.
    const tag = rest.startsWith(":") ? rest.slice(1).split("@")[0]! : "";
    const got = /^(\d+\.\d+\.\d+)(?:-|$)/.exec(tag)?.[1];
    if (got === want) continue;
    const why = rest.startsWith("@")
      ? "digest only, no version tag to check"
      : tag
        ? `tag ${tag}`
        : "no tag (means latest)";
    problems.push(`${path}:${i + 1}: ${image}: ${why}; packageManager is bun@${want}`);
  }
}

if (tags === 0) problems.push("no oven/bun:<version> tags found in any Dockerfile");
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`ok: ${tags} oven/bun tags match packageManager bun@${want}`);
