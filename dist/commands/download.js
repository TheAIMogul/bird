// bird download — download a tweet's media (photos, videos, animated GIFs) to disk.
// Reuses TwitterClient.getTweet (and its highest-bitrate variant selection), then
// fetches each asset with Range-resume + atomic writes + 429-aware backoff.
import path from 'node:path';
import { TwitterClient } from '../lib/twitter-client.js';
import { selectMediaDownloads, downloadOne } from '../lib/media-download.js';

function humanBytes(n) {
    if (!Number.isFinite(n)) {
        return '?';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    let v = n;
    let u = 0;
    while (v >= 1024 && u < units.length - 1) {
        v /= 1024;
        u += 1;
    }
    return `${v.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
}

export function registerDownloadCommand(program, ctx) {
    program
        .command('download')
        .alias('dl')
        .description('Download a tweet\'s media (photos, videos, GIFs) to disk')
        .argument('<tweet-id-or-url>', 'Tweet ID or URL whose media to download')
        .option('-o, --out <dir>', 'Output directory', '.')
        .option('--include-quoted', 'Also download media from a quoted tweet')
        .option('--photos-only', 'Download photos only')
        .option('--videos-only', 'Download videos and animated GIFs only')
        .option('--json', 'Output a JSON manifest of downloaded files')
        .action(async (tweetIdOrUrl, cmdOpts) => {
        const opts = program.opts();
        const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
        const tweetId = ctx.extractTweetId(tweetIdOrUrl);
        const { cookies, warnings } = await ctx.resolveCredentialsFromOptions(opts);
        for (const warning of warnings) {
            console.error(`${ctx.p('warn')}${warning}`);
        }
        if (!cookies.authToken || !cookies.ct0) {
            console.error(`${ctx.p('err')}Missing required credentials`);
            process.exit(1);
        }
        const client = new TwitterClient({ cookies, timeoutMs });
        const result = await client.getTweet(tweetId, { includeRaw: false });
        if (!result.success || !result.tweet) {
            console.error(`${ctx.p('err')}Failed to read tweet: ${result.error}`);
            process.exit(1);
        }
        let plan = selectMediaDownloads(result.tweet, { includeQuoted: Boolean(cmdOpts.includeQuoted) });
        if (cmdOpts.photosOnly) {
            plan = plan.filter((m) => m.type === 'photo');
        }
        if (cmdOpts.videosOnly) {
            plan = plan.filter((m) => m.type === 'video' || m.type === 'animated_gif');
        }
        if (plan.length === 0) {
            if (cmdOpts.json) {
                console.log(JSON.stringify({ tweetId, downloaded: [], failed: [] }, null, 2));
                return;
            }
            console.log('No downloadable media found on this tweet.');
            return;
        }
        const downloaded = [];
        const failed = [];
        for (const item of plan) {
            const dest = path.resolve(cmdOpts.out || '.', item.filename);
            if (!cmdOpts.json) {
                console.error(`${ctx.p('info')}${item.type} -> ${item.filename}`);
            }
            const res = await downloadOne({ url: item.url, dest, timeoutMs });
            if (res.ok) {
                downloaded.push({ file: dest, type: item.type, bytes: res.bytes, resumed: res.resumed, url: item.url });
                if (!cmdOpts.json) {
                    console.log(`${ctx.p('ok')}${item.filename} (${humanBytes(res.bytes)}${res.resumed ? ', resumed' : ''})`);
                }
            }
            else {
                failed.push({ url: item.url, type: item.type, error: res.error });
                if (!cmdOpts.json) {
                    console.error(`${ctx.p('err')}${item.filename}: ${res.error}`);
                }
            }
        }
        if (cmdOpts.json) {
            console.log(JSON.stringify({ tweetId, downloaded, failed }, null, 2));
        }
        if (failed.length > 0) {
            process.exit(1);
        }
    });
}
