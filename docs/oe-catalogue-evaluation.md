# OE Number To Vehicle Years

## Recommendation

Evaluate TecAlliance TecDoc Web Service with the OE data scope, rather than
buying a catalogue browser subscription and assuming it includes API access.
The documented flow is OE search -> matching articles -> vehicle linkages.
Vehicle linkages can include production start/end dates. Coverage for original
used electronic modules must be tested; there is no verified 100% coverage claim.

Official sources checked on 2026-11-25:

- https://www.tecalliance.net/products?solution=catalogue-ecommerce
- https://www.tecalliance.net/products?highlight=vio-data&solution=data-insights
- https://developer.tecalliance.cn/en/introduction/
- https://developer.tecalliance.cn/en/tecdoc-api/function/part-linkage-search/index.html
- https://cdn-catalog.tecalliance.cn/catalog/tecalliance/en//download/pdf/tecdoc-global-catalogue-help-1626228641.pdf

The developer examples describe OneDB regional offerings. Confirm which
European product, endpoints and licence apply before implementing an adapter.
The catalogue help explicitly distinguishes ordinary article-to-vehicle links
from direct OE-number-to-vehicle data services.

## Sales Enquiry

We are developing a multi-user SaaS application for sellers of used automotive
parts in Poland and other European markets. We need licensed API access that
maps a complete OE/OEM part number to compatible vehicle makes, model series,
generations and production date ranges. Our stock includes original electronic
modules, door controllers, parking controllers, multimedia and airbag modules.

Please confirm:

1. Which TecDoc/OE data product provides this mapping for European vehicles?
2. Can you demonstrate coverage on our sample numbers below before purchase?
3. Does the response preserve multiple possible vehicles, date restrictions,
   supersessions and the exact number matched, including suffix letters?
4. Which API, authentication, rate limits and update frequency apply?
5. What are the SaaS/multi-tenant usage terms, caching permissions and pricing?
6. Can customers see the resulting fitment data in their sales listings?

Initial test numbers from our transfer examples:

- A2129004202
- A1669000518
- A0009001708
- A1645457716
- JPLA-14D618-BA / JPLA14D618BA
- DV4T-15K866-BJ / DV4T15K866BJ
- 8K0959793R
- 4M1959795B
- 5Q0959812D
- 5K0907044DT
- 1K8907044CH
- 98340416ZD
- 9800410080
- 9664661580

We want a supported commercial integration, not scraping authenticated catalogue
pages. Please provide a trial or sample response set before an annual commitment.

## Integration Rules

- Normalize spaces/hyphens for lookup, preserve the full suffix and original code.
- An OE number can fit multiple generations and date ranges. Never select the
  first search result without matching the offer's known make and generation.
- Store the matched number, provider, vehicle identifiers, date range and lookup
  time, subject to the purchased licence's caching conditions.
- Production/application years are not the actual donor vehicle's build year.
  Label a technical catalogue year as such; use the donor VIN/record when known.
- Reuse already verified Ovoko model/car data before another paid lookup.
- Missing coverage or contradictory results must remain visible for confirmation.
  Do not fabricate a donor year from the part-number prefix or a web snippet.

No external catalogue API has been connected or purchased by this change.
