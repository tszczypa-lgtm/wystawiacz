# All Linked Parts, Not an Initial Sample

Apply `supabase/022_reverse_sync_all_links.sql` after 012 and 018 (normally after the existing 021 deployment), then deploy the code. The migration is transactional and repeatable. It preserves active consent, epoch, lease, excluded initial orders, action history and publication hashes. Existing enabled subscriptions expand without disable/re-enable and without resetting the excluded order baseline.

Previously, older mappings were eligible only if present in `watch` at enable time; newly created mappings could also qualify. The displayed initial watch size was not a five-part batch limit, but could hide omissions of older mappings. Enabling was additionally capped at 499 journals / 2,000 inventory rows. These inventory scans and caps are removed.

Migration 022 selects current, confirmed, exact owner/seller/Ovoko-account publication mappings when ingesting each new order, regardless of watch membership or mapping age. Uncertain/missing/foreign mappings and ambiguous multiple-offer mappings never authorize an END operation. Provider order, external ID, sold status, live Allegro stock/status, consent, credentials, ownership, epoch, lease and generation checks remain unchanged. Historical baseline orders are still excluded. No provider writes are performed by the migration.

The UI reports the full database aggregate of linked and unconfirmed journal rows, not the first REST page or old watch length. These are registry counts, not a guarantee that every provider listing is currently active. Added mappings join automatically. Unlinked listings cannot be synchronized by guessing their title or OE number.

Both controls and the reverse worker require the versioned coverage RPC, so missing migration 022 cannot silently claim all-part coverage. Disabling consent remains available even if coverage cannot be read. The change does not remove existing order-window, job throughput, provider rate or safety limits; a large order backlog can still take time.

Tests reproduce an older six-hundredth mapping missed by the former five-item watch, apply/rerun the actual SQL, check 40,000 mappings via an aggregate, and exercise new links, old-order exclusion, invalid scope/lease/consent, uncertain/foreign/ambiguous mappings and browser-role denial. Runtime fixtures retain no-retry semantics for uncertain provider writes. No live database or marketplace changes are made during testing.
