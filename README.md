<h1 align="center">BirdGang 🐦‍⬛</h1>

<p align="center"><b>A fast, scriptable command line for X / Twitter.</b><br>
Read, post, reply, search, download media, and pull AI trend summaries — straight from your terminal, using your own browser session. No paid API, no developer account.</p>

---

## What is BirdGang?

BirdGang is a terminal-first X/Twitter client. It talks to X's internal web GraphQL API using the cookies already in your browser, so anything you can see while logged in, you can script:

```bash
bird whoami                              # who am I logged in as?
bird read https://x.com/jack/status/20   # read any tweet
bird search "from:nasa filter:images"    # search
bird tweet "shipped 🚀"                   # post
bird download <tweet-url> -o ~/Downloads  # save the media
bird grok-trends                          # what's trending + why (Grok summaries)
```

Everything prints clean text by default and structured JSON with `--json`, so it pipes nicely into `jq`, scripts, and agents.

> **Lineage & license.** BirdGang is a community fork of [`@steipete/bird`](https://www.npmjs.com/package/@steipete/bird) by **Peter Steinberger** (MIT). The original upstream repo was taken down and its npm package is frozen at v0.8.0; BirdGang continues the work with new commands and fixes. All original code © 2025 Peter Steinberger — see [`LICENSE`](./LICENSE). Maintained by [@TheAIMogul](https://github.com/TheAIMogul). The CLI command is still `bird` for muscle-memory and script compatibility.

## What BirdGang adds over the frozen v0.8.0

- **`download`** — save a tweet's photos, videos, and GIFs to disk (resumable, original-resolution).
- **`grok-trends`** — the latest trends *with* X's AI ("Grok") explanation of why each is trending.
- **Native Comet cookie source** — reads a live session from Comet (Perplexity's Chromium browser), tried first by default, so a fresh Comet login wins over a stale one in another browser.
- **`t.co` link expansion** — tweet text shows real URLs instead of opaque `t.co/...` shorteners, everywhere.
- **Profile enrichment** — `following`/`followers` surface bio handles, domains, companies, and org affiliation badges.
- **Tougher rate-limit handling** — backoff now honors X's `x-rate-limit-reset` header, not just `Retry-After`.
- **Self-healing query IDs** — X rotates its GraphQL query IDs; BirdGang auto-discovers fresh ones and caches them.

## Install

BirdGang isn't on npm (the `@steipete/bird` name is the frozen original). Install from this repo:

```bash
# Global install straight from GitHub — gives you the `bird` command
npm install -g github:TheAIMogul/bird

# …or clone and run the built CLI directly
git clone https://github.com/TheAIMogul/bird.git
cd bird
node dist/cli.js whoami
```

Requires **Node 18+** (developed on Node 26). The repo ships the compiled `dist/` build, so there's no build step to install.

## Authentication

BirdGang reads your existing X login cookies (`auth_token` + `ct0`) from your browser's cookie store — no passwords, no tokens to paste. Supported sources, tried in this default order: **Comet**, **Safari**, **Chrome/Chromium** (Arc, Brave, etc.), and **Firefox**. Comet is tried first so a fresh Comet session beats a stale token elsewhere.

```bash
bird whoami                              # auto-detects a logged-in browser (Comet first)
bird --cookie-source chrome whoami       # force a specific browser
bird --chrome-profile "Profile 1" whoami # pick a Chrome/Comet profile
bird --firefox-profile default-release whoami
```

You can also pass cookies explicitly when scripting:

```bash
bird --auth-token "$AUTH_TOKEN" --ct0 "$CT0" whoami
```

## Quickstart

```bash
# Identity
bird whoami

# Read
bird read https://x.com/user/status/1234567890123456789
bird 1234567890123456789 --json          # bare ID/URL is shorthand for `read`
bird thread <id>                         # full conversation thread
bird replies <id> --max-pages 3 --json

# Search & mentions
bird search "from:steipete" -n 10
bird mentions -n 5
bird mentions --user @steipete -n 5

# Timelines
bird home -n 20                          # For You
bird home --following -n 20              # Following feed
bird user-tweets @nasa -n 50 --json
bird list-timeline https://x.com/i/lists/123 --all --json

# Post & engage
bird tweet "hello from BirdGang"
bird reply <id> "nice thread"
bird tweet "with a pic" --media ./photo.jpg --alt "a sunset"

# Social graph
bird following -n 20
bird followers --user 12345678 -n 10
bird follow @someone
bird unfollow @someone

# Bookmarks & likes
bird bookmarks --all --json
bird unbookmark <id>
bird likes -n 5
```

## Featured commands

### `download` — save a tweet's media

Downloads the photos, videos, and animated GIFs on a tweet. Videos use the highest-bitrate MP4 variant; photos are fetched at original resolution. Downloads resume if interrupted (re-run the same command), write atomically, and back off on rate limits.

```bash
bird download https://x.com/user/status/1234567890123456789
bird dl <id> -o ~/Downloads          # alias + output directory
bird download <id> --videos-only     # videos/GIFs only
bird download <id> --photos-only     # photos only (original resolution)
bird download <id> --include-quoted  # also grab a quoted tweet's media
bird download <id> --json            # JSON manifest of saved files
```

### `grok-trends` — trends with their AI summaries

X's trend pages include a Grok-generated summary of *why* something is trending. BirdGang surfaces it from the CLI:

```bash
bird grok-trends            # latest trends + Grok summaries
bird grok-trends -n 5       # cap the count
bird grok-trends --json     # structured output
bird trend-summaries        # alias
```

### `news` — AI-curated headlines

```bash
bird news --ai-only -n 20
bird news --sports --entertainment -n 15
bird news --with-tweets --tweets-per-item 3 -n 10
bird news --json-full --ai-only -n 10   # includes raw API response
```

Tab filters (combinable): `--for-you`, `--news-only`, `--sports`, `--entertainment`, `--trending-only`. By default it pulls For You + News + Sports + Entertainment and de-duplicates headlines.

## JSON output

Add `--json` to any read command for structured output: `read`, `replies`, `thread`, `search`, `mentions`, `bookmarks`, `likes`, `following`, `followers`, `about`, `lists`, `list-timeline`, `user-tweets`, `news`, `grok-trends`, `query-ids`, and `download`. Add `--json-full` (tweet/news commands) to include the raw API response under `_raw`.

```bash
bird search "from:nasa" -n 5 --json | jq '.[].text'
bird download <id> --json | jq '.downloaded[].file'
```

## Library usage

BirdGang is also importable — the same GraphQL client the CLI uses:

```ts
import { TwitterClient, resolveCredentials } from 'birdgang';

const { cookies } = await resolveCredentials({ cookieSource: 'comet' });
const client = new TwitterClient({ cookies });

const search = await client.search('from:steipete', 50);
const news = await client.getNews(10, { aiOnly: true });
```

## Configuration

BirdGang reads JSON5 config from `~/.config/bird/config.json5` (global) and `./.birdrc.json5` (per-project). Supported keys: `chromeProfile`, `chromeProfileDir`, `firefoxProfile`, `cookieSource`, `cookieTimeoutMs`, `timeoutMs`, `quoteDepth`.

Environment variables: `NO_COLOR`, `BIRD_TIMEOUT_MS`, `BIRD_COOKIE_TIMEOUT_MS`, `BIRD_QUOTE_DEPTH`, `BIRD_QUERY_IDS_CACHE`.

Self-healing GraphQL query IDs are cached at `~/.config/bird/query-ids-cache.json` (24h TTL). Force a refresh:

```bash
bird query-ids --fresh
```

## Command reference

| Command | Description |
|---|---|
| `whoami` | Show the logged-in account |
| `read <id\|url>` · `<id\|url>` | Read a tweet (bare ID/URL is shorthand) |
| `thread <id\|url>` | Full conversation thread |
| `replies <id\|url>` | Replies to a tweet (paginated) |
| `search "<query>"` | Search tweets |
| `mentions` | Your mentions (or `--user`'s) |
| `home` | Home timeline (`--following` for the Following feed) |
| `user-tweets <@user>` | A user's profile timeline |
| `list-timeline <id\|url>` | Tweets from a List |
| `lists` | Your Lists |
| `tweet "<text>"` | Post a tweet (`--media`, `--alt`) |
| `reply <id\|url> "<text>"` | Reply to a tweet |
| `following` · `followers` | Social graph (with bio/affiliation enrichment) |
| `follow` · `unfollow` | Manage follows |
| `bookmarks` · `unbookmark` | Bookmarks |
| `likes` | Your liked tweets |
| `news` | AI-curated headlines |
| `grok-trends` · `trend-summaries` | Trends with Grok summaries |
| `download` · `dl` | Save a tweet's media to disk |
| `about <@user>` | Account origin/location metadata |
| `query-ids [--fresh]` | Inspect/refresh cached GraphQL query IDs |
| `help [command]` | Help for any command |

Run `bird <command> --help` for the full flag list of any command.

## Development & tests

```bash
node tests/feature-tests.mjs   # offline unit/integration tests for the fork's features
node dist/cli.js --help        # browse the CLI
```

The repo ships compiled `dist/` ESM; new features are added as hand-authored modules under `dist/` and wired into `dist/cli/program.js`.

## Disclaimer

BirdGang uses X/Twitter's **undocumented** web GraphQL API with cookie auth. X can change endpoints, rotate query IDs, and adjust anti-bot behavior at any time — **expect things to break without notice.** Use responsibly and within X's terms; you are responsible for how you use your own account.

## License

MIT. Original code © 2025 Peter Steinberger; BirdGang fork maintained by [@TheAIMogul](https://github.com/TheAIMogul). See [`LICENSE`](./LICENSE).
