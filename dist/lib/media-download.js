// Media download helpers for `bird download`.
// Reuses the highest-bitrate variant already selected by twitter-client-utils
// (tweet.media[].videoUrl) and adds a resilient downloader: HTTP Range resume,
// atomic .part -> rename, and 429/5xx backoff honoring x-rate-limit-reset.
import { createWriteStream } from 'node:fs';
import { stat, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MAX_BACKOFF_MS = 15 * 60 * 1000;

// Only allow X/Twitter CDN hosts. Pure.
export function isSafeMediaHost(url) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return false;
    }
    if (parsed.protocol !== 'https:') {
        return false;
    }
    const host = parsed.hostname.toLowerCase();
    return host === 'pbs.twimg.com' || host === 'video.twimg.com' || host === 'ton.twimg.com' || host.endsWith('.twimg.com');
}

// Upgrade a pbs.twimg.com photo URL to its original-resolution form. Pure.
export function upgradePhotoUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.hostname.toLowerCase() === 'pbs.twimg.com' && parsed.pathname.startsWith('/media/')) {
            // `?name=orig` yields the full-resolution original.
            parsed.searchParams.set('name', 'orig');
            return parsed.toString();
        }
    }
    catch {
        // fall through
    }
    return url;
}

// Best file extension for a media item. Pure.
export function extForMedia(item) {
    if (item.type === 'video') {
        return 'mp4';
    }
    if (item.type === 'animated_gif') {
        return 'mp4'; // X serves animated GIFs as mp4
    }
    const source = item.videoUrl || item.url || '';
    try {
        const parsed = new URL(source);
        const fmt = parsed.searchParams.get('format');
        if (fmt) {
            return fmt.toLowerCase();
        }
        const ext = path.extname(parsed.pathname).replace('.', '').toLowerCase();
        if (ext) {
            return ext;
        }
    }
    catch {
        // fall through
    }
    return 'jpg';
}

// Pick the downloadable URL for one media item (photo -> url, video/gif -> videoUrl). Pure.
function downloadUrlForItem(item) {
    if (item.type === 'video' || item.type === 'animated_gif') {
        return item.videoUrl || item.url;
    }
    return upgradePhotoUrl(item.url);
}

// Flatten a tweet's media into a download plan. Pure.
// includeQuoted=true also pulls media from a quoted tweet.
export function selectMediaDownloads(tweet, options = {}) {
    const plan = [];
    const pushFrom = (t, prefix) => {
        const media = Array.isArray(t?.media) ? t.media : [];
        media.forEach((item, i) => {
            const url = downloadUrlForItem(item);
            if (!url) {
                return;
            }
            plan.push({
                url,
                type: item.type ?? 'photo',
                tweetId: t.id,
                index: i,
                filename: `${prefix}${t.id}-${i + 1}.${extForMedia(item)}`,
            });
        });
    };
    pushFrom(tweet, '');
    if (options.includeQuoted && tweet?.quotedTweet) {
        pushFrom(tweet.quotedTweet, 'quoted-');
    }
    return plan;
}

// Compute backoff (ms) for a retryable response. Pure (inject now/jitter for tests).
export function computeBackoffMs(opts) {
    const { status, headers, attempt, baseMs = 500, now = Date.now(), jitter = Math.random() } = opts;
    const getHeader = (name) => {
        if (!headers) {
            return null;
        }
        if (typeof headers.get === 'function') {
            return headers.get(name);
        }
        return headers[name] ?? headers[name.toLowerCase()] ?? null;
    };
    // X returns x-rate-limit-reset as an absolute epoch (seconds) on 429.
    if (status === 429) {
        const reset = getHeader('x-rate-limit-reset');
        const resetSec = reset ? Number.parseInt(reset, 10) : Number.NaN;
        if (Number.isFinite(resetSec)) {
            const waitMs = resetSec * 1000 - now + 1000; // +1s safety buffer
            if (waitMs > 0) {
                return Math.min(waitMs, MAX_BACKOFF_MS);
            }
        }
    }
    // Retry-After is delta-seconds (HTTP-date falls through to exponential backoff).
    const retryAfter = getHeader('retry-after');
    const retryAfterMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : Number.NaN;
    if (Number.isFinite(retryAfterMs)) {
        return Math.min(retryAfterMs, MAX_BACKOFF_MS);
    }
    const exp = baseMs * 2 ** attempt + Math.floor(jitter * baseMs);
    return Math.min(exp, MAX_BACKOFF_MS);
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

// Download one URL to dest with Range resume + atomic rename + backoff.
// Returns { ok, bytes, resumed, status?, error? }.
export async function downloadOne(opts) {
    const { url, dest, timeoutMs, maxRetries = 4, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), headers = {} } = opts;
    if (!isSafeMediaHost(url)) {
        return { ok: false, bytes: 0, resumed: false, error: `unsafe media host: ${url}` };
    }
    const partPath = `${dest}.part`;
    await mkdir(path.dirname(dest), { recursive: true });
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        // Resume from an existing .part if present.
        let startByte = 0;
        try {
            const st = await stat(partPath);
            startByte = st.size;
        }
        catch {
            startByte = 0;
        }
        const reqHeaders = { ...headers };
        if (startByte > 0) {
            reqHeaders.range = `bytes=${startByte}-`;
        }
        let controller;
        let timer;
        if (timeoutMs && timeoutMs > 0) {
            controller = new AbortController();
            timer = setTimeout(() => controller.abort(), timeoutMs);
        }
        let res;
        try {
            res = await fetchImpl(url, { headers: reqHeaders, signal: controller?.signal });
        }
        catch (e) {
            if (timer) {
                clearTimeout(timer);
            }
            if (attempt === maxRetries) {
                return { ok: false, bytes: startByte, resumed: startByte > 0, error: e instanceof Error ? e.message : String(e) };
            }
            await sleep(computeBackoffMs({ status: 0, headers: undefined, attempt }));
            continue;
        }
        if (timer) {
            clearTimeout(timer);
        }
        if (RETRYABLE.has(res.status) && attempt < maxRetries) {
            await sleep(computeBackoffMs({ status: res.status, headers: res.headers, attempt }));
            continue;
        }
        // 206 = server honored Range, append. 200 = full body, restart from scratch.
        const append = res.status === 206 && startByte > 0;
        if (!res.ok && res.status !== 206) {
            return { ok: false, bytes: startByte, resumed: startByte > 0, status: res.status, error: `HTTP ${res.status}` };
        }
        if (!res.body) {
            return { ok: false, bytes: startByte, resumed: startByte > 0, status: res.status, error: 'empty response body' };
        }
        const out = createWriteStream(partPath, { flags: append ? 'a' : 'w' });
        await pipeline(Readable.fromWeb(res.body), out);
        const final = await stat(partPath);
        await rename(partPath, dest);
        return { ok: true, bytes: final.size, resumed: append, status: res.status };
    }
    return { ok: false, bytes: 0, resumed: false, error: 'exhausted retries' };
}
