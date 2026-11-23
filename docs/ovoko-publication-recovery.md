# Resolving old uncertain publication locks

Apply `supabase/015_ovoko_publication_recovery.sql` before confirming a recovery. No manual DELETE of publication rows is needed.

In the single-offer preparation page, expand "Rozwiaz stara blokade publikacji" and click "Sprawdz blokade w Ovoko". This only reads provider data.

- Only active admins can use the existing guarded Ovoko API route; POST, same-origin, bearer auth, bounded JSON and 3 checks/minute apply.
- The offer must still belong to the connected Allegro seller. Credentials remain server-side. Account, owner, exact source offer, publication hash and timestamp are bound into a short-lived encrypted proof with dedicated AAD.
- Only sending/uncertain rows unchanged for over 30 minutes qualify. Created publications use the normal presence/retransfer workflow instead.
- An exact unique external reference can repair the saved part ID without creating a new part. A conflicting saved part ID blocks recovery.
- Absence requires a complete ordered inventory scan (up to 2000 records), stable totals, exact-ID checks and repeated external-reference reads. Provider errors, partial/inconsistent data and oversized inventories never prove absence.
- For absence the admin must also confirm a manual all-status inspection of the physical part. The server repeats the provider check on confirmation; nothing publishes automatically.
- The service-only PostgreSQL RPC atomically updates/deletes the exact old journal version and inserts an audit row. No-match returns false. Audit failure rolls back the change. Direct browser access to the journal/audit/RPC remains revoked.
- If a confirmed absent lock is released, refresh the preparation page and explicitly publish again. The normal unique reservation, source ownership and provider duplicate preflight still apply.

This workflow resolves a particular uncertain attempt; it never disables duplicate protection globally. No live recovery, SQL migration or publication was performed during development.

## Related UI updates

Successful bulk transfer logs include the live selected category path and ID. Already-created skips do not fabricate a category.

The list's visible Status selector includes Wycofane Ovoko and Zakonczone Allegro; inactive records are hidden by the default Dostepne view, not permanently deleted.

## OAuth diagnostics

Authorization callback errors are safely allowlisted, distinguished from token-exchange and seller-binding errors, and shown without raw provider descriptions, codes or tokens. Failed callback windows stay open and the query string is removed; successful login still closes the popup. `oauth_denied` previously hid every provider authorization error, not just cancellation.
