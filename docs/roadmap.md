# Roadmap

> Reconstructed for the V1 baseline (#2) from the V1 test page (section 06) and issue #1.
> Rule: no version starts until the previous one proves itself with real users.

## V1 — Personal proof (current)

- One user, one vault
- Gmail, Calendar, GitHub (simulated, demo data)
- One scoped grant, one agent
- Revoke button + audit log

## V2 — Actually usable ([#1](https://github.com/vpallati/memory-bank/issues/1))

Milestones, in order, one PR each:

| | Milestone | Issue |
|---|---|---|
| M1 | Backend + Auth + tables + RLS, vault CRUD, export | [#3](https://github.com/vpallati/memory-bank/issues/3) |
| M2 | Gmail connector: OAuth, sync, distillation, digest v0 | [#4](https://github.com/vpallati/memory-bank/issues/4) |
| M3 | Grants API + approval pings + audit log | [#5](https://github.com/vpallati/memory-bank/issues/5) |
| M4 | Digest corrections loop + decay + conflict surfacing | [#6](https://github.com/vpallati/memory-bank/issues/6) |
| M5 | Calendar + GitHub connectors; V2 done criteria | [#7](https://github.com/vpallati/memory-bank/issues/7) |

V2 is done when one user (Vishnu) runs it daily for 2 weeks on real data, with grants + digest working.

Later V2 candidates shown on the V1 page (not yet scheduled): more sources (Drive, Slack, browser, notes),
first 10–50 outside users.

## V3 — Teams (out of scope for V2)

Shared team vaults, role-based scoping, admin dashboard, Jira / Confluence / Salesforce, new-hire briefing.

## V4 — Enterprise (out of scope for V2)

Org-wide admin grant; SSO, SCIM, approval chains; SOC 2, retention, legal hold; zero-knowledge & BYO storage.

## V5 — The platform (out of scope for V2)

Agent directory & standard, agent-to-agent handoff with consent, cross-vault portability, proactive briefings.
