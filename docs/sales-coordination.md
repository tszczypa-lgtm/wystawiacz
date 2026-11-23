# Sales coordination: controlled rollout

## Implemented in this stage

- One channel selector: union, Allegro including shared, Ovoko including shared, shared only, Allegro-only and Ovoko-only. No duplicate channel checkboxes.
- OAuth requests allegro:api:orders:read (not orders:write). Existing users must explicitly authorize again from the Allegro connection screen; do not disconnect or delete their listings. A refresh token cannot silently grant a new scope. The Allegro application registration must allow this scope.
- Admin-only read-only review of 1-5 selected Allegro offers. Explicit click only; no background polling or mutation.
- Fresh seller-owned offers, up to 1000 Allegro order events, stored Ovoko credentials, live Ovoko statuses, exact external references AND confirmed publication journal IDs. Conflicts, missing records, uncertain writes and read errors cannot authorize a decision.
- Only sanitized order evidence is returned; no buyer names, addresses, emails or payment data. Nothing is persisted.
- Decision policy deduplicates Allegro BOUGHT/READY_FOR_PROCESSING by line-item ID, cancels a proposal on cancellation, requires zero remaining stock for Allegro -> Ovoko, and refuses to handle multi-unit stock automatically.
- Withdrawal scope preview is separate from sale coordination. It executes nothing. The screen explicitly states that automatic protection is NOT enabled.

## User-facing semantics

1. Sale of the last single item: withdraw its exact linked counterpart. Allegro -> Ovoko means mark the part sold (not delete the part/car/warehouse). Ovoko -> Allegro means END the exact offer. Concurrent sales on both sides raise an alert; the application cannot undo a sale.
2. Manual withdrawal only Allegro: END, leave Ovoko unchanged. Only Ovoko: Written off, leave Allegro unchanged. Both: independent child jobs with separate outcomes; never claim an atomic all-or-nothing result.
3. Permanent deletion is NOT a synonym for withdrawal. Ovoko documents removal of photos and an eBay listing as side effects of deletePart. Do not expose a misleading "Ovoko only" permanent-delete action.
4. Returns/cancellations never automatically relist. A human must confirm physical availability and resolve payment/reservation state.
5. No listing absent from a partial response is classified as sold/deleted. Ending an offer manually is not evidence of sale.

## Read diagnostics (2026-11-24)

- Review preserves safe, locally authored `coordination_*` diagnostics from the Allegro adapter. Provider error bodies, tokens and buyer data are not forwarded.
- `seller`, `offers`, and `events` identify the failed read; `_http_NNN` preserves the actual provider HTTP status. `_json` and `events_format` mean invalid response data, not missing consent. `offer_ownership` means a selected offer was not found on the current seller account.
- The modal offers read-only retry. Reauthorization is suggested only for provider 401/403 or token renewal failure, not schema errors or outages. This does not change the fail-closed sale policy or enable automatic withdrawals.
- Live account failure is not considered resolved until the deployed diagnostic or a successful review confirms the outcome. No speculative parser relaxation is applied.

## Required before enabling writes

Automatic sale synchronization does not yet include an active scheduler, persistent event cursors or Ovoko order ingestion. Do not label the review as automatic synchronization. The manual withdrawal executor below is a separate opt-in feature, not a background sale monitor.

- Verify Ovoko V2 order shapes, actual NEW/paid/cancelled/returned transitions, order_source and date timezone against an authorized read-only account. Status Sold alone is insufficient. The policy supports normalized Ovoko evidence, but the current review intentionally does not fabricate it.
- Start at an explicit enable boundary with a durable Allegro event cursor. Page chronologically without skipping, retain cursor on errors, detect retention gaps, and overlap Ovoko order polling. Never replay old historical sales against a newer publication generation.
- Bind opt-in to owner, seller ID, Ovoko account hash and publication generation/part ID. Reconnection or revoked admin access pauses processing. Keys stay encrypted server-side.
- Add service-only RLS tables for subscriptions/cursors, deduplicated sale evidence and per-target actions. Event ingestion and cursor advancement must be transactional. Use row leases/CAS for concurrent workers.
- Before each write re-read binding, authorization, source sale and current target. Shared physical stock >1 remains unsupported until stock is explicitly modeled.
- Use a deterministic Allegro command ID; confirm command completion and read target state. Ovoko writes need a durable reservation and readback; uncertain attempts are never automatically repeated. One failed target must not undo another successful withdrawal.
- Keep a kill switch, visible last-check/error status, bounded provider calls/backoff, retryable-read vs uncertain-write separation, and no auto-reactivation. A scheduler cannot guarantee instantaneous protection from simultaneous purchases.
- Run a dry-run pilot on real order evidence before turning on mutation. Test end-to-end with an explicitly selected test part; do not test by withdrawing unrelated stock.

## Manual withdrawals (2026-11-23)

- Apply `supabase/014_inventory_withdrawals.sql`, then set `INVENTORY_WITHDRAW_ENABLED=true` in Cloudflare. No automatic sale monitoring is enabled by this flag. No live offers were changed during development.
- The row action "Wycofaj" opens scope selection. "Sprawdz i przygotuj" checks ownership and prepares a 15-minute plan but does not mutate portals. A second explicit confirmation executes it.
- Only an active administrator can use `/api/allegro/inventory-withdrawal`. It requires bearer auth, same origin, JSON and bounded input. The journal is service-only with RLS, no browser policies.
- Targets are server-derived and bound to owner/seller. Ovoko also requires the exact external reference, confirmed publication ID/generation, live status dictionary and stored credential fingerprint. Uncertain publication mappings cannot be withdrawn automatically.
- Allegro uses END with a deterministic command UUID; Ovoko uses changePartStatus to the live Written off status. No permanent-delete endpoint is used. Both targets have independent journal outcomes, not an atomic success claim.
- A durable prepared -> running CAS precedes provider changes. Duplicate confirmation never repeats writes. Submitted is not success; "Sprawdz wynik" reads current statuses without replaying writes. Provider timeout stays uncertain until a matching readback confirms the target.
- If persisting an intermediate result fails, the running lock stays closed. There is no blind unlock/retry. Provider/account/generation changes or sold/reserved Ovoko parts stop the operation before writes.
- Current scope: seller-owned Allegro rows; Ovoko-only/both withdrawal requires a linked Ovoko record. Standalone Ovoko parts without an Allegro mapping are not managed by this executor.
- "Only one portal" describes this application's writes. Independently configured native/third-party integrations may propagate a portal status change; disable or reconcile competing integrations before enabling automatic coordination.

## Verified primary documentation (2026-11-23)

- Allegro order events and cursor: https://developer.allegro.pl/documentation#operation/getOrderEventsUsingGET
- Allegro END commands and async outcomes: https://developer.allegro.pl/tutorials/jak-zarzadzac-ofertami-7GzB2L37ase
- Ovoko order V2/schema: https://api.rrr.lt/openapi/swagger.yaml
- Ovoko status dictionary: https://api.rrr.lt/docs/part_status.php
- Status change: https://api.rrr.lt/docs/change_part_status.php
- Permanent deletion side effects: https://api.rrr.lt/docs/delete_part.php
