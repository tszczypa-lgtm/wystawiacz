# Email confirmation redirects

In Supabase Dashboard > Authentication > URL Configuration:

- Site URL: `https://wystawiacz.tszczypa.workers.dev`
- Redirect URLs: add the exact `https://wystawiacz.tszczypa.workers.dev/login`

The signup form requests `/login`. Supabase must allow that URL; otherwise
the project's configured Site URL may be used. Changing the application does
not update these dashboard settings. Check the destination domain and path of
any broken email link without sharing its query string or fragment (tokens).

Keep the confirmation email button pointed at `{{ .ConfirmationURL }}` as in
`email-confirmation.html`; a plain SiteURL link does not verify the email.
Do not disable email verification to work around a redirect error.

After signup, the form shows a waiting screen, not another signup form.
The login/root page initializes Supabase so its SDK can read the confirmation
session from the URL and redirects authenticated users to `/panel`. Its auth
listener also handles sessions received from another tab of the same browser
profile and origin. Other browsers/devices require logging in separately.

Reference: https://supabase.com/docs/guides/auth/redirect-urls
