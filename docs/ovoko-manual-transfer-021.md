# Manual Transfer Repair (021)

Apply `supabase/021_ovoko_manual_overrides.sql` after migrations 012 through 020, before deploying this revision. Migration 021 adds a vehicle attempt generation and an immutable service-only audit journal. Do not delete publication or vehicle journals manually. Pause both synchronization directions before resolving an old lock; pending leases/writes must finish first.

## User Flow

- `Do Ovoko` on an Allegro inventory row opens the manual preparation form in a separate window. A blocked popup leaves an actionable message/link.
- Bulk validation reports missing fields. A missing model alone asks only for the model (and make if unknown), preserving the recognized leaf category on the explicit correction request. Backend dictionaries and source ownership are checked again.
- HTML/non-JSON or a lost response isolates that row, without automatically retrying its possible write. The queue proceeds with other rows. Authentication, account changes, database errors, rate limits or three consecutive transport failures stop the queue.
- An uncertain row is not an invitation to resend it: inspect Ovoko first. The manual form offers an explicit old-lock decision for either the part or selected model/year.
- Old-lock decisions require a minimum age of 30 minutes, a fresh five-minute scoped preview, both confirmations, the typed auction ID and a reason. A found existing record is reconciled instead of duplicated. Otherwise the user deliberately accepts the absence uncertainty and retires the old journal entry. No provider record is created or deleted by this action.
- The audit and journal change are atomic. Concurrent changes, fresh operations, active foreign ownership/synchronization, pending recovery plans, changed credentials and conflicting known part IDs block the decision. A lost DB acknowledgment is resolved idempotently by the same preview token.
- After a successful decision, the user separately clicks the ordinary publish button. All publication validations remain enabled. Do not automatically resume synchronization after this procedure.

## Verification

Local fixtures cover API guards, SQL CAS/audit/role enforcement, model-only correction, HTML isolation/continuation, no replay, manual popup and explicit override confirmation. No production database migration or provider publication is performed by these tests. This change does not certify unattended synchronization for commercial use; existing readiness gates still apply.
