# Tier 1 + Tier 2 feature adds — plan

Scope chosen by user: **High-value additive.** Skip redundant T1#1 (query-id rotation already
exists in `lib/runtime-query-ids.js`, more advanced than bird-rs) and N/A T1#3 (JSON
control-char parsing was a birdclaw-stdout concern). Skip low-value SSRF unfurler.

This repo ships **compiled `dist/` ESM only** (no `src/`). New features are authored as
hand-written `.js` modules (the `grok-trends.js` precedent) and wired into `dist/`.

## Build

- [x] **T2#4 — `bird download` command** (the standout, genuinely new)
  - [x] `dist/lib/media-download.js` — pure: `selectMediaDownloads(tweet)`, `isSafeMediaHost(url)`,
        `filenameFor(...)`, `computeBackoffMs(...)`; impure: `downloadOne(...)` with HTTP Range
        resume, atomic `.part`→rename, 429/5xx backoff honoring `x-rate-limit-reset`/`retry-after`.
  - [x] `dist/commands/download.js` — `registerDownloadCommand(program, ctx)`; reuses
        `TwitterClient.getTweet` + existing highest-bitrate variant selection.
  - [x] wire into `dist/cli/program.js` (import, register, KNOWN_COMMANDS: `download`, `dl`).
- [x] **T2#5 — t.co URL expansion** in tweet output (new; mapper currently prints raw `full_text`)
  - [x] `dist/lib/url-expand.js` — pure `expandShortUrls(text, urls)`.
  - [x] patch `extractTweetText` in `dist/lib/twitter-client-utils.js` to expand via
        `legacy.entities.urls` (universal across read/thread/search/timeline; safe no-op when absent).
- [x] **T2#7 — affiliation + bio enrichment** (cheap, pure)
  - [x] `dist/lib/profile-enrich.js` — pure `extractBioEntities(desc)`, `normalizeAffiliation(rawUser)`.
  - [x] surface bio entities + affiliation in `printUsers` (`dist/commands/users.js`); add
        `affiliation` to mapped user in `parseUsersFromInstructions`.
- [x] **T1#2 — `x-rate-limit-reset`-aware backoff** (enhance existing partial impl)
  - [x] upgrade `fetchWithRetry` in `dist/lib/twitter-client-timelines.js` to honor
        `x-rate-limit-reset` (absolute epoch) in addition to `retry-after`.

## Test
- [x] `tests/feature-tests.mjs` — unit tests for all pure functions (no network).
- [x] CLI smoke: `node dist/cli.js --help`, `download --help`, command registration.
- [x] download integration against a local fixture HTTP server (Range, resume, atomic).

## Report
- [x] Update README.md (download command + URL expansion notes) and CHANGELOG.md.
- [x] Summary of what shipped vs. what was already present.
