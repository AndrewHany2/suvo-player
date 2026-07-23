#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const APP_JSON = path.join(ROOT, "app.json");
const PKG_JSON = path.join(ROOT, "package.json");

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

// Parse "X.Y.Z" into {major, minor, patch}. Throws on anything else — no
// pre-release/build metadata; this repo ships plain semver.
function parseVersion(str) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(str).trim());
  if (!m) throw new Error(`Not a valid X.Y.Z version: "${str}"`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function formatVersion({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

// Apply a semver keyword bump, resetting lower components.
function bumpVersion(current, level) {
  const v = parseVersion(current);
  switch (level) {
    case "major":
      return { major: v.major + 1, minor: 0, patch: 0 };
    case "minor":
      return { major: v.major, minor: v.minor + 1, patch: 0 };
    case "patch":
      return { major: v.major, minor: v.minor, patch: v.patch + 1 };
    default:
      throw new Error(`Unknown bump level: "${level}"`);
  }
}

// Android versionCode scheme: major*10000 + minor*100 + patch. Monotonic while
// minor and patch each stay < 100. e.g. 1.2.3 -> 10203.
function computeVersionCode({ major, minor, patch }) {
  if (minor > 99 || patch > 99) {
    throw new Error(
      `versionCode scheme needs minor<100 and patch<100 (got ${major}.${minor}.${patch})`,
    );
  }
  return major * 10000 + minor * 100 + patch;
}

// Return true when `next` is strictly greater than `current` (semver order).
function isNewer(next, current) {
  const a = parseVersion(next);
  const b = parseVersion(current);
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  return a.patch > b.patch;
}

// Resolve the CLI arg (keyword or explicit version) to a normalized "X.Y.Z".
function nextVersionFromArg(arg, current) {
  if (arg === "major" || arg === "minor" || arg === "patch") {
    return formatVersion(bumpVersion(current, arg));
  }
  return formatVersion(parseVersion(arg)); // explicit — normalize/validate
}

// Rewrite the "version" field in a package.json-style string, preserving the
// rest of the formatting (2-space indent + trailing newline).
function withVersion(jsonText, version) {
  const obj = JSON.parse(jsonText);
  obj.version = version;
  return JSON.stringify(obj, null, 2) + "\n";
}

// Rewrite expo.version and expo.android.versionCode in an app.json string.
function withAppVersion(jsonText, version, versionCode) {
  const obj = JSON.parse(jsonText);
  obj.expo.version = version;
  obj.expo.android = obj.expo.android || {};
  obj.expo.android.versionCode = versionCode;
  return JSON.stringify(obj, null, 2) + "\n";
}

// ── IO / git orchestration ───────────────────────────────────────────────────

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

function usage() {
  return [
    "Usage: npm run release <patch|minor|major|X.Y.Z> [--dry-run] [--skip-checks]",
    "",
    "  patch|minor|major   bump the current version in app.json",
    "  X.Y.Z               set an explicit version",
    "  --dry-run           print what would change; touch nothing",
    "  --skip-checks       skip the npm test + npm run lint gate",
  ].join("\n");
}

async function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const positional = argv.filter((a) => !a.startsWith("--"));
  const arg = positional[0];

  if (!arg || flags.has("--help")) {
    console.log(usage());
    process.exit(arg ? 0 : 1);
  }

  const dryRun = flags.has("--dry-run");
  const skipChecks = flags.has("--skip-checks");

  const appText = fs.readFileSync(APP_JSON, "utf8");
  const pkgText = fs.readFileSync(PKG_JSON, "utf8");
  const current = JSON.parse(appText).expo.version;

  let next;
  try {
    next = nextVersionFromArg(arg, current);
  } catch (err) {
    fail(`${err.message}\n\n${usage()}`);
  }

  const tag = `v${next}`;
  const versionCode = computeVersionCode(parseVersion(next));

  // ── Guards ──────────────────────────────────────────────────────────────
  if (!isNewer(next, current)) {
    fail(`Target version ${next} is not greater than current ${current}.`);
  }

  let status;
  try {
    status = git(["status", "--porcelain"]);
  } catch {
    fail("Not a git repository (or git is unavailable).");
  }
  if (status && !dryRun) {
    fail(
      "Working tree is not clean. Commit or stash your changes before releasing:\n\n" +
        status,
    );
  }

  const existingTags = git(["tag", "--list", tag]);
  if (existingTags) fail(`Tag ${tag} already exists.`);

  console.log(`\nRelease ${current} → ${next}`);
  console.log(`  app.json      expo.version          ${current} → ${next}`);
  console.log(`  app.json      android.versionCode → ${versionCode}`);
  console.log(`  package.json  version               ${current} → ${next}`);
  console.log(`  commit        chore(release): ${tag}`);
  console.log(`  tag           ${tag}\n`);

  if (dryRun) {
    console.log("--dry-run: no files changed, nothing committed.\n");
    return;
  }

  // ── Quality gate ──────────────────────────────────────────────────────────
  if (skipChecks) {
    console.log("⚠ Skipping npm test + npm run lint (--skip-checks).\n");
  } else {
    console.log("Running npm test …");
    execFileSync("npm", ["test"], { cwd: ROOT, stdio: "inherit" });
    console.log("Running npm run lint …");
    execFileSync("npm", ["run", "lint"], { cwd: ROOT, stdio: "inherit" });
  }

  // ── Write version files ─────────────────────────────────────────────────
  fs.writeFileSync(APP_JSON, withAppVersion(appText, next, versionCode));
  fs.writeFileSync(PKG_JSON, withVersion(pkgText, next));
  console.log(`\nUpdated app.json and package.json to ${next}.`);

  // ── Commit + tag ──────────────────────────────────────────────────────────
  git(["add", "app.json", "package.json"]);
  git(["commit", "-m", `chore(release): ${tag}`]);
  git(["tag", "-a", tag, "-m", tag]);
  console.log(`Committed and tagged ${tag}.`);

  // ── Push (guarded) ──────────────────────────────────────────────────────
  const ok = await confirm(
    `\nPush commit + ${tag} to origin? This triggers the release build. [y/N] `,
  );
  if (!ok) {
    console.log(
      `\nSkipped push. To publish later:\n  git push --follow-tags\n` +
        `To undo the local release:\n  git tag -d ${tag} && git reset --hard HEAD~1\n`,
    );
    return;
  }

  git(["push", "--follow-tags"]);
  console.log(`\n✔ Pushed ${tag}. Release workflow is building.\n`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => fail(err.message));
}

module.exports = {
  parseVersion,
  formatVersion,
  bumpVersion,
  computeVersionCode,
  isNewer,
  nextVersionFromArg,
  withVersion,
  withAppVersion,
};
