# Manual Transfer Repair (021)

Apply `supabase/021_ovoko_manual_overrides.sql` after migrations 012 through 020, before deploying this revision. Migration 021 adds a vehicle attempt generation and an immutable service-only audit journal. Do not delete publication or vehicle journals manually. Pause both synchronization directions before resolving an old lock; pending leases/writes must finish first.

## User Flow

- `Do Ovoko` on an Allegro inventory row opens the manual preparation form in a separate window. A blocked popup leaves an actionable message/link.
- Bulk validation reports missing fields. A missing model alone asks only for the model (and make if unknown), preserving the recognized leaf category on the explicit correction request. Backend dictionaries and source ownership are checked again.
- Every row error (including 409, 503, HTML and lost responses) is recorded without automatically retrying its possible write. The queue continues independent rows, even after consecutive failures. Authentication/access revocation or account changes stop it; a rate limit pauses subsequent rows for 60 seconds. The user may explicitly stop it.
- An uncertain row is not an invitation to resend it: inspect Ovoko first. The manual form offers an explicit old-lock decision for either the part or selected model/year.
- The form has two direct actions: unlock this offer or unlock the selected vehicle. Each requires one explicit confirmation dialog, with no typed ID, reason or checkbox checklist. The server still creates a scoped five-minute preview and records a fixed, truthful manual-consent audit reason. Existing locks must be at least 30 minutes old; fresh writes are not interrupted. Legacy clients with the previous confirmation fields remain supported.
- A found existing record is reconciled instead of duplicated. If the part exists by its exact external ID but its local publication journal is missing, the same action uses the existing link-recovery workflow (migration 020); the user need not find and enter IDs. Conflicting/multiple records and live synchronization remain guarded. A missing lock and absent part simply unlock the local form for an explicit new publish click. No provider record is created or deleted by these actions.
- The audit and journal change are atomic. Concurrent changes, fresh operations, active foreign ownership/synchronization, pending recovery plans, changed credentials and conflicting known part IDs block the decision. A lost DB acknowledgment is resolved idempotently by the same preview token.
- After a successful decision, the user separately clicks the ordinary publish button. All publication validations remain enabled. Do not automatically resume synchronization after this procedure.

## Verification

Local fixtures cover API guards, SQL CAS/audit/role enforcement, model-only correction, HTML isolation/continuation, no replay, manual popup and explicit override confirmation. No production database migration or provider publication is performed by these tests. This change does not certify unattended synchronization for commercial use; existing readiness gates still apply.
