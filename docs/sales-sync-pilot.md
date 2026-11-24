# Automatic sales pilot: Allegro to Ovoko

## Scope

This release supports one direction only: a new confirmed purchase of the last single unit on Allegro withdraws its exact linked Ovoko part with the live Written off status. It never deletes parts/photos/cars, mutates Allegro listings, changes prices or relists on cancellations/returns. Ovoko to Allegro is explicitly disabled until real Ovoko order lifecycle/timezone evidence is verified. Do not advertise two-way synchronization or guaranteed protection against simultaneous purchases.

Only active, non-suspended administrators may enable this pilot. It works without an open browser. One account and at most one action are processed per scheduled invocation; multiple accounts rotate by oldest attempt. For a single pilot account the trigger is every minute, but provider errors, queues and processing can increase delay. Several sales may therefore take several minutes. Stock greater than one and ambiguous links are not handled automatically.

## Deployment

1. Run `supabase/016_sales_sync.sql` in the existing Supabase SQL Editor. Tables and RPCs are service-only, RLS enabled, with no browser grants. Migration 012 is a prerequisite. No live sale or listing is changed by migration alone.
2. Push the code and wait for Cloudflare Ready. The generated worker config contains `triggers.crons = ["* * * * *"]`; verify the cron under Trigger Events after deployment. This also runs the existing order-mail handler every minute; its existing kill switches and queue remain unchanged.
3. Set `SALES_SYNC_ENABLED=true` in Cloudflare. Existing `ALLEGRO_CLIENT_ID`, `ALLEGRO_CLIENT_SECRET`, `ALLEGRO_ENCRYPTION_KEY`, saved Ovoko connection and service-role DB key must remain correct. `OVOKO_TEST_ENABLED=false` disables this pilot too. No secret is entered in the browser.
4. In My Parts expand **Automat Allegro -> Ovoko**, refresh status, and click **Wlacz Allegro -> Ovoko od teraz**. This is explicit account consent, not a global automatic enrollment. It probes order access and the withdrawal dictionary, saves the current Allegro event cursor and an enable boundary. Past purchases are not replayed.
5. Refresh status after the next trigger. Verify the last check time and no error. The UI does not claim a healthy monitor merely because consent exists. For the first real sale verify both portal states and the action journal. No live provider mutation was performed during development.

Disable consent to stop subsequent actions. `SALES_SYNC_ENABLED=false` is a deployment-level kill switch. Disabling does not reverse an in-flight request or reactivate anything. A changed account, credential fingerprint, revoked admin role or suspension blocks subsequent writes. If work has not resumed for 55 days (Allegro event retention is 60 days), explicit review/re-arming is required.

## Durable Processing

- A five-minute lease plus CAS prevents concurrent schedulers from processing the same account. Previous workers cannot ingest with an expired/replaced lease. Accounts are processed independently.
- Read at most 100 events per tick from the saved cursor. Validate seller, ordering and normalized evidence. The RPC persists sanitized evidence and advances the cursor in one transaction. A full batch means backfill: no portal writes until the queue of events, including cancellations, has been drained.
- Only exact confirmed publication mappings for the current owner, seller, Ovoko account and generation can create an action. The actual item `boughtAt` must be after enable and after the publication timestamp. A delayed READY event cannot apply an old purchase to a newer publication. Missing purchase time or multi-unit lines are not auto-withdrawn.
- BOUGHT/READY duplicates are deduplicated by item, part and publication hash. An order ID missing at BOUGHT waits for a later event. Cancellation moves the action to review, never auto-relist. No buyer details, addresses, names, emails or raw orders are persisted.
- Immediately before a write check fresh order status, exact line item, purchase timestamp and quantity, Allegro current stock zero, exact Ovoko external ID/part ID, current publication hash, active consent/lease/role/account and unchanged saved connections. Reserved/sold/unknown targets are not overwritten.
- An action leaves `queued` via durable CAS. A second CAS to `running` precedes the provider call. Crash/timeout/lost acknowledgments never permit a second write. Readback can confirm `done`; otherwise the row stays uncertain or review. A process abandoned at preflight is also conservative (read-only recovery, not automatic replay).
- Re-arming creates a new subscription epoch but does not erase previous action tombstones. Same physical part, generation and purchase cannot be blindly retried by toggling the switch.

## Verification

`node scripts/test-sales-sync.mjs` covers account enable boundary, scope checks, kill switches, event ingestion, foreign seller, source stock, cancellation, publication changes, connection rotation, revocation, disable during preflight, target races, durable reservations, concurrent schedules, uncertain timeout/readback and token renewal. Network and SQL RPCs are mocked; this is not live database/provider validation.

Run TypeScript, production build, `node scripts/test-sales-coordination-build.mjs` (actual compiled parser import targets), existing read-only review/manual withdrawal tests, and `scripts/test-combined-inventory-browser.mjs`. The latter checks lazy status-only initialization, explicit enable/disable and the visible reverse-direction warning. Migration must still be executed against PostgreSQL during deployment; static SQL checks do not substitute for that.

Primary contracts: [Allegro order events and retention](https://developer.allegro.pl/tutorials/jak-obslugiwac-zamowienia-GRaj0qyvwtR), [Ovoko status changes and order schemas](https://api.rrr.lt/openapi/swagger.yaml).
