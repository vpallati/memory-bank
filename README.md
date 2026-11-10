# Memory Bank

One vault a person owns. AI agents ask it for scoped access instead of keeping their own copies of your life.

Memories flow in from the tools you already use, get distilled into facts with sources, and leave only through
**scoped, expiring, revocable grants** — never as a raw dump.

## Status

**V1 — interactive prototype.** A single self-contained HTML file that proves the core loop with demo data:

capture → distilled memories → scoped grants → gatekept answers → full audit

V2 (real backend + real connectors for one person, daily) is tracked in [#1](https://github.com/vpallati/memory-bank/issues/1).

**M1 owner vault implementation:** a separate [authenticated vault page](vault.html) uses Supabase
Auth, Postgres, RLS, audited CRUD with revision history, and token-free JSON export.
Hosting is Supabase free tier, as [confirmed on #3](https://github.com/vpallati/memory-bank/issues/3#issuecomment-6702030748).
See [setup, deployment, tests, and limitations](docs/m1-backend.md). This does not connect the V1 demo to a backend.

## Run V1

No build, no server, no dependencies.

1. Open `index.html` in any modern browser (double-click it, or serve the folder with any static server).
2. The vault holds **demo data for a fictional user, "Alex."** No real account is connected and nothing leaves the page.

## Try it

1. **Vault** — filter by topic (Work, Finance, Family, Health, Ideas) or search. Each memory shows type, source, and confidence.
2. **Grants** — create a grant: agent name, topic scope, depth (summary / verbatim), duration (one-time / session / 30 days / permanent).
3. **Test an agent** — pick an agent (its grant) and ask. In-scope questions return memories with provenance.
   Out-of-scope questions return exactly `No memories found.` — identical to a topic with nothing in it.
4. **Revoke** a grant and ask again — the agent's next call gets nothing. One-time grants auto-expire after one query.
5. **Audit log** — every grant, read, denial, sync, and revocation, visible to the owner.
6. **Export JSON** — download the full demo vault (memories, grants, audit). State persists in `localStorage`;
   **Reset demo** restores the original data.

## Vault rules

- **No master keys** — every token is scoped, expirable, and revocable.
- **Denial leaks nothing** — "not permitted" and "doesn't exist" return the identical response.
- **Memories can fade** — stale facts decay in ranking; conflicts surface to the owner.
- **Patterns, not secrets** — finance memories store the pattern, never account numbers or credentials.

## Docs

- [Project](docs/project.md)
- [Roadmap](docs/roadmap.md)
- [V2 scope](docs/v2-scope.md)
- [V2 architecture](docs/v2-architecture.md)
- [Decisions](docs/decisions.md)
- [M1 backend setup and verification](docs/m1-backend.md)

## License

[MIT](LICENSE) © 2026 Vishnu Vardhan Kumar Pallati
