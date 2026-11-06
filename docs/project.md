# Project

> Reconstructed for the V1 baseline (#2) from the V1 test page and issues #1–#7. The original Muse-workspace
> version of this file was not available when the baseline was published.

## One line

One vault a person owns. AI agents ask it for scoped access instead of keeping their own copies of your life.

## Problem

Every AI agent builds its own partial, unaudited copy of you. You can't see what each one knows, can't scope it,
and can't take it back.

## Approach

1. **Capture** — connectors subscribe to changes; new mail, events, and commits land within minutes.
2. **Distill** — raw events become facts, episodes, and preferences, tagged by topic and linked to source.
   The raw record stays behind the link; it is not the memory.
3. **Grant** — the owner approves a scope: which topics, summary or verbatim, for how long.
4. **Gatekeep** — filtering happens inside the vault at query time. Denied looks identical to "nothing found."
5. **Audit** — every read is logged: who saw what, when, under which grant. Revoke any time.

## Memory model

| Field | Meaning |
|---|---|
| type | fact · episode · preference · idea |
| topic | Work · Finance · Family · Health · Ideas |
| text | the distilled memory |
| source | provenance — where it came from, with a link back |
| confidence | 0–100 |

## Non-negotiable rules

- Filtering happens server-side, at query time, against the grant row. The client never receives memories outside the grant's topics.
- Denials are indistinguishable from empty results — revoked, expired, and unknown tokens all look like "No memories found".
- Tokens are stored hashed only. A leaked DB row must not yield a usable token.
- Deletion removes a memory from the vault; the audit log keeps who/when/how many, without the deleted content.
- No secrets in the repo, logs, or PR descriptions. No real user data in code, tests, or demos.

## The test that matters

Will people connect a second agent — and revoke the first one's grant? If yes, there's a product.
