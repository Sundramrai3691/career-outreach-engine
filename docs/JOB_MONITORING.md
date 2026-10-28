# Job monitoring behavior

## Sources and watchlist

Companies become part of the job watchlist when a user starts a discovery run. Contact-only companies are not counted as watchlist entries. Hosted boards are configured with `JOB_BOARD_REGISTRY`; each entry must identify the confirmed company domain, provider, and board identifier. Official careers pages are checked as a separate source when a public company domain or same-company careers URL is available.

Each company/source pair is stored in `CompanyJobSource`. A source is marked validated only after its public endpoint or official page returns a parseable successful response. A failed, rate-limited, blocked, or unsupported response remains visible as such. The coverage endpoint divides companies with at least one validated source by the count of watchlisted companies and returns that denominator alongside the percentage.

## Job identity and changes

The identity key uses the provider plus its stable external posting ID when available. If a provider has no stable ID, the canonical posting URL is used after removing fragments and known tracking parameters. URL identity can split one job into two records if the employer changes its URL; provider IDs can also be reused or reset by the provider.

Material changes are based on title, location, and normalized description text. Every new, updated, reopened, and confirmed removed transition has a `JobOpeningEvent` record. Unchanged observations update last-seen and last-checked timestamps without an event. Jobs absent in one complete source scan are retained; a job is marked removed after two successful scans of that same source do not include it. Any blocked, rate-limited, or failed source makes the run incomplete and skips removal detection for that run. An unsupported source does not count as a successful scan and cannot itself cause removals.

## Candidate fit

The saved candidate profile supports target/excluded roles, technical/required skills, graduation year and eligibility range, experience levels, locations, remote preference, and excluded locations. Required skills, excluded roles/locations, explicit conflicting graduation eligibility, and remote-only mismatch are hard exclusions. Target-role matching contributes to ranking, but a title-only match is labeled `needs_review`; it does not confirm candidate eligibility. Missing posting evidence remains “not stated.” Matching is literal and rule-based, not semantic; the score is an explainable signal for review rather than an eligibility guarantee.

## Operation and limits

The Prisma schema includes new tables and fields for sources, scan history, job lifecycle events, and candidate profiles. Apply it to the intended runtime database with `npm run db:push` from the repository root before using these features. This task did not apply the schema to the configured database so existing local data would not be changed implicitly.

Scans are currently user-triggered. There is no recurring scheduler, durable worker queue, cross-process lock, or production monitor. Runs execute asynchronously inside the API process and can be interrupted if that process stops. Do not describe the local application as continuously monitoring jobs. Scheduling is deferred until source validation, change tracking, and matching have been proven in an always-on deployment.

This milestone supports Greenhouse, Lever, and bounded official careers-page parsing only. It does not resolve board identifiers automatically, crawl external ATS pages from the official-site fallback, or cover companies using Ashby, SmartRecruiters, Workday, or other ATS products. Coverage only reflects the explicit watchlist and source scans recorded by this application.

## Live validation record

As of 2026-10-28, the browser research check confirmed that Figma's official careers page links postings to the Greenhouse board token `figma` (including a live Software Engineer Intern (Summer 2027) posting). Spotify's careers guidance identifies `jobs.lever.co/spotify` as its Lever-hosted application URL. These sources establish the identifiers to use; they do not count as application-level live validation.

The application runtime attempted these unauthenticated requests: Greenhouse `https://boards-api.greenhouse.io/v1/boards/figma/jobs?content=true`, Lever `https://api.lever.co/v0/postings/spotify?mode=json`, and official page `https://www.figma.com/careers/`. Node's `fetch` returned `fetch failed` for all three without receiving an HTTP status. Therefore no live postings were returned by the application, no live job records were persisted, and no live repeat-scan outcome or source coverage percentage is claimed. The failure does not establish whether the blocker is network policy, DNS, TLS, or a transient connection issue. Re-run this validation from an environment with outbound HTTPS access before enabling monitoring.
