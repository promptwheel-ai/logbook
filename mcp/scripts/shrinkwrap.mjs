#!/usr/bin/env node
// Builds npm-shrinkwrap.json for the published package from a clean registry install, so a cold
// `npx -y @promptwheel/logbook-mcp@x.y.z` resolves the exact tree that was published, transitive
// packages included. It runs as `prepack` (before `npm publish` packs) and is removed again by
// `postpack`, so the development tree keeps its link to the core in the parent directory and its
// own package-lock.json. Zero dependencies.
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, "..");
const target = join(pkgDir, "npm-shrinkwrap.json");

if (process.argv.includes("--clean")) {
  if (existsSync(target)) unlinkSync(target);
  process.exit(0);
}

const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const range = process.env.LOGBOOK_SHRINKWRAP_CORE;   // tests only: a core range that is already published
const deps = { ...pkg.dependencies, ...(range ? { "@promptwheel/logbook": range } : {}) };
const work = mkdtempSync(join(tmpdir(), "logbook-mcp-shrinkwrap-"));
// the nested npm must not inherit the publishing npm's lifecycle environment (npm_config_*,
// npm_package_*, INIT_CWD), which would re-aim it at this package instead of the scratch one
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k) && k !== "INIT_CWD"));
try {
  writeFileSync(join(work, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version, dependencies: deps }, null, 2));
  execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: work, env, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("npm", ["shrinkwrap"], { cwd: work, env, stdio: ["ignore", "pipe", "pipe"] });
  const wrapped = JSON.parse(readFileSync(join(work, "npm-shrinkwrap.json"), "utf8"));
  const core = wrapped.packages?.["node_modules/@promptwheel/logbook"]?.version;
  if (!core) throw new Error("the shrinkwrap does not pin @promptwheel/logbook");
  copyFileSync(join(work, "npm-shrinkwrap.json"), target);
  const count = Object.keys(wrapped.packages || {}).filter((k) => k).length;
  process.stderr.write(`npm-shrinkwrap.json: ${count} packages pinned, core @promptwheel/logbook@${core}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
