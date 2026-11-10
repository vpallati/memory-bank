// Hosted M1 smoke test against a real Supabase project, using one existing synthetic test account.
// Reads settings from env only; prints PASS/FAIL and error codes, never keys, tokens, or passwords.
// Leaves only content-free audit rows (memory.create / memory.revise / memory.delete) behind.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createVaultApi } from "../src/vault-api.js";

const {
  HOSTED_SUPABASE_URL: url, HOSTED_SUPABASE_ANON_KEY: key,
  HOSTED_TEST_EMAIL: email, HOSTED_TEST_PASSWORD: password,
} = process.env;
if (!url || !key || !email || !password) {
  throw new Error("Set HOSTED_SUPABASE_URL, HOSTED_SUPABASE_ANON_KEY, HOSTED_TEST_EMAIL, HOSTED_TEST_PASSWORD.");
}
if (new URL(url).protocol !== "https:") throw new Error("Hosted smoke test requires an HTTPS project URL.");

const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const anon = createClient(url, key, opts);
const owner = createClient(url, key, opts);
const api = createVaultApi(owner);
const marker = `M1 hosted smoke fixture ${randomUUID()}`;
const sample = { type: "fact", topic: "Work", text: marker, source: "Synthetic hosted smoke test", confidence: 87 };
let failures = 0;
let originalId = null;

function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
const code = (r) => r?.error?.code ?? "none";
async function rejectsWith(promise, expected) {
  try { await promise; return "no error"; } catch (e) { return e?.code === expected ? true : `code ${e?.code}`; }
}
function hasSecretKey(value) {
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([k, v]) => /token|secret|password/i.test(k) || hasSecretKey(v));
}

try {
  // Anonymous access must be denied.
  check("anon cannot read memories", code(await anon.from("memories").select("id")) === "42501");
  check("anon cannot export", code(await anon.rpc("export_vault")) === "42501");
  for (const t of ["grants", "audit_log", "connector_state"]) {
    check(`anon cannot read ${t}`, code(await anon.from(t).select("*")) === "42501");
  }

  // Auth: sign in, sign out, sign in again.
  let r = await owner.auth.signInWithPassword({ email, password });
  check("hosted Auth sign-in", !r.error && !!r.data.session, `${code(r)} ${r.error?.name ?? ""} ${r.error?.status ?? ""}`.trim());
  if (r.error) throw new Error("Cannot continue without sign-in");
  const userId = r.data.user.id;
  check("sign-out", !(await owner.auth.signOut({ scope: "local" })).error);
  r = await owner.auth.signInWithPassword({ email, password });
  check("sign-in again", !r.error && !!r.data.session, code(r));

  const before = (await api.list({ history: true })).length;

  // Create + read.
  const created = await api.create(sample);
  originalId = created.id;
  check("create memory with provenance + confidence",
    created.source === sample.source && created.confidence === 87 && created.user_id === userId);
  check("read back created memory", (await api.list()).some((m) => m.id === created.id));

  // Direct table writes bypassing audited RPCs are denied.
  check("direct insert denied", code(await owner.from("memories").insert({ ...sample, user_id: userId })) === "42501");
  check("direct update denied", code(await owner.from("memories").update({ text: "x" }).eq("id", created.id)) === "42501");
  check("direct delete denied", code(await owner.from("memories").delete().eq("id", created.id)) === "42501");

  // Update = new revision; history kept.
  const revised = await api.revise(created.id, { ...sample, text: `${marker} (revised)`, confidence: 95 });
  const history = await api.list({ history: true });
  const old = history.find((m) => m.id === created.id);
  check("revision creates new row", revised.id !== created.id && revised.confidence === 95);
  check("original kept, linked via superseded_by", old?.text === marker && old?.superseded_by === revised.id);
  check("current view shows only latest revision",
    (await api.list()).some((m) => m.id === revised.id) && !(await api.list()).some((m) => m.id === created.id));
  check("stale edit rejected (409), no silent overwrite", (await rejectsWith(api.revise(created.id, sample), "PT409")) === true);

  // Export.
  const exp = await api.export();
  const keys = Object.keys(exp).sort().join(",");
  check("export envelope matches V1 shape", keys === "app,audit,exported_at,grants,memories,note,version" &&
    exp.app === "memory-bank" && exp.version === "v1", keys);
  const mine = exp.memories.filter((m) => [created.id, revised.id].includes(m.id));
  check("export includes both revisions with V1 memory fields", mine.length === 2 &&
    mine.every((m) => ["id", "topic", "type", "text", "source", "when", "conf"].every((f) => f in m) && m.type === "Fact"));
  check("export has no user_id", exp.memories.every((m) => !("user_id" in m)));
  check("export has no token/secret/password fields", !hasSecretKey(exp));

  // Owner cannot see server-only data or tamper with audit.
  check("owner cannot read connector_state", code(await owner.from("connector_state").select("*")) === "42501");
  check("owner cannot read grant token hashes", code(await owner.from("grants").select("token_hash")) === "42501");
  check("audit insert denied", code(await owner.from("audit_log").insert({
    user_id: userId, agent: "owner", query: "forged", result_count: 0, outcome: "allowed" })) === "42501");
  check("audit update denied", code(await owner.from("audit_log").update({ query: "x" }).eq("user_id", userId)) === "42501");
  check("audit delete denied", code(await owner.from("audit_log").delete().eq("user_id", userId)) === "42501");
  const foreign = await owner.from("memories").select("id").neq("user_id", userId);
  check("RLS: no other user's memories visible", !foreign.error && foreign.data.length === 0);
  const foreignAudit = await owner.from("audit_log").select("id").neq("user_id", userId);
  check("RLS: no other user's audit visible", !foreignAudit.error && foreignAudit.data.length === 0);

  // Delete removes the whole revision chain; audit keeps metadata only.
  const removed = await api.remove(created.id);
  originalId = null;
  check("delete removes both revisions", removed === 2);
  check("memory gone from vault", !(await api.list({ history: true })).some((m) => m.text.startsWith(marker)));
  check("vault back to prior size (pre-existing data untouched)", (await api.list({ history: true })).length === before);
  const exp2 = await api.export();
  check("deleted memory gone from export", !exp2.memories.some((m) => m.text.startsWith(marker)));
  const audit = (await owner.from("audit_log").select("*").order("created_at", { ascending: false }).limit(20)).data ?? [];
  const del = audit.find((a) => a.query === "memory.delete");
  check("audit records delete who/when/how many", del?.agent === "owner" && del?.result_count === 2 && !!del?.created_at);
  check("audit holds no deleted content", !JSON.stringify(audit).includes(marker) && !JSON.stringify(audit).includes(sample.source));
} catch (e) {
  failures++;
  console.log(`FAIL  unexpected error (code ${e?.code ?? "n/a"})`);
} finally {
  if (originalId) {
    try { await api.remove(originalId); console.log("cleanup: removed fixture"); }
    catch { console.log("cleanup: FAILED to remove fixture; delete it from the vault UI"); failures++; }
  }
  await owner.auth.signOut({ scope: "local" });
  console.log(failures ? `\n${failures} check(s) failed` : "\nALL HOSTED CHECKS PASSED");
  process.exitCode = failures ? 1 : 0;
}
