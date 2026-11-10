# M1: owner vault on Supabase

Scope: [#3](https://github.com/vpallati/memory-bank/issues/3) only.
Hosting: [Vishnu chose Supabase free tier](https://github.com/vpallati/memory-bank/issues/3#issuecomment-6702030748).
No paid plan, billing, connectors, grant issuance, agent retrieval, or shared vaults.

## Local setup

Prerequisites: Node.js 22.12+ and Docker with Linux containers. The initial Supabase start downloads
container images. Use an isolated development machine, not a machine exposing Docker ports publicly.

```powershell
npm ci
npm run db:start
npm run dev:local
```

Open `http://127.0.0.1:5173/vault.html`. Local Auth has email confirmation disabled for fictional fixtures.
`dev:local` obtains the local anonymous API key in memory and passes it to Vite without printing it.
It never sends a service-role key to the browser. The database wrappers suppress credential-bearing CLI output.
No environment file is required for local development.

The CLI is pinned to a Windows-compatible release. Its installer uses the public `github.com/supabase/cli`
release assets. The `tar` override patches the installer's extraction dependency. If a managed network blocks
downloads, fix the trusted CA/proxy configuration; do not disable TLS verification.

The root `index.html` is still the self-contained fictional Alex V1 demo: open it directly without any
install, backend, or configuration. Its grants, audit, export and localStorage behavior are unchanged.
Nothing automatically copies demo data to a real vault.

## Exact acceptance walkthrough

1. On the local owner page, create a synthetic account such as `alex@example.test`, with a test-only password
   of at least 12 characters. Expect an empty vault. Sign out and sign back in to verify Auth.
2. Create a `fact` in topic `Work`, with text `Fictional Alex prefers short updates`,
   source `Manual fictional fixture`, confidence `93`. Expect the memory with its provenance and confidence.
3. Edit its text and save. Expect one current row. Enable **Include revision history**: expect two rows,
   with the original content preserved and marked superseded. An edit from a stale browser view must fail
   and ask you to refresh, not overwrite the latest revision.
4. Export. Expect a JSON file with `app`, `version`, `exported_at`, `note`, `memories`, `grants`, `audit`.
   Both revisions must be present. No `token`, `token_hash`, OAuth secret, or connector state is exported.
5. Sign out and create a second fictional account. Expect an empty vault and empty export. Guessing the first
   account's row ID through the REST API must not expose it; the automated tests exercise this directly.
6. Sign back in as the first account and **Delete all revisions**. Expect both rows removed, including from
   export. The owner audit keeps `memory.delete`, agent `owner`, timestamp and deleted revision count,
   with no memory text or source. Canceling the confirmation must leave the memory unchanged.
7. Open the V1 demo separately. Its original fictional memories and token-free export must still work.

## Automated verification

```powershell
npm test
npm run build
npm run build:local
npm run db:test
npm run test:local
```

- Unit tests: validation boundaries, provenance, correct RPC shapes, paginated reads, failure propagation.
- Builds cover both the explicit missing-configuration page and the configured owner bundle.
- SQL/pgTAP tests: all-table RLS, owner grant isolation, encrypted secret storage and denied secret access,
  token-hash constraints, database validation, immutable owner audit, and anonymous rejection.
- HTTP integration tests use actual local Supabase Auth + PostgREST + Postgres, not mocks:
  signup/sign-in/sign-out; two-user isolation including guessed IDs; create/read/revise/delete;
  concurrent edit conflict; content-free audit; export of **1,001 memories** (above the REST row cap).
  They create random fictional accounts and delete exactly those accounts in teardown.
  The runner refuses non-localhost URLs and fails rather than skips when the backend is unavailable.
- Public GitHub Actions runs the same checks with a local Docker stack; it requires no repository secrets.

After changing migrations on a disposable local stack only, run `npm run db:reset`, then rerun the tests.
Reset deletes **all local development data** for this Supabase project. Do not run it against a real vault.
Stop this project's containers with `npm run db:stop` when finished.

## Deploy to the decided free-tier project

1. Vishnu supplies access to an existing/new **free-tier** Supabase project. Do not enable billing or upgrade.
   Keep project credentials out of GitHub comments, PR descriptions, screenshots, and logs.
2. Apply [the migration](../supabase/migrations/20261107000000_m1_vault.sql) in the project's SQL editor.
   Alternatively, an authorized operator can use the Supabase CLI with access token and database password
   supplied through their environment. Never pass secrets in command-line arguments or commit them.
3. In Supabase Auth, enable email/password and email confirmation, set the deployed app's Site URL and
   exact redirect allowlist, and configure permitted users. For a personal vault, after enrolling the owner,
   disable new signups. Local confirmation settings are for tests only; they do not configure hosted Auth.
   Free-tier email delivery/rate limits may require a configured sender or a dashboard-invited owner.
4. Copy `.env.example` to `.env.local` locally, or set these variables in the build environment:
   - `VITE_SUPABASE_URL`: the project HTTPS URL.
   - `VITE_SUPABASE_ANON_KEY`: the anonymous/publishable API key, **never** a service-role or secret key.
   These two settings are intentionally browser-visible, not authorization secrets. RLS and the owner's
   Auth JWT enforce access. No privileged key belongs in any `VITE_` variable.
5. Run `npm run build` **with those variables set**, then serve `dist` from an HTTPS static host on a free tier.
   `npm run preview` is a local smoke-test server, not a production server.
   A build without configuration intentionally shows an explicit configuration error on the owner page.
6. Run the hosted smoke test with one existing, confirmed, synthetic test account. Set these four variables
   in your shell session only (never in a committed file):
   `HOSTED_SUPABASE_URL`, `HOSTED_SUPABASE_ANON_KEY`, `HOSTED_TEST_EMAIL`, `HOSTED_TEST_PASSWORD`. Then:

   ```powershell
   npm run test:hosted
   ```

   Expected: 34 `PASS` lines and `ALL HOSTED CHECKS PASSED`. It checks anonymous denial on every table and
   export (`42501`), sign-in/sign-out, create/read with provenance and confidence, denied direct table writes,
   revisions and stale-edit rejection, V1-shaped token-free export, denied connector/token-hash/audit access,
   deletion of the whole revision chain, and content-free deletion audit. It deletes its own fixture and leaves
   pre-existing vault rows untouched; three content-free audit rows per run remain by design.
   On a network with a TLS-inspecting proxy, Node may report `SELF_SIGNED_CERT_IN_CHAIN`; run
   `node --use-system-ca scripts/hosted-smoke.js` to use the Windows trusted store. Never disable TLS checks.
7. Repeat the browser acceptance walkthrough against the hosted build using only synthetic accounts.
   Do not run the localhost-only bulk test against the hosted project.

Hosted verification (Nov 10, 2026): migration applied to the free-tier project; `test:hosted` passed 34/34
and the browser walkthrough passed with a synthetic account. Two-user isolation was verified on the local
Supabase stack and in CI, and on the hosted project only from one account's view (no other user's rows visible).
No project access or credentials are provisioned by this repository.

## Data contracts and boundaries

- Memory confidence is an integer percent from 0 to 100, matching V1 `conf`. Type is lowercase in Postgres
  and title case in the V1-compatible export. Source is a required provenance string (label or link).
- Owner reads use RLS; direct table writes are denied. Only authenticated owner RPCs can create, revise,
  or delete. Each write and its audit insert commit together or roll back together.
- Revision/deletion operations serialize per owner to prevent forks and orphaned history. Deleting any
  revision removes the entire connected chain, even if an old browser tab selected an earlier revision.
- Audit is append-only for API roles. Database administrators remain trusted and can maintain data.
  Account deletion cascades the account's data, including its audit; individual memory deletion does not.
  M1 audit `query` contains operation labels only, not owner-submitted content. M3 must preserve this rule
  for agent queries so deleted content cannot linger in audit text.
- Export retains V1's envelope and memory fields (`id`, `topic`, `type`, `text`, `source`, `when`, `conf`).
  UUID IDs replace demo integers. Additional timestamps and `superseded_by` preserve revision metadata.
  Grants retain V1 display fields plus `expires_at`, `revoked_at`, `uses`; finite standing grants are labeled
  `Standing`, not incorrectly assumed to last 30 days. Audit retains V1 display fields plus structured metadata.
  Export excludes all user IDs, token hashes, raw tokens, and connector credentials. It is an owner-only
  full snapshot, not an import/restore endpoint or a scoped agent response. Treat downloaded JSON as private.
- Connector state holds references to encrypted Supabase Vault secrets. Browser roles cannot read state,
  decrypt secrets, or invoke Vault functions. OAuth lifecycle, key/secret cleanup and syncing are **M2**, not built here.
- Grants store only a unique SHA-256-format hash. No token minting, grant write API or agent endpoint is
  implemented in M1. M3 must filter server-side against the grant row, audit in the same transaction, and
  return indistinguishable empty results for unknown/revoked/expired tokens. Never give an agent an owner JWT.
- M1 uses native Auth/PostgREST and SQL RPCs instead of duplicating owner logic in an Edge Function.
  Edge Functions remain the planned location for later agent/connector endpoints on the same decided stack.
- Owner sessions are held only in browser memory. Reloading requires sign-in; signout clears displayed data.
  No browser analytics, credential logs, or automatic ingestion. Password recovery and other account-management
  UI, managed-backup erasure, a production uptime guarantee, and M2/M3 functionality are not part of M1.
