import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Capture CLI status in memory: it contains local test credentials, never print it.
const bin = fileURLToPath(new URL(
  process.platform === "win32" ? "../node_modules/supabase/bin/supabase.exe" : "../node_modules/supabase/bin/supabase",
  import.meta.url,
));
const result = spawnSync(bin, ["status", "--output", "json"], { encoding: "utf8" });
if (result.error || result.status !== 0) {
  throw new Error("Local Supabase is unavailable. Run npm run db:start first. CLI status output suppressed.");
}
let config;
try {
  config = JSON.parse(result.stdout);
} catch {
  throw new Error("Local Supabase returned invalid status JSON; output suppressed.");
}
if (!config.API_URL || !config.ANON_KEY || !config.SERVICE_ROLE_KEY) {
  throw new Error("Local Supabase status is missing required settings; output suppressed.");
}
const url = new URL(config.API_URL);
if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
  throw new Error("This runner only accepts localhost Supabase; it must never run fixtures against a hosted vault.");
}

const mode = process.argv[2];
const env = { ...process.env };
let child;
if (mode === "test") {
  Object.assign(env, {
    SUPABASE_URL: config.API_URL, SUPABASE_ANON_KEY: config.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: config.SERVICE_ROLE_KEY,
  });
  child = spawnSync(process.execPath, ["--test", "tests/integration/vault.test.js"], { env, stdio: "inherit" });
} else if (mode === "dev" || mode === "build") {
  // Pass only the anonymous API key to Vite. Never expose the service-role key.
  Object.assign(env, { VITE_SUPABASE_URL: config.API_URL, VITE_SUPABASE_ANON_KEY: config.ANON_KEY });
  const args = mode === "build" ? ["build"] : ["--host", "127.0.0.1"];
  child = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", ...args], { env, stdio: "inherit" });
} else {
  throw new Error("Expected mode: test, dev, or build.");
}
if (child.error) throw new Error("Could not launch the local runner.");
process.exitCode = child.status ?? 1;
