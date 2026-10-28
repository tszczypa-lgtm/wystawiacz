-- Read-only: this does not grant admin or sandbox permissions.
select id as reviewer_id, email, email_confirmed_at
from auth.users
where lower(email) = 'tpaytest@tymogarage.pl';
