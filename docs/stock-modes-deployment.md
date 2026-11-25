# Ovoko Stock Modes

## Deploy

1. Back up the production database using the existing Supabase backup process.
2. Run the complete `supabase/026_ovoko_stock_units.sql` transaction in Supabase
   SQL Editor before publishing this application version. It requires the existing
   publication, inventory and synchronization schemas (012, 016-019 and 022).
   It does not delete existing provider records or convert existing mappings.
3. Push the local commit with GitHub Desktop, then wait for Cloudflare deployment.
4. Reload the transfer screen after its current batch finishes. Both existing
   directional synchronization consents and the existing cron are reused.

No new API key or feature environment variable is required for stock modes.
The existing `OVOKO_PUBLISH_ENABLED`, `SALES_SYNC_ENABLED`, account permissions,
credentials and scheduler remain required.

## Choices

- `shared` (UI default): one Ovoko record represents the initial Allegro stock.
  Allegro purchases leave it available while Allegro has stock. The last purchase
  withdraws it. A confirmed new Ovoko order decrements Allegro by one using a
  relative quantity command. Only after a successful command report, with stock
  remaining, is the same Ovoko record made available again. The Ovoko purchaser
  can buy one unit at a time from this listing.
- `separate`: every original stock unit has a distinct Ovoko record and external
  marker. Purchases of quantity N allocate and withdraw N distinct units.
  An Ovoko sale decrements Allegro by one without reopening that sold unit.

If a confirmed decrement leaves Allegro at zero but still active, a separately
recorded END command closes it. Partial transfers resume only pending units.
An ambiguous provider write is never automatically sent a second time.

## Operational Boundaries

- The mode of a started group is immutable. Existing legacy one-to-one mappings
  remain legacy mappings; they are not silently converted or duplicated.
- Unknown or conflicting provider state is recorded for review, not guessed.
  Known unstarted cancelled allocations can be released for a later sale, but
  cancellation/refund never automatically increases stock or reopens a listing.
- Manual withdrawal pauses the stock group. New source events cannot reopen it.
  Restoring/reserving multi-stock groups is not implemented in this release.
  Existing single-unit reservation behavior remains unchanged.
- Changing the source quantity while a separate transfer is incomplete stops the
  remaining publication rather than creating stock from a stale snapshot.
- Checks run in the existing background queue. Multiple directions, accounts,
  provider latency and retries of reads extend the delay. This is not a distributed
  transaction and does not guarantee prevention of simultaneous purchases.
- Provider mutations and commercial catalogue APIs were not exercised against
  live accounts. Local tests use mocked providers, browser flows and PGlite SQL.
  Real multi-session PostgreSQL lock behavior and actual provider acceptance of
  zero-stock decrements / sold-to-in-stock transitions remain rollout checks.

## Rollback

Disable both synchronization directions and resolve outstanding provider writes
before rolling back application code. Do not drop the stock tables or journals:
they preserve sale deduplication, command identities and uncertain-write evidence.
Older code does not process stock groups. The legacy-journal guard deliberately
prevents it from publishing duplicate mappings for those same offers.

OE-number/year data sourcing is evaluated separately in
`docs/oe-catalogue-evaluation.md`; no paid catalogue was connected or purchased.
