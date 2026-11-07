# V2 architecture

> Reconstructed for the V1 baseline (#2) from issues #1, #3, #5 and the V1 page's "How agents connect" section.
> M1 hosting is **Supabase free tier**, confirmed by Vishnu on #3 — see [decisions.md](decisions.md).

## Shape

```
connectors (Gmail → Calendar → GitHub)
   │  webhook / cursor-based polling
   ▼
distillation (small model call) ──► memories (topic, type, text, source link, confidence)
                                         │
agent ──► REST /query  ─┐                │
agent ──► MCP tools    ─┴─► ONE grant-checking engine ──► in-scope rows only
                                         │
                                         └─► audit_log (same transaction, append-only)
```

## Tables (from #3)

- `memories` — id, user_id, type (fact/episode/preference/idea), topic, text, source (provenance), confidence,
  created_at, updated_at, superseded_by (history kept, never silently overwritten)
- `grants` — id, user_id, agent name, topics[], depth (summary/verbatim), duration (one-time/session/standing),
  token hash (never raw token), expires_at, revoked_at, uses
- `audit_log` — id, user_id, agent, grant_id, query, result_count, outcome (allowed/denied/import), created_at.
  Append-only; agents never see it.
- `connector_state` — per source: OAuth tokens (encrypted at rest), last sync cursor, sync status

Row-level security: one user can never read another user's vault.

## M1 owner backend

See [M1 setup and verification](m1-backend.md) for deployment and exact test steps.

- Supabase Auth issues owner JWTs. PostgREST applies RLS to reads. Audited SQL RPCs implement
  create, revision, and deletion, derive ownership from `auth.uid()`, and accept no client-supplied owner ID.
- A revision inserts a new row and links the old row through `superseded_by`; stale edits fail explicitly.
  Deleting any revision deletes its entire connected revision chain. Writes and their audit records are atomic.
- Owner clients cannot write tables directly, mutate audit records, read grant hashes, or access connector state.
  Connector state references encrypted Supabase Vault secrets, never plaintext OAuth token columns.
- Export is a single RLS-protected SQL snapshot, not a paginated client-side dump. It retains the V1 envelope
  and display fields, adding revision and audit/grant lifecycle metadata. It excludes hashes and connector secrets.
- The standalone V1 page is unchanged. The separate owner page uses sessions held in memory, not localStorage.
- There is no live agent endpoint in M1. Owner JWTs must never be given to agents. Grant enforcement and
  Edge Function endpoints remain M3; connectors remain M2. The M1 tables do not grant any agent access.

## Agent surface (from the V1 page; finalised in M3)

REST, every call carries a scoped token:

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/grants/request` | agent asks, with a reason |
| POST | `/v1/grants/:id/approve` | owner approves / narrows |
| GET | `/v1/memories/query?q=…` | scoped retrieval |
| GET | `/v1/memories/topics` | topics visible to this token |
| DELETE | `/v1/grants/:id` | revoke — effective instantly |
| GET | `/v1/audit` | owner-only read history |

MCP exposes the same engine as tools: `memory.query`, `memory.topics`, `memory.request_grant`.
REST first, MCP second; SDKs are thin wrappers over REST.

## Enforcement

- Filter at query time, server-side, against the grant row.
- Unknown, revoked, expired, and out-of-scope all return the same empty result.
- Tokens stored as hashes only.
- Deletion removes content; audit keeps who/when/how many.
