# V2 scope

> Reconstructed for the V1 baseline (#2) from issue #1. Issue #1 is the source of truth; update this file when
> V2 ships (#7) with what actually shipped vs what changed.

## Goal

V1 proved the permission engine with simulated data. V2 makes it real for one person, daily.

## In scope

1. **Real connectors** — Gmail, Calendar, GitHub via OAuth, syncing continuously. New mail, events, commits distill
   into memories with provenance, within minutes. Order: Gmail → Calendar → GitHub.
2. **Approval pings** — agent requests access; user gets Approve / Deny / Approve once / Approve narrower.
   Finance, health, family always need a human tap.
3. **Weekly digest** — what was captured, tap to correct or delete. Corrections retrain the classifier.
4. **Decay + conflicts** — stale facts fade in ranking; contradictory memories surface to the user.
5. **Real backend** — vault moves off browser-only storage to a hosted service with auth, so grants and audit survive
   across devices.

## Explicitly NOT in V2

Teams, shared vaults, billing, enterprise compliance, chatbot linking, paid services. Those are V3+.

## Done when

One user (Vishnu) runs it daily for 2 weeks on real data, with grants + digest working.

## What shipped vs what changed

_To be filled in at the end of M5 (#7)._
