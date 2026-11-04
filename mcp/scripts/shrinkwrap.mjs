#!/usr/bin/env node
// Builds npm-shrinkwrap.json for the published package, seeded from this package's own
// package-lock.json, so a cold `npx -y @promptwheel/logbook-mcp@x.y.z` installs the SAME version of
// every dependency the test suite ran against (`npm ci` in CI installs that lock). The one
// difference is `@promptwheel/logbook`: the development lock links it to the parent directory, the
// published tree resolves it from the registry. The script refuses to produce a shrinkwrap in which
// any locked version drifted. `npm run release` runs it right before `npm publish` and removes the
// file after (`--clean`), so the development tree keeps its link and its own lock. A prepack hook
// would be too late: npm fixes the tarball's file list before prepack runs. Zero dependencies.
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
const lock = JSON.parse(readFileSync(join(pkgDir, "package-lock.json"), "utf8"));
const CORE = "@promptwheel/logbook";
const range = process.env.LOGBOOK_SHRINKWRAP_CORE;   // tests only: a core range that is already published
const deps = { ...pkg.dependencies, ...(range ? { [CORE]: range } : {}) };
// the versions the development lock pins for the runtime tree, minus the linked core
const pinned = Object.entries(lock.packages || {})
  .filter(([k, v]) => k && k !== ".." && v && !v.link && !v.dev && !v.devOptional && v.version)
  .map(([k, v]) => [k, v.version]);
if (!pinned.length) throw new Error("package-lock.json pins nothing: run npm install first");
const work = mkdtempSync(join(tmpdir(), "logbook-mcp-shrinkwrap-"));
// the nested npm must not inherit the publishing npm's lifecycle environment (npm_config_*,
// npm_package_*, INIT_CWD), which would re-aim it at this package instead of the scratch one
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k) && k !== "INIT_CWD"));
try {
  // seed the scratch tree with the development lock: every locked package keeps its version, only
  // the core (a link in the dev lock) is resolved from the registry
  const seed = { ...lock, name: pkg.name, version: pkg.version, packages: { ...lock.packages } };
  delete seed.packages[".."];
  delete seed.packages["node_modules/" + CORE];
  seed.packages[""] = { ...(lock.packages[""] || {}), name: pkg.name, version: pkg.version, dependencies: deps };
  delete seed.packages[""].devDependencies;
  writeFileSync(join(work, "package-lock.json"), JSON.stringify(seed, null, 2));
  writeFileSync(join(work, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version, dependencies: deps }, null, 2));
  execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: work, env, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("npm", ["shrinkwrap"], { cwd: work, env, stdio: ["ignore", "pipe", "pipe"] });
  const wrapped = JSON.parse(readFileSync(join(work, "npm-shrinkwrap.json"), "utf8"));
  const core = wrapped.packages?.["node_modules/" + CORE]?.version;
  if (!core) throw new Error("the shrinkwrap does not pin " + CORE);
  const drift = pinned.filter(([k, v]) => wrapped.packages?.[k]?.version !== v);
  if (drift.length) throw new Error("the shrinkwrap drifted from package-lock.json (the tested tree): " + drift.map(([k, v]) => `${k} ${v} -> ${wrapped.packages?.[k]?.version || "missing"}`).join(", "));
  copyFileSync(join(work, "npm-shrinkwrap.json"), target);
  const count = Object.keys(wrapped.packages || {}).filter((k) => k).length;
  process.stderr.write(`npm-shrinkwrap.json: ${count} packages pinned, ${pinned.length} verified against package-lock.json, core ${CORE}@${core}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
