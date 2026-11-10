import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createVaultApi } from "../../src/vault-api.js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  throw new Error("Missing test environment. Use npm run test:local with local Supabase running.");
}
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error("Integration fixtures are localhost-only, never run against real user data.");
}
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(url, serviceKey, options);
const owner = createClient(url, anonKey, options);
const stranger = createClient(url, anonKey, options);
const anonymous = createClient(url, anonKey, options);
const ownerApi = createVaultApi(owner);
const strangerApi = createVaultApi(stranger);
const users = [];
const sample = {
  type: "fact", topic: "Work", text: "Alex's fictional integration fixture",
  source: "Synthetic fixture only", confidence: 93,
};

function success(result, operation) {
  assert.equal(result.error?.code ?? null, null, `${operation} failed (details suppressed)`);
  return result.data;
}

before(async () => {
  for (const client of [owner, stranger]) {
    const email = `m1-${randomUUID()}@example.test`;
    const password = `${randomUUID()}-Test!`;
    const signup = success(await client.auth.signUp({ email, password }), "Auth signup");
    assert.ok(signup.user?.id, "Signup must create a user");
    users.push(signup.user.id);
    assert.ok(signup.session, "Local test Auth must have email confirmation disabled");
    success(await client.auth.signOut(), "Auth signout");
    const login = success(await client.auth.signInWithPassword({ email, password }), "Auth sign-in");
    assert.ok(login.session, "Sign-in must return a session");
  }
});

after(async () => {
  for (const client of [owner, stranger]) success(await client.auth.signOut(), "Final signout");
  for (const id of users) success(await admin.auth.admin.deleteUser(id), "Synthetic account cleanup");
});

test("real Auth + RLS isolate CRUD, revisions, deletion audit and full export", async () => {
  const original = await ownerApi.create(sample);
  assert.equal(original.source, sample.source);
  assert.equal(original.confidence, 93);
  assert.equal(original.user_id, users[0]);
  assert.equal((await ownerApi.list()).length, 1);
  assert.deepEqual(await strangerApi.list({ history: true }), []);
  const guessed = success(await stranger.from("memories").select("*").eq("id", original.id), "Cross-owner ID query");
  assert.deepEqual(guessed, []);
  await assert.rejects(strangerApi.revise(original.id, sample), (error) => error.code === "P0002");
  await assert.rejects(strangerApi.remove(original.id), (error) => error.code === "P0002");
  const directInsert = await owner.from("memories").insert({
    user_id: users[1], type: sample.type, topic: sample.topic, text: sample.text, source: sample.source, confidence: 93,
  });
  assert.equal(directInsert.error?.code, "42501");
  assert.equal((await owner.from("memories").update({ text: "bypass" }).eq("id", original.id)).error?.code, "42501");
  assert.equal((await owner.from("memories").delete().eq("id", original.id)).error?.code, "42501");

  const revised = await ownerApi.revise(original.id, { ...sample, text: "Alex's corrected fictional fixture", confidence: 99 });
  assert.notEqual(revised.id, original.id);
  const history = await ownerApi.list({ history: true });
  assert.equal(history.length, 2);
  assert.equal(history.find((row) => row.id === original.id).text, sample.text);
  assert.equal(history.find((row) => row.id === original.id).superseded_by, revised.id);
  assert.deepEqual((await ownerApi.list()).map((row) => row.id), [revised.id]);
  await assert.rejects(ownerApi.revise(original.id, sample), (error) => error.code === "PT409");
  const exported = await ownerApi.export();
  assert.deepEqual(Object.keys(exported).sort(), ["app", "audit", "exported_at", "grants", "memories", "note", "version"]);
  assert.equal(exported.app, "memory-bank");
  assert.equal(exported.version, "v1");
  assert.equal(exported.memories.length, 2);
  for (const row of exported.memories) {
    for (const field of ["id", "topic", "type", "text", "source", "when", "conf"]) assert.ok(field in row);
    assert.equal(row.type, "Fact");
    assert.ok(!("user_id" in row));
  }
  assert.deepEqual((await strangerApi.export()).memories, []);
  assert.deepEqual((await strangerApi.export()).audit, []);
  assert.equal((await anonymous.from("memories").select("*")).error?.code, "42501");
  assert.ok((await anonymous.rpc("export_vault")).error);
  assert.ok((await anonymous.rpc("create_memory", {
    p_type: "fact", p_topic: "Work", p_text: "anonymous", p_source: "fixture", p_confidence: 80,
  })).error);
  for (const table of ["grants", "audit_log", "connector_state"]) {
    assert.ok((await anonymous.from(table).select("*")).error, `${table} must reject anonymous access`);
  }
  assert.equal((await owner.from("connector_state").select("*")).error?.code, "42501");
  assert.equal((await owner.from("grants").select("token_hash")).error?.code, "42501");
  assert.equal((await owner.from("audit_log").update({ query: "tampered" }).eq("user_id", users[0])).error?.code, "42501");
  assert.equal((await owner.from("audit_log").delete().eq("user_id", users[0])).error?.code, "42501");
  assert.equal((await owner.from("audit_log").insert({
    user_id: users[0], agent: "owner", query: "forged", result_count: 0, outcome: "allowed",
  })).error?.code, "42501");

  assert.equal(await ownerApi.remove(original.id), 2);
  assert.deepEqual(await ownerApi.list({ history: true }), []);
  const audit = success(await owner.from("audit_log").select("*"), "Owner audit");
  assert.equal(audit.length, 3);
  assert.equal(audit.find((row) => row.query === "memory.delete").result_count, 2);
  for (const row of audit) {
    assert.equal(row.agent, "owner");
    assert.equal(row.outcome, "allowed");
    assert.ok(!JSON.stringify(row).includes("fictional"));
    assert.ok(!JSON.stringify(row).includes(sample.source));
  }
  assert.deepEqual((await ownerApi.export()).memories, []);
  await assert.rejects(ownerApi.remove(original.id), (error) => error.code === "P0002");
});

