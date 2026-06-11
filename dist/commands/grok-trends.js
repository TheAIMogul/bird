// bird grok-trends — latest X trends WITH their Grok-generated summaries.
// Reverse-engineered from x.com internal GraphQL (no paid API):
//   ExplorePage  (LOLkOnxrvpJzJwyZ7748Bw) -> curated AI-trend rest_ids (stories-*-trend-<id>)
//   TrendHistory (7oYkOMFMRfqdwOec9D7wlw) {trendId} -> grok_story headerText + bodyText
const BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const EXPLORE_PAGE = 'LOLkOnxrvpJzJwyZ7748Bw';
const TREND_HISTORY = '7oYkOMFMRfqdwOec9D7wlw';

async function gql(qid, op, variables, cookies, timeoutMs) {
    const url = `https://x.com/i/api/graphql/${qid}/${op}`
        + `?variables=${encodeURIComponent(JSON.stringify(variables))}&features=%7B%7D`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs ?? 15000);
    try {
        const res = await fetch(url, {
            headers: {
                authorization: BEARER,
                'x-csrf-token': cookies.ct0,
                'x-twitter-active-user': 'yes',
                'x-twitter-auth-type': 'OAuth2Session',
                'x-twitter-client-language': 'en',
                'content-type': 'application/json',
                'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
                cookie: `auth_token=${cookies.authToken}; ct0=${cookies.ct0}`,
            },
            signal: controller.signal,
        });
        if (!res.ok) {
            return { error: `HTTP ${res.status}` };
        }
        return { data: await res.json() };
    }
    catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
    finally {
        clearTimeout(t);
    }
}

function storyTrendIds(explore) {
    const blob = JSON.stringify(explore);
    const ids = [];
    const seen = new Set();
    const re = /stories-\d+-trend-(\d{17,20})/g;
    let m;
    while ((m = re.exec(blob)) !== null) {
        if (!seen.has(m[1])) {
            seen.add(m[1]);
            ids.push(m[1]);
        }
    }
    return ids;
}

function extractSummary(history) {
    const instr = history?.data?.ai_trend_by_rest_id?.result?.trend_history?.timeline?.instructions;
    if (!Array.isArray(instr)) {
        return null;
    }
    for (const ins of instr) {
        for (const e of ins.entries ?? []) {
            const c = e?.content?.itemContent?.content;
            if (c && (typeof c.bodyText === 'string' || typeof c.headerText === 'string')) {
                return { title: c.headerText ?? null, summary: c.bodyText ?? null };
            }
        }
    }
    return null;
}

export function registerGrokTrendsCommand(program, ctx) {
    program
        .command('grok-trends')
        .alias('trend-summaries')
        .description('Fetch the latest trends WITH their AI (Grok) summaries')
        .option('-n, --limit <number>', 'Max trends to summarize', '10')
        .option('--json', 'Output as JSON')
        .action(async (cmdOpts) => {
        const opts = program.opts();
        const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
        const limit = Number.parseInt(cmdOpts.limit || '10', 10);
        const { cookies, warnings } = await ctx.resolveCredentialsFromOptions(opts);
        for (const warning of warnings) {
            console.error(`${ctx.p('warn')}${warning}`);
        }
        if (!cookies.authToken || !cookies.ct0) {
            console.error(`${ctx.p('err')}Missing required credentials`);
            process.exit(1);
        }
        const explore = await gql(EXPLORE_PAGE, 'ExplorePage', {}, cookies, timeoutMs);
        if (explore.error) {
            console.error(`${ctx.p('err')}Failed to fetch trends: ${explore.error}`);
            process.exit(1);
        }
        const ids = storyTrendIds(explore.data).slice(0, Number.isNaN(limit) ? 10 : limit);
        if (ids.length === 0) {
            console.error(`${ctx.p('err')}No story-trends found (auth may be expired or no curated trends right now).`);
            process.exit(1);
        }
        const results = [];
        for (const id of ids) {
            const h = await gql(TREND_HISTORY, 'TrendHistory', { trendId: id }, cookies, timeoutMs);
            if (h.error) {
                continue;
            }
            const s = extractSummary(h.data);
            if (s) {
                results.push({ trend_id: id, title: s.title, summary: s.summary });
            }
        }
        if (cmdOpts.json) {
            console.log(JSON.stringify(results, null, 2));
            return;
        }
        if (results.length === 0) {
            console.log('No trend summaries found.');
            return;
        }
        for (const r of results) {
            console.log(`\n${ctx.colors.accent('🔥')} ${ctx.colors.command(r.title ?? '(untitled trend)')}`);
            if (r.summary) {
                console.log(`  ${ctx.colors.muted(r.summary)}`);
            }
            console.log(`  ${ctx.l('url')}https://x.com/i/trending/${r.trend_id}`);
            console.log(ctx.colors.muted('─'.repeat(50)));
        }
    });
}
//# sourceMappingURL=grok-trends.js.map
