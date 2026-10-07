# Title suggestions

When a suggestion mode is enabled, the listing UI automatically searches after a 1.5-second pause in entering a
complete part number. It shows up to two product names from Allegro's catalog
(GET /sale/products, mode=MPN) and two Google organic results through SerpApi.
These are source suggestions, not verified vehicle fitment. Selecting a title
does not publish an offer or change the entered part number or photo order.

## Modes

Both checkboxes unchecked means manual entry with no title-search requests.
Full-title mode retains the source suggestion. Part-name mode conservatively
extracts recognizable component names from those same results (a local phrase
list, not AI identification), without their vehicle models. Unsupported names
are not offered. Click a name, then select an existing vehicle from the session
list. The full part number is appended once by the existing editor. The two
checkboxes are mutually exclusive; the selected mode is remembered in this
browser's local storage. Mode changes cancel stale requests and reuse cached
source results instead of charging for another Google search.

## Google Setup

Create a SerpApi account, review its current pricing and set a spending/usage
limit before enabling it. In Cloudflare, Worker `wystawiacz`, Production,
Settings > Variables and secrets, add `SERPAPI_API_KEY` as a Secret and deploy.
Never put this key in browser code, Git, screenshots or chat. It is shared only
on the server; customers do not configure keys.

Without this secret the Allegro suggestions still work and the Google group
reports that it is not configured. No invented suggestions replace missing
results. External calls have timeouts. Results are cached per owner/part number
for five minutes in the Worker instance, with at most eight uncached searches
per owner/minute per instance. These are best-effort controls, not a global
billing limit: configure a hard budget with the provider before public rollout.

Google requests send only the entered part number, not photos or customer data.
Allegro uses the seller's existing server-side connection. The route is guarded
by the existing account and subscription checks. Provider errors never return
API credentials to the browser.
