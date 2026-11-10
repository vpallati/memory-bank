import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const operation = process.argv[2];
const commands = {
  start: ["start"],
  stop: ["stop"],
  reset: ["db", "reset", "--local"],
  test: ["test", "db"],
};
if (!Object.hasOwn(commands, operation)) throw new Error("Unknown local database operation.");
const bin = fileURLToPath(new URL(
  process.platform === "win32" ? "../node_modules/supabase/bin/supabase.exe" : "../node_modules/supabase/bin/supabase",
  import.meta.url,
));
const result = spawnSync(bin, commands[operation], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
function redact(output = "") {
  return output
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[REDACTED DATABASE URL]")
    .replace(/^.*(?:secret|password|api key|anon key|service.role|publishable|access.key).*/gim, "[REDACTED CREDENTIAL LINE]");
}
if (result.error) {
  throw new Error(`Could not run Supabase CLI (${result.error.code}). Run npm ci and ensure Docker is available.`);
}
if (result.status !== 0 || operation === "test") {
  process.stdout.write(redact(result.stdout));
  process.stderr.write(redact(result.stderr));
}
if (result.status !== 0) {
  throw new Error(`Local Supabase ${operation} failed with exit code ${result.status}.`);
}
console.log(`Local Supabase ${operation} completed. Credential output suppressed.`);
