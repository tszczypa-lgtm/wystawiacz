# Original Wystawiacz port

The original program is in ../outputs/allegro-assistant. Its index.html,
styles.css and app.js were copied explicitly into public/wystawiacz. No local
credential files, logs, payloads or packaged binaries were copied.

/panel now hosts that interface, not the simplified DraftList. All photo,
vehicle, description, pricing, product navigation and JSON session operations
use the original implementation. Sessions are still transferred as JSON files
and photos are relinked by filename, exactly as in the original; cloud storage
and team sharing are not yet implemented.

Web-specific differences:
- A logged-in Supabase session is required for every Allegro API call.
- Calls go to /api/allegro/* instead of the local PowerShell helper.
- The parent panel supplies a fresh session token only to its own same-origin frame.
- One shared application is configured by the owner on the server. Users do not enter keys.
- The connection button opens Allegro Authorization Code flow with PKCE S256 and account confirmation.
- An encrypted HttpOnly/Secure/SameSite cookie binds state, verifier, initiating user and a ten-minute expiry.
- The callback exchanges the code immediately server-side; tokens are encrypted per user with AES-GCM.
- A popup keeps the original workspace and selected photo File objects alive during authorization.
- Client secrets and Allegro access/refresh/device tokens never return to the browser.
- Disconnect deletes the user's saved connection; it does not affect other users.

## Required deployment configuration

1. Run supabase/002_allegro_connections.sql in Supabase SQL Editor.
2. Set Cloudflare Worker secrets (runtime, not public build variables):
   SUPABASE_SERVICE_ROLE_KEY: this project's Supabase service-role secret.
   ALLEGRO_ENCRYPTION_KEY: a cryptographically random 32-byte key, base64 encoded.
   Keep this encryption key stable; changing it invalidates existing connections.
   ALLEGRO_CLIENT_ID: the shared Tymo Garage application ID.
   ALLEGRO_CLIENT_SECRET: its server-only secret (used for refresh, never entered by users).
   ALLEGRO_REDIRECT_URI: https://wystawiacz.tszczypa.workers.dev/api/allegro/auth/callback
3. Register an Allegro application with browser access (Authorization Code flow).
   Register the exact ALLEGRO_REDIRECT_URI in Allegro's application settings.
   Existing device-only applications cannot change type; create a new one if needed.
   Deploy, log in, and click Connect. Confirm the account on Allegro; no user keys.
4. Verify categories, delivery/after-sales templates, images and one manually
   approved offer against the live seller account. No live offer is created by tests.

Without both secrets, the API returns a clear configuration error and does not
send credentials or create offers. Never commit secrets or prefix them NEXT_PUBLIC_.

Unverified: real account OAuth, image uploads, offer creation and refresh-token
rotation under concurrent requests across Worker instances. Publication has no
subscription gate yet. This is a migration, not a production-ready paid SaaS.
