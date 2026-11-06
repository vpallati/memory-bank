# Decisions

> Reconstructed for the V1 baseline (#2) from issues #1–#7 and the V1 page. Only Vishnu closes an open decision,
> via a comment on the relevant issue. Do not build on an open decision.

## Decided

| Decision | Source |
|---|---|
| License: MIT | #2, V1 page |
| Open-source stack only, free tiers only; no billing, teams, shared vaults, or enterprise features in V2 | #1 |
| Filtering is server-side at query time against the grant row | #1 |
| Denials are indistinguishable from empty results (revoked, expired, unknown tokens included) | #1 |
| Tokens stored hashed only | #1 |
| Deletion removes content; audit keeps who/when/how many | #1 |
| REST first, MCP second, both call the same grant engine | #5 |
| Connector order: Gmail → Calendar → GitHub | #7 |
| Sensitive scopes (finance, health, family) always need a human tap | #1, #5 |
| One milestone at a time, one issue = one branch = one PR; Vishnu merges | #1 |
| Demo data only (fictional "Alex") in code, tests, and demos | #2 |

## Open — do not guess

| Question | Options | Where to answer |
|---|---|---|
| Backend hosting | Supabase free tier (leading) · self-host on Pi | [#3](https://github.com/vpallati/memory-bank/issues/3) |
| Approval-ping channel | web push · messaging | [#5](https://github.com/vpallati/memory-bank/issues/5) |
| Repo layout | V2 in this repo on feature branches (default) · new V2 repo | [#1](https://github.com/vpallati/memory-bank/issues/1) |
