# Security Policy

## Supported Versions

Only the latest state of `main` and the most recent GitHub release receive
security fixes. Older tags and the `demo-v1` media assets are snapshots —
upgrade to `main` before reporting.

| Version       | Supported          |
| ------------- | ------------------ |
| `main` (latest) | :white_check_mark: |
| Latest release  | :white_check_mark: |
| Older tags      | :x:                |

## Reporting a Vulnerability

**Use [private vulnerability reporting](https://github.com/shridhargsabat/itms/security/advisories/new).**
Do not open a public issue, discussion, or PR for a suspected vulnerability.

Include in your report:

- Affected component and version/commit (e.g. `backend/src/routes/auth.rs @ a1b2c3d`)
- Steps to reproduce (curl commands or a minimal script beat prose)
- Impact: what an attacker gains (read/modify/delete whose data, which privilege boundary crossed)
- Suggested fix, if you have one (optional)

What happens next:

1. **Acknowledgement** within 7 days.
2. **Triage + fix** on `main`; you get credit in the release notes unless you ask otherwise.
3. **Coordinated disclosure** — details stay private until a fix is released, then the advisory is published.

## Scope

In scope:

- `backend/` (Rust/axum API, auth, sessions, SQL via sqlx)
- `frontend/` (React SPA, auth flows, XSS/sensitive-data exposure)
- `docker-compose.yml`, `Dockerfile`s, `.github/workflows/ci-cd.yml` (supply chain, secrets handling)
- The live demo deployment's *application behavior* (https://itms.ai-automation-hub.tech)

Out of scope (will be closed as informative, still appreciated):

- The seeded demo credentials (`demo1234`) and seeded demo data — public by design
- `localhost`/dev-stack instructions using throwaway passwords
- Missing hardening headers/rate limits on the demo host unless they enable account/data compromise
- Dependency scanner findings without a reachable exploit path (Dependabot already files these weekly)

## Security posture (already enabled)

- Private vulnerability reporting, Dependabot security updates, secret scanning + push protection
- CI supply-chain gates (pinned actions/images) in `.github/workflows/ci-cd.yml`

Thank you for reporting responsibly.
