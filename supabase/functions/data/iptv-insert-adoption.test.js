import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Read the handler source relative to this test (CWD-independent). We assert on
// the source text rather than executing it: index.ts is a Deno module with
// Deno-only imports, so node:test cannot run it — a content guardrail locks the
// wiring instead.
const SRC_URL = new URL("./index.ts", import.meta.url);

function source() {
  return readFileSync(fileURLToPath(SRC_URL), "utf8");
}

// Isolate the `case "iptv.insert":` block, up to the next case label, so the
// assertions can't be satisfied by an adoption call placed in some other case.
function iptvInsertCase(src) {
  const from = src.indexOf('case "iptv.insert"');
  const end = src.indexOf('case "iptv.update"', from);
  return from === -1 ? "" : src.slice(from, end === -1 ? undefined : end);
}

describe("data/iptv.insert adopts self-signup customers", () => {
  test("iptv.insert case exists and still inserts the line first", () => {
    const block = iptvInsertCase(source());
    assert.ok(block, 'must have a case "iptv.insert" block');
    // The handler binds `const db = admin.from.bind(admin)` (index.ts), so the
    // line insert reads `db("iptv_accounts")`, not a literal `.from(...)`.
    assert.ok(block.includes('db("iptv_accounts")'), "must still insert the line");
    assert.ok(block.includes(".insert("), "line insert must remain");
  });

  test("invokes adopt_self_signup_account via rpc, after the line insert", () => {
    const block = iptvInsertCase(source());
    assert.ok(
      block.includes("adopt_self_signup_account"),
      "must call the adoption function",
    );
    assert.match(block, /\.rpc\(\s*["']adopt_self_signup_account["']/, "must call it via .rpc()");
    assert.ok(block.includes("p_user_id"), "must pass p_user_id");
    // Adoption runs AFTER the line is saved.
    assert.ok(
      block.indexOf(".insert(") < block.indexOf("adopt_self_signup_account"),
      "adoption must come after the line insert",
    );
  });

  test("adoption is best-effort (non-fatal): its error is handled, not thrown", () => {
    const block = iptvInsertCase(source());
    // The rpc error is captured and logged, never rethrown, so a failed adoption
    // does not fail the line insert.
    assert.match(block, /adopterr|adopt_?error/i, "must capture the rpc error into a variable");
    assert.ok(block.includes("console.error"), "must log the non-fatal failure");
    assert.ok(!/throw\b/.test(block), "must not throw on adoption failure");
  });
});
