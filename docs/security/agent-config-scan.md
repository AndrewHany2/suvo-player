# Agent-Config Security Scan (AgentShield) — `.claude/`

**Date:** 2026-07-17 · **Scanner:** `npx ecc-agentshield scan --path .claude --format text`

This covers the **Claude Code agent-harness config**, not shipped product. It matters because `.claude/settings.local.json` is **git-tracked** in this repo (see the gitignore-inversion note), so its grants reach every teammate.

## Baseline (before remediation)

**Grade B (80/100).** Secrets / Hooks / MCP / Agents = 100. **Permissions = 0.**

`Permissions = 0` is a category *floor*, not a linear score: AgentShield zeroes it when it finds broad interpreter/eval grants **and** env-file access **and** no deny list **and** no PreToolUse hook simultaneously. Any one high-risk pattern with no compensating control drops it to 0.

12 findings, all in `.claude/settings.local.json` (confidence: *project-local optional*):

- 8× broad interpreter grants — `Bash(node -e "…")`, `Bash(node --input-type=module …)`, and a bare `Bash(node --input-type=module)`.
- 2× `Bash(ls …/.env*)` env-file grants.
- No deny list; no PreToolUse security hook.

## Why this is more than "local only"

The bare `Bash(node --input-type=module)` grant auto-approves execution of **any** module piped to it, and `npm install *` auto-approves arbitrary postinstall scripts. This app ingests untrusted remote content (M3U playlists, EPG XML, xtream-codes API responses). If the agent reads such content and it carries an injected instruction, those grants form an injection → **auto-approved code-execution** chain with no human prompt. Priority for the bare interpreter grant: **medium** until removed (now removed — see below).

## Remediation applied (2026-07-17)

`.claude/settings.local.json` rewritten. **Allow list pruned 50 → 8**; **11-rule deny block added.**

### Removed (dead or dangerous)

- The bare `Bash(node --input-type=module)` (the interpreter-RCE grant).
- 6 Tamagui probes (Tamagui was removed from the repo).
- The completed `git mv` electron-migration entries (~21) and `git add react-native/.gitkeep`.
- Obsolete pins subsumed/outdated: `npm install expo@~52.0.0`, `npm install react@18.3.1 …`, `npm install @supabase/supabase-js`, `npx expo install --fix/--check` (covered by `npx expo *`).
- Windows-path / dead entries that can't match on this machine: `ls d:/…`, `cat "C:\\…"`, `Read(//c/Users/…)`, a `powershell …` probe, a stale `…claudeusercontent.com` WebFetch, and a one-off `grep` line.

### Final `allow` (8, load-bearing)

```json
"allow": [
  "Bash(npm run *)",
  "Bash(npm test *)",
  "Bash(npm install *)",
  "Bash(npx expo *)",
  "Bash(npx kill-port *)",
  "Bash(node --test 'src/**/__tests__/*.test.js')",
  "Bash(node scripts/create-icons.js)",
  "WebFetch(domain:api.anthropic.com)"
]
```

### Final `deny` (11 — deny wins over allow, so it caps the wildcards above)

```json
"deny": [
  "Read(**/.env)",
  "Read(**/.env.local)",
  "Read(**/.env.*.local)",
  "Bash(rm -rf *)",
  "Bash(git push --force*)",
  "Bash(git push -f *)",
  "Bash(git reset --hard*)",
  "Bash(git clean -f*)",
  "Bash(curl *| sh*)",
  "Bash(curl *| bash*)",
  "Bash(wget *| sh*)"
]
```

Two deliberate choices vs. a naive deny list:

1. **Env deny is scoped to the real secret files** (`.env`, `.env.local`, `.env*.local` — matching `.gitignore`), **not** `.env.*`, so it does not block the safe committed `.env.example`.
2. **`WebFetch` is *not* in the deny list.** A blanket `WebFetch` deny wins over the specific `WebFetch(domain:api.anthropic.com)` allow and would break it. Non-allowed WebFetch already prompts by default, which is the desired posture.

## Gitignore inversion (structural note)

Convention is `settings.json` = shared/committed, `settings.local.json` = personal/gitignored. This repo is inverted: `.gitignore` ignores `.claude` (so a new `.claude/settings.json` would be ignored) while `.claude/settings.local.json` is force-tracked. Consequence: the deny block above **does** protect the whole team as-is (good) — but any future team baseline (deny + hooks) must land in the tracked `settings.local.json`, or the `.gitignore` should be flipped to track `settings.json` and ignore `settings.local.json`. Not changed here to avoid a surprise convention shift.

## Realistic score target

Aim for **~75–90**, not 100. The `npm install *`, `npx expo *`, and `npm run *` wildcards are load-bearing for the test/build/lint workflow and will always carry a residual deduction — that is accepted risk, documented by the deny list, not a bug to chase.

## Optional add-on: PreToolUse guard hook (NOT installed)

A `PreToolUse` hook is the one item that lifts the Permissions category above a pure-allowlist score, by catching *dynamically-assembled* commands the static matcher misses. It is **not installed** because it is a session- and team-wide command interceptor (committed to the tracked file, runs on every Bash call, requires `python3`) — an outward-facing change that should be opt-in. Sketch, if adopted:

`.claude/hooks/guard.sh` (exit 2 = block):

```bash
#!/usr/bin/env bash
read -r input
cmd=$(printf '%s' "$input" | /usr/bin/python3 -c 'import sys,json;print(json.load(sys.stdin).get("tool_input",{}).get("command",""))')
deny_re='(node|deno|bun)[[:space:]]+(-e|--eval|--input-type=module)|curl[[:space:]].*\|[[:space:]]*(sh|bash)|rm[[:space:]]+-rf[[:space:]]+/|(^|[[:space:]])(cat|less|head)[[:space:]].*\.env|git[[:space:]]+push[[:space:]]+(-f|--force)'
if printf '%s' "$cmd" | grep -Eq "$deny_re"; then
  echo "Blocked by guard.sh: matched dangerous pattern" >&2; exit 2
fi
exit 0
```

Registration (in the tracked settings file), then `chmod +x .claude/hooks/guard.sh`:

```json
"hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "bash .claude/hooks/guard.sh" } ] } ] }
```

## CI gate (recommended, not yet wired)

Format-per-consumer: **json** for the pass/fail gate (jq-parseable), **markdown** as a PR-review artifact, **text** for local runs.

```yaml
name: agentshield
on: [pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Scan and gate on JSON score
        run: |
          npx ecc-agentshield scan --path .claude --format json --out scan.json
          total=$(jq '.score' scan.json)
          perms=$(jq '.categories.permissions.score' scan.json)
          echo "total=$total permissions=$perms"
          test "$total" -ge 80 && test "$perms" -ge 60   # ratchet up after cleanup
      - if: always()
        run: npx ecc-agentshield scan --path .claude --format markdown --out scan.md
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: agentshield-report, path: scan.md }
```

Confirm the exact `jq` paths against the pinned AgentShield version before relying on the gate.
