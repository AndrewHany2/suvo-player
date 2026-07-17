# Security documentation

Point-in-time security artifacts and the living requirements matrix for Suvo.

| Doc | Type | Purpose |
|---|---|---|
| [appsec-review.md](appsec-review.md) | Point-in-time (2026-07-17) | Application security / bounty-style review of the remotely-reachable surface. |
| [agent-config-scan.md](agent-config-scan.md) | Point-in-time (2026-07-17) | AgentShield scan of the `.claude/` agent-harness config, with the applied remediation. |
| [security-requirements.md](security-requirements.md) | Living | Security requirements as a traceability matrix (threat → control → test → acceptance). |
| [remediations-2026-07-17.md](remediations-2026-07-17.md) | Point-in-time (2026-07-17) | Fixes applied after the reseller-dashboard security review, with per-fix owner deploy steps. |

## Scope of these docs

The **product** boundary (Supabase Edge Functions, RLS, the reseller dashboard, the Electron shell, the RN client) is covered by `appsec-review.md` and `security-requirements.md`. The **developer tooling** boundary (the Claude Code agent config) is covered by `agent-config-scan.md` — it is not shipped product, but it is git-tracked and reaches teammates, so it is in scope for hygiene.

Related background lives in the prior hardening audit (see `supabase/sql/revoke_table_grants.sql` and the migration comments). The deep dual-pass red-team audit that predates these docs is summarised there.

## How to regenerate

- **AgentShield:** `npx ecc-agentshield scan --path .claude --format text`
- **App tests / lint (the requirement verification gate):** `npm test && npm run lint`
- The appsec review is a manual read of the entrypoints listed in its Scope & Methodology section.
