# Ovoko Suggested Vehicles: Verified Read Contract

Observed 2026-11-22 in the seller's existing Ovoko browser session. No cars or parts were saved, updated or published during investigation.

## Panel Endpoint

`GET /api/v1/fitting-vehicles?partCode={completeCode}&page=1&itemsPerPage=30`

This is a seller-panel endpoint on the tenant's `*.rrr.lt` domain, not the documented `api.rrr.lt` integration API. The browser's public client modules use a Bearer JWT. An unauthenticated server request to the observed tenant endpoint returns HTTP 401 with `JWT Token not found`. Requesting the same path on `api.rrr.lt` returns `Method not accessible.` The documented integration Swagger does not list this resource. Do not silently substitute integration credentials or copy browser cookies into production.

The official front-end source confirms its requests use the panel client:

- https://fe-assets.rrr.lt/client/assets/routes-COV8--92.js
- https://fe-assets.rrr.lt/client/assets/cars-BE4zukPK.js
- https://fe-assets.rrr.lt/client/assets/axiosConfig-BsTodcIx.js
- Integration specification: https://api.rrr.lt/openapi/swagger.yaml

## Response Shape

The response is a Hydra collection with `hydra:totalItems` and `hydra:member`. A suggested record has `model.id`, `model.name`, `model.year_start`, `model.year_end`, and `model.car_manufacturer.id/name`. The outer car ID can be **0**: it is not an existing donor car owned by the seller. Extracting a suggestion must never set `car_id=0` or treat another seller's donor as the current account's car.

For full code `9821908880` the observed first page reported 90 total suggestions, including Peugeot model ID 1197 (308, 2013-2021). This observation is not a hard-coded fitment rule, and must not be generalized to other part numbers or shortened suffixes.

## Integration Boundary

Before enabling a server-side Ovoko suggestion reader, establish a supported authentication contract for this resource with Ovoko. The saved username/password/user_token integration contract alone has not been verified to authorize it. Keep seller/account isolation and use only fixed provider-owned endpoints. Never put a panel JWT, password or session cookie in source code, logs, URLs or browser local storage.

The current implementation therefore continues to use the existing authorized Allegro read API. Its exact-number catalogue enrichment is covered by regression tests for titles, vehicle parameters, later results, similar categories, fallback phrase search, leading zeros, suffix mismatch, and unrelated makes. This does not claim the panel endpoint is already integrated or that every live radio has been matched.

## Category Suggestions (2026-11-23)

Observed in the existing authenticated seller form through Chrome Network:

`GET /api/v1/ovoko-marketplace-category-suggestions?partCode=9821908880`

The response is a Hydra collection (`hydra:totalItems: 5`, `hydra:member`). Each member has numeric `id`, `level`, `title`, nested `parent`, and optional `dimensions`. The first member was category **1277**, `Panel / Radioodtwarzacz CD/DVD/GPS`, level 3, parent 1276, root 999. This confirms the panel's number lookup is a separate function from our title-based dictionary ranking. Do not generalize this one observed number to all codes or invent an integration authentication contract. No cookies or JWTs were copied, no parts were submitted, and the original draft number was restored after the read.

The integration Swagger does not document a suggestion operation or a `partCode` parameter. Access with the integration credentials is not established; no such credentials were sent to the panel endpoint. Local ranking now prefers the specific panel/radio category over a generic Radio leaf when both are in the dictionary. This remains a title-based fallback, not integration of this endpoint.
