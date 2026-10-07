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

Google searches use the complete number without exact-phrase quotes so that
spaced catalog numbers can be returned. The complete number (including suffix)
must occur in the title or snippet; a title mentioning another suffix in the
same number family is rejected even if the snippet lists the requested number.
No extra fallback search is sent automatically.

## Title Editor

The remembered uppercase checkbox changes the actual title, not only its CSS.
The counter includes spaces; titles over 75 characters are never silently cut.
Saving a product over 75 characters is blocked. Publication additionally checks
Allegro's minimum of 12 characters and three words. These controls cover typed
titles, chosen suggestions, selected vehicles and restored drafts.

The CAPS preference is now alongside the title label, above the textarea.
Recognized suggestions include a separate append action for composing an offer
such as `Pompa ABS + Sterownik ABS VW Tiguan 5NA803881F`. Appending preserves the
selected session vehicle and one complete number, avoids repeated identical
names, and does not silently truncate. Only combine components actually sold
together; different search results do not prove they form a set.

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

## AI Analysis Setup

Create an OpenAI API project and enable API billing separately from ChatGPT.
Create a project API key at https://platform.openai.com/api-keys and add it as
the Secret `OPENAI_API_KEY` in Cloudflare Worker `wystawiacz`, Production,
Settings > Variables and secrets, then deploy. Do not send the key in chat,
screenshots or Git. Set provider spending alerts and monitor usage; local
per-instance limits are not a global hard billing cap. Avoid automatic top-ups
while testing. Optional plain variable `OPENAI_PART_MODEL` overrides the default
`gpt-4.1-mini`. No new dependency or customer-side credentials are required.

AI receives only the entered number and up to eight matching search titles,
snippets and public URLs (including exact-number Allegro names when present).
It does not receive photos, customer details or seller access tokens. It does
not browse full pages. Search evidence is treated as untrusted data. Results
contain Polish component names, proposed full titles, explanations and source
links. They are not verified catalog records or guarantees of compatibility.
Separate pump/controller offers do not prove a combined assembly. The seller
must confirm what is physically included. Unsupported/ambiguous results should
produce no suggestion; source IDs are validated against the supplied evidence.

Responses API uses structured output, `store: false`, a 900 output-token cap
and a 15-second timeout, with no automatic AI retry. With no key, no matching
evidence, refusal, invalid output or provider failure, the ordinary search
results remain available and the interface explains the limitation. Successful
analysis replaces the Google group with up to two AI proposals; Allegro stays.
Mode selection, manual selection, CAPS, append and own-vehicle controls remain.
Tests use mocked providers; live paid requests require the owner's setup.
