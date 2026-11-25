# Free technical year hints

## Optional OpenAI Internet Fallback

With the owner's cost approval, a missing model/year now falls back to OpenAI
Responses API web search. This path is paid, unlike the account/catalogue reads
below. It uses the server-side `OPENAI_API_KEY`; no key is sent to the browser.
It is enabled when that key exists unless `OVOKO_WEB_YEAR_ENABLED=false` is set.
`BETA_AI_ENABLED` does not govern this inventory feature.

Default model: `gpt-5.4-mini`, configurable via `OVOKO_WEB_YEAR_MODEL`. The provider
request forces web search and a structured response, uses at most four tool calls,
and allows 8192 output/reasoning tokens. Only the complete public part number and a make hint
are transmitted, not user identities, photos, prices, stock or offer descriptions.

A match needs the exact code including its suffix, model, year, and an HTTPS URL
present among the actual search sources/citations. Unsupported models and years
outside Ovoko's dictionary range are rejected. A public seller example is marked
as a technical year, never a verified donor year or universal compatibility claim.
Web evidence can replace the initially guessed model; manual choices are retained.
Both single-offer and bulk screens display a clickable source.

Searches run in OpenAI background mode with `store=true` so the same response ID
can be retrieved. This stores the public number/hint and generated search result
with OpenAI under its Responses data controls. User account data is not sent.
Each HTTP start/status request has a 20-second timeout. Queued/running jobs are
kept in the Worker cache and polled every five seconds; neither screen treats a
running search as a missing year. Preparation polling cannot publish a part or
create a car until the lookup completes. Stopping the batch stops local polling,
not the already accepted provider job. The UI bounds waiting to ten minutes.

Identical in-flight requests coalesce. Positive results are cached for seven days
in the Worker Cache API and local memory, scoped to owner, number, provider key
and model. Empty results cache for 30 minutes; errors for five minutes. No automatic
paid search resubmission is performed. Read-only status GETs may be repeated;
temporary status errors retain the same response ID. Explicit diagnostic codes
distinguish output-token exhaustion, missing search/output, invalid JSON/schema,
transport timeouts and HTTP errors. The cache version changed to avoid replaying
old generic failures. Preparation/year-read limits allow 30 reads/minute for
polling; the part-import phase remains limited to ten/minute.

The 200-new-lookups/hour limit is an isolate-local
abuse guard, NOT a global financial spending cap. Cache eviction, another Cloudflare
location or simultaneous isolates can cause another paid call. Set the OpenAI
project budget/alerts separately and use the feature flag as a kill switch.

Deployment needs no SQL or new Cloudflare binding. Confirm `OPENAI_API_KEY` exists
on the deployed Worker and that its OpenAI project has Responses/web-search access
and funded API billing. The local tests mock OpenAI; they are not a live provider
or billing verification. Relevant provider documentation:

- https://developers.openai.com/api/docs/guides/tools-web-search
- https://developers.openai.com/api/docs/models/gpt-5.4-mini

## Account-Scoped Free Hints

No database migration or paid catalogue key is required.

Bulk preparation checks the full manufacturer code even when a title already
suggests a model. Accepted exact-code catalogue compatibility can override a
misleading title generation. Catalogue model matching must be unambiguous within
each compatibility row; a bare family name does not identify its generation.
The matched code and compatibility text appear in the transfer result. Numeric
generation names such as `Golf 7` match Roman names such as `Golf VII`, but digits
inside an OE code such as `5G0907044BF` are not generation markers. A manual
vehicle selection remains authoritative. A model selected by exact-code data
uses that compatibility context for year lookup, not the conflicting title.

When the source offer and Ovoko model dictionary have no usable year and no saved
Ovoko car can be reused, preparation checks these account-scoped sources:

1. Allegro compatibility data, including exact-MPN catalogue matches.
2. Up to three other owned Allegro offers with the full part number, matching
   category, make, model and generation.
3. Up to two donor cars referenced by exact-code parts in the connected Ovoko stock.

The result is a technical year, not a claim about the actual donor vehicle. The
lowest evidenced year inside the selected model's bounds is used. Existing source
years, dictionary years, saved cars and manually entered years retain priority.
No year is guessed from a part number, engine capacity or price. Optional lookup
failures leave the manual year input available and do not fail other batch rows.

Public seller-page scraping is not implemented. This feature does not provide
unrestricted access to other sellers' listings. Reads use the connected account's
permissions; cached evidence is scoped to the owner, seller, Ovoko credentials,
offer, full code and selected model. Positive cache lifetime is five minutes.

The single-offer screen displays provenance and protects manual input against
late responses. Bulk preparation includes the evidence in its vehicle message.
The lookup itself never creates, edits or publishes an offer or donor car.

Offline verification: `test-ovoko-year-evidence.mjs`, `test-ovoko-year-api.mjs`
and `test-ovoko-year-browser.mjs`. Provider responses are mocked; these tests do
not publish real listings.
