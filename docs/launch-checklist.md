# Arring launch checklist

## Automated release gate

- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm run test:matching`
- `npm run test:matching:http` while the local server is running
- `npm run test:images`
- `npm run test:characters`
- `supabase db lint --linked --level warning`
- `npm audit --omit=dev --audit-level=high`
- `npm run backup:verify`

Pull requests and pushes to `main` also run lint, type checking, and a production build in GitHub Actions.

## Production smoke test

- Confirm `https://a2rring.com/api/health` returns HTTP 200 with `status: ok` and `database: ok`.
- Confirm the home, service guide, privacy, terms, contact, login, and signup pages load without console errors.
- Confirm unauthenticated visitors can browse public pages and character search, while linking a character and matching require login.
- Run a five-person match: queue, proposal, accept, room entry, chat, nickname copy, and cancellation/requeue.
- Confirm inquiry, direct-message, and room images are visible only to authorized users.
- Confirm an admin can read and answer an inquiry and manage dungeon categories and tiers.
- Check Vercel Runtime Logs for `uncaught_request_error`, `health_check_failed`, and `rate_limit_check_failed`.

## External console checks

- Supabase Auth: email confirmation enabled, production redirect URLs registered, and custom SMTP delivery tested.
- Supabase: owner accounts use MFA and security/performance advisors have no unresolved critical findings.
- Vercel: production environment variables are present, billing alerts are enabled, and the latest deployment is Ready.
- GitHub: protect `main` and require the CI workflow before merging.
- Google Search Console: apex domain is canonical, sitemap is accepted, and important public URLs are indexed.
- Ad platform: publish a real `ads.txt` entry only after an account and publisher ID are approved.

## Operations and recovery

- The database backup cron runs at `00:00 KST` and `/api/cron/backup` is protected by `CRON_SECRET`.
- Verify a recent backup with `npm run backup:verify` after schema changes and at least monthly.
- Roll application regressions back by promoting the previous Ready Vercel deployment.
- Never roll database migrations back blindly; add a corrective forward migration after checking data compatibility.
- Voice calls intentionally use STUN only. Users behind restrictive NAT may fail to connect because TURN is disabled by service policy.
