# Free technical year hints

No database migration or paid catalogue key is required.

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
