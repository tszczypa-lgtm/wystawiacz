# Inventory operations

Apply migration 017 after the existing publication/withdrawal migrations. Keep INVENTORY_WITHDRAW_ENABLED=true for mutations. No migration alone changes a portal. Private reservation notes use a service-only RLS table; browser clients cannot query it directly. Only the owning active administrator can access operations through authenticated, same-origin, bounded JSON API requests.

Inventory uses one channel selector and Active / Ended / Sold tabs. Manual ending is not proof of a sale. Allegro sold classification requires sold stock plus zero remaining stock; Ovoko uses the live Sold out dictionary. All selected-channel active states take precedence over ended states; sold has priority. Unknown/partial reads are never invented as sales.

Checkbox selection supports bulk transfer, withdrawal and reservation. Opening a dialog makes no portal writes. Withdrawal chooses Allegro, Ovoko or both with separate durable per-target results, never an atomic success claim. Reservations freeze currently active single-unit stock, record customer, agreed per-part price, deposit, currency, due date and comment, then END Allegro and mark Ovoko Written off. Native Reserved is not used to infer ownership of a reservation. Existing third-party integrations can independently propagate changes and must be reconciled.

Each operation has a request hash and durable execution/target locks. Prepared plans expire after 15 minutes. Repeated confirmation cannot replay uncertain writes. Readback is safe; timeouts remain uncertain until observed state confirms them. Never erase journals to force a retry. A never-started reservation plan may be cancelled without provider writes.

Zarezerwowane lists this application's own open reservations. Expiry highlights red but does not reactivate anything. Restore requires fresh ownership, publication/account binding, unchanged sold counter when known, one remaining unit, and explicit confirmation of physical availability. It ACTIVATEs the same original Allegro offer and returns Ovoko to its original in-stock status, never recreates listings or increases stock. Only one durable restore operation exists per reservation; uncertain restores allow readback, not replay. The parent closes only when all requested legs are confirmed. No arbitrary sold/restocked listing is automatically revived.

Part-number preparation keeps the observed hyphenated spelling as primary and its compact equivalent in the optional field. Server validation corrects older clients that submit only the compact equivalent; fitment lookup still uses compact full numbers. It never invents hyphen positions for an unknown spelling.

Tests: test-inventory-operations.mjs (providers/RPCs mocked), test-stock-workflows-browser.mjs (mocked API browser workflow), test-combined-inventory-browser.mjs, test-sales-sync-worker.mjs --production (actual compiled API in workerd). Live PostgreSQL migrations and controlled provider pilot remain deployment steps.
