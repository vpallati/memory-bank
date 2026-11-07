import { createClient } from "@supabase/supabase-js";
import { createVaultApi, PAGE_SIZE } from "./vault-api.js";

const $ = (id) => document.getElementById(id);
let client;
let api;
let session;
let editingId = null;
let offset = 0;
let generation = 0;
let busy = false;

function status(message, error = false) {
  $("status").textContent = message;
  $("status").dataset.error = String(error);
}

async function action(work) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("button, input, select, textarea").forEach((el) => { el.disabled = true; });
  try {
    await work();
  } catch (error) {
    // Never echo remote error messages: constraint errors may include submitted content.
    const messages = {
      PT409: "This memory was edited elsewhere. Refresh before editing again.",
      P0002: "Memory not found. Refresh the vault.",
      "23514": "Invalid memory fields. Check the type, lengths, and confidence.",
      invalid_credentials: "Email or password is incorrect.",
      email_not_confirmed: "Confirm your email before signing in.",
      over_email_send_rate_limit: "Too many email requests. Please wait before retrying.",
    };
    status(messages[error?.code] ?? "The operation failed. Check your connection, session, and input, then retry.", true);
  } finally {
    busy = false;
    document.querySelectorAll("button, input, select, textarea").forEach((el) => { el.disabled = false; });
  }
}

function resetEditor() {
  editingId = null;
  $("memory-form").reset();
  $("editor-title").textContent = "Create memory";
  $("cancel").hidden = true;
}

function applySession(next) {
  generation++;
  session = next;
  $("auth").hidden = Boolean(next);
  $("vault").hidden = !next;
  $("account").textContent = next?.user.email ?? "";
  $("password").value = "";
  $("memories").replaceChildren();
  $("more").hidden = true;
  offset = 0;
  resetEditor();
}

function renderMemory(memory) {
  const article = document.createElement("article");
  const heading = document.createElement("h3");
  heading.textContent = `${memory.topic} / ${memory.type}${memory.superseded_by ? " (superseded)" : ""}`;
  const text = document.createElement("p");
  text.className = "memory-text";
  text.textContent = memory.text;
  const metadata = document.createElement("p");
  metadata.className = "metadata";
  metadata.textContent = `Source: ${memory.source} | Confidence: ${memory.confidence}% | Created: ${new Date(memory.created_at).toLocaleString()}`;
  const controls = document.createElement("div");
  controls.className = "actions";
  if (!memory.superseded_by) {
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      editingId = memory.id;
      for (const field of ["type", "topic", "text", "source", "confidence"]) $(field).value = memory[field];
      $("editor-title").textContent = "Create a new revision";
      $("cancel").hidden = false;
      $("text").focus();
    });
    controls.append(edit);
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Delete all revisions";
  remove.addEventListener("click", () => {
    if (!confirm("Permanently delete this memory and all its revisions? The audit retains only operation metadata.")) return;
    void action(async () => {
      const count = await api.remove(memory.id);
      resetEditor();
      await refresh();
      status(`Deleted ${count} revision(s). No memory content is retained in the audit.`);
    });
  });
  controls.append(remove);
  article.append(heading, text, metadata, controls);
  return article;
}

async function refresh(append = false) {
  const requestGeneration = generation;
  if (!append) offset = 0;
  const rows = await api.list({ history: $("history").checked, offset });
  if (!session || generation !== requestGeneration) return;
  if (!append) $("memories").replaceChildren();
  rows.forEach((row) => $("memories").append(renderMemory(row)));
  offset += rows.length;
  $("more").hidden = rows.length < PAGE_SIZE;
  if (offset === 0) $("memories").textContent = "No memories found.";
}

function wireEvents() {
  $("auth-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void action(async () => {
      const { data, error } = await client.auth.signInWithPassword({
        email: $("email").value, password: $("password").value,
      });
      if (error) throw error;
      applySession(data.session);
      await refresh();
      status("Signed in. Only your vault is visible.");
    });
  });
  $("signup").addEventListener("click", () => {
    if (!$("auth-form").reportValidity()) return;
    void action(async () => {
      const { data, error } = await client.auth.signUp({
        email: $("email").value, password: $("password").value,
      });
      if (error) throw error;
      applySession(data.session);
      if (data.session) await refresh();
      status(data.session ? "Account created. Your vault is empty." : "Check your email to confirm the account, then sign in.");
    });
  });
  $("signout").addEventListener("click", () => void action(async () => {
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw error;
    applySession(null);
    status("Signed out. Vault data has been cleared from this page.");
  }));
  $("memory-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void action(async () => {
      const values = Object.fromEntries(["type", "topic", "text", "source", "confidence"].map((field) => [field, $(field).value]));
      if (editingId) await api.revise(editingId, values);
      else await api.create(values);
      resetEditor();
      await refresh();
      status("Memory saved with provenance and confidence.");
    });
  });
  $("cancel").addEventListener("click", resetEditor);
  $("refresh").addEventListener("click", () => void action(async () => { await refresh(); status("Vault refreshed."); }));
  $("history").addEventListener("change", () => void action(() => refresh()));
  $("more").addEventListener("click", () => void action(() => refresh(true)));
  $("export").addEventListener("click", () => void action(async () => {
    const requestGeneration = generation;
    const data = await api.export();
    if (!session || generation !== requestGeneration) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "memory-bank-export.json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status("Full vault exported, including revision history. No grant tokens or connector credentials included.");
  }));
}

async function start() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    status("Missing Supabase configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the app. V1 demo remains available.", true);
    return;
  }
  client = createClient(url, key, {
    // Auth credentials stay in memory, never localStorage or the V1 demo state.
    auth: { persistSession: false, detectSessionInUrl: false },
  });
  api = createVaultApi(client);
  wireEvents();
  client.auth.onAuthStateChange((event, next) => {
    if (event === "SIGNED_OUT") {
      applySession(null);
      status("Signed out. Sign in again to access your vault.");
    } else if (event === "TOKEN_REFRESHED") {
      session = next;
    }
  });
  applySession(null);
  status("Sign in to your vault. Sessions are held in memory; reloading requires sign-in.");
}

void action(start);
