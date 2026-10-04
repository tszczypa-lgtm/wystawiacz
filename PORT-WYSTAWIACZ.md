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
- Tokens and application credentials are encrypted per user with AES-GCM.
- Client secrets and Allegro access/refresh/device tokens never return to the browser.
- Disconnect deletes the user's saved connection; it does not affect other users.

## Required deployment configuration

1. Run supabase/002_allegro_connections.sql in Supabase SQL Editor.
2. Set Cloudflare Worker secrets (runtime, not public build variables):
   SUPABASE_SERVICE_ROLE_KEY: this project's Supabase service-role secret.
   ALLEGRO_ENCRYPTION_KEY: a cryptographically random 32-byte key, base64 encoded.
   Keep this encryption key stable; changing it invalidates existing connections.
3. Deploy, log in, and connect Allegro using its device-flow application credentials.
4. Verify categories, delivery/after-sales templates, images and one manually
   approved offer against the live seller account. No live offer is created by tests.

Without both secrets, the API returns a clear configuration error and does not
send credentials or create offers. Never commit secrets or prefix them NEXT_PUBLIC_.

Unverified: real account OAuth, image uploads, offer creation and refresh-token
rotation under concurrent requests across Worker instances. Publication has no
subscription gate yet. This is a migration, not a production-ready paid SaaS.
