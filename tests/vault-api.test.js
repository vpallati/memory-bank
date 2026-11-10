import test from "node:test";
import assert from "node:assert/strict";
import { createVaultApi, memoryInput, PAGE_SIZE, MEMORY_FIELDS } from "../src/vault-api.js";

const sample = { type: "fact", topic: "Work", text: "Fictional test memory", source: "Manual test", confidence: 90 };

test("validates and maps provenance and confidence, including boundaries", () => {
  assert.deepEqual(memoryInput(sample), {
    p_type: "fact", p_topic: "Work", p_text: sample.text, p_source: "Manual test", p_confidence: 90,
  });
  for (const confidence of [0, 100, "0", "100"]) {
    assert.equal(memoryInput({ ...sample, confidence }).p_confidence, Number(confidence));
  }
  for (const change of [
    { type: "unknown" }, { topic: " " }, { text: "" }, { source: " " },
    { confidence: "" }, { confidence: null }, { confidence: false },
    { confidence: -1 }, { confidence: 101 }, { confidence: 2.5 },
    { confidence: "NaN" }, { topic: "x".repeat(101) }, { text: "x".repeat(20001) },
    { source: "x".repeat(2001) },
  ]) assert.throws(() => memoryInput({ ...sample, ...change }));
});

test("writes only through audited RPCs and never accepts user_id", async () => {
  const calls = [];
  const api = createVaultApi({
    async rpc(name, args) { calls.push({ name, args }); return { data: "ok", error: null }; },
  });
  await api.create({ ...sample, user_id: "another-user" });
  await api.revise("memory-id", sample);
  await api.remove("memory-id");
  await api.export();
  assert.deepEqual(calls, [
    { name: "create_memory", args: memoryInput(sample) },
    { name: "revise_memory", args: { p_id: "memory-id", ...memoryInput(sample) } },
    { name: "delete_memory", args: { p_id: "memory-id" } },
    { name: "export_vault", args: undefined },
  ]);
});

test("lists paginated current memories by default and includes history only on request", async () => {
  const calls = [];
  const query = {
    select(fields) { calls.push(["select", fields]); return this; },
    order(field, options) { calls.push(["order", field, options]); return this; },
    range(start, end) { calls.push(["range", start, end]); return this; },
    is(field, value) { calls.push(["is", field, value]); return this; },
    then(resolve) { resolve({ data: [], error: null }); },
  };
  const api = createVaultApi({ from(table) { calls.push(["from", table]); return query; } });
  assert.deepEqual(await api.list(), []);
  assert.deepEqual(calls, [
    ["from", "memories"], ["select", MEMORY_FIELDS],
    ["order", "created_at", { ascending: false }], ["order", "id", { ascending: false }],
    ["range", 0, PAGE_SIZE - 1], ["is", "superseded_by", null],
  ]);
  calls.length = 0;
  await api.list({ history: true, offset: PAGE_SIZE });
  assert.ok(!calls.some(([name]) => name === "is"));
  assert.deepEqual(calls.at(-1), ["range", PAGE_SIZE, 2 * PAGE_SIZE - 1]);
});

test("backend failures are propagated, never returned as success", async () => {
  const error = new Error("test failure");
  const api = createVaultApi({ async rpc() { return { data: null, error }; } });
  await assert.rejects(api.create(sample), error);
  await assert.rejects(api.revise("id", sample), error);
  await assert.rejects(api.remove("id"), error);
  await assert.rejects(api.export(), error);
});
