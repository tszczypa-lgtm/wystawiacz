# Allegro Title Suggestions

Title suggestions use only Allegro's product catalog, queried by the complete
part number using MPN mode through the seller's existing server-side connection.
The endpoint returns up to four distinct titles. If fewer matches exist, it
returns fewer: missing candidates are never invented. One full part number is
reserved at the end of each suggestion within Allegro's 75-character limit.

Google, SerpApi and AI analysis have been removed. No calls to these providers
are made, regardless of any old secrets still present in Cloudflare. You may
remove unused OPENAI_API_KEY, OPENAI_PART_MODEL and SERPAPI_API_KEY settings;
do not remove Allegro or Supabase configuration. Provider subscriptions and
billing settings must be managed separately; a code change does not cancel them.

## Choosing Titles

With no mode selected, type manually and no suggestion search is sent.
The mutually exclusive full-title and part-only checkboxes are remembered
in this browser. Part-only mode recognizes common component names; choose the
vehicle from your own list. If a name cannot be recognized, switch to full-title
mode to view the catalog result. Proposals are never selected automatically.
Recognized technical and position qualifiers are kept when adjacent in the
source title, e.g. `Czujnik parktronik PDC`, `Czujnik polozenia walu korbowego`
or `Lewy przedni czujnik ABS`. Extraction stops before unknown vehicle tokens
and identifiers. Missing synonyms/specifications are never invented.

The separate append action composes names such as
`Pompa ABS + Sterownik ABS VW Tiguan 5NA803881F`. It preserves the selected
vehicle, manual description and full number, avoids repeated identical names,
and does not silently truncate. Only combine components actually sold together.

The remembered CAPS checkbox changes the actual title. The counter includes
spaces. Saving over 75 characters is blocked; publishing also checks the minimum
12 characters and three words. The title occupies the full width of its own
row, with append and source controls underneath.

## Requests and Tests

Successful results are cached per owner and number for five minutes, with up
to eight uncached requests per user/minute in each Worker instance. Failures
are not cached. The catalog request has a ten-second timeout and errors do
not expose credentials. Existing account and subscription guards still apply.

Run `scripts/test-title-suggestions.mjs` and
`scripts/test-title-suggestions-browser.mjs` for four-result caps,
deduplication, fewer/empty results, modes, source rendering, layout, append,
caching, failed calls and a regression assertion that no paid provider is
called. Tests use mocked catalog responses, not live seller requests.