test("concurrent revisions cannot silently overwrite history", async () => {
  const original = await ownerApi.create(sample);
  const results = await Promise.allSettled([
    ownerApi.revise(original.id, { ...sample, text: "Revision A" }),
    ownerApi.revise(original.id, { ...sample, text: "Revision B" }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "PT409");
  assert.equal(await ownerApi.remove(original.id), 2);
});

test("deleting a middle revision removes ancestors and descendants", async () => {
  const first = await ownerApi.create(sample);
  const middle = await ownerApi.revise(first.id, { ...sample, text: "Synthetic middle revision" });
  await ownerApi.revise(middle.id, { ...sample, text: "Synthetic newest revision" });
  assert.equal(await ownerApi.remove(middle.id), 3);
  assert.deepEqual(await ownerApi.list({ history: true }), []);
});

test("concurrent delete and revision cannot resurrect deleted content", async () => {
  const first = await ownerApi.create(sample);
  const results = await Promise.allSettled([
    ownerApi.revise(first.id, { ...sample, text: "Synthetic racing revision" }),
    ownerApi.remove(first.id),
  ]);
  assert.equal(results[1].status, "fulfilled");
  if (results[0].status === "rejected") assert.equal(results[0].reason.code, "P0002");
  assert.deepEqual(await ownerApi.list({ history: true }), []);
});

test("export includes more than the API row limit and never includes token keys", async () => {
  // PostgreSQL/RLS, not mocks. This also verifies paginated owner reads.
  for (let start = 0; start < 1001; start += 25) {
    await Promise.all(Array.from({ length: Math.min(25, 1001 - start) }, (_, index) =>
      ownerApi.create({ ...sample, text: `Synthetic export fixture ${start + index}` })));
  }
  assert.equal((await ownerApi.list()).length, 50);
  assert.equal((await ownerApi.list({ offset: 1000 })).length, 1);
  const exported = await ownerApi.export();
  assert.equal(exported.memories.length, 1001);
  assert.ok(exported.audit.length > 1000);
  function checkKeys(value) {
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!/token|secret|password/i.test(key), `Unexpected secret field: ${key}`);
      checkKeys(child);
    }
  }
  checkKeys(exported);
  assert.equal((await strangerApi.export()).memories.length, 0);
});
