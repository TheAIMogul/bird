/**
 * Browser cookie extraction for Twitter authentication.
 * Delegates to @steipete/sweet-cookie for Safari/Chrome/Firefox reads.
 */
import { getCookies } from '@steipete/sweet-cookie';
import { execFileSync } from 'node:child_process';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const TWITTER_COOKIE_NAMES = ['auth_token', 'ct0'];
const TWITTER_URL = 'https://x.com/';
const TWITTER_ORIGINS = ['https://x.com/', 'https://twitter.com/'];
const DEFAULT_COOKIE_TIMEOUT_MS = 30_000;
function normalizeValue(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function cookieHeader(authToken, ct0) {
    return `auth_token=${authToken}; ct0=${ct0}`;
}
function buildEmpty() {
    return { authToken: null, ct0: null, cookieHeader: null, source: null };
}
// --- Comet (Perplexity's Chromium browser) cookie extraction ---------------
// sweet-cookie hardcodes Google Chrome's path + "Chrome Safe Storage" keychain
// entry, so it cannot reach Comet. Comet stores cookies the same way Chromium
// does (AES-128-CBC, key = PBKDF2-SHA1(keychainPw, "saltysalt", 1003, 16)) but
// behind its own "Comet Safe Storage" keychain item, so we read it natively.
const COMET_ROOT = join(homedir(), 'Library', 'Application Support', 'Comet');
function getCometSafeStorageKey() {
    let password;
    try {
        password = execFileSync('security', ['find-generic-password', '-s', 'Comet Safe Storage', '-w'], {
            encoding: 'utf8',
            timeout: 3_000,
        }).trim();
    }
    catch {
        return null;
    }
    if (!password) {
        return null;
    }
    return pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
}
function decryptChromiumValue(encrypted, key) {
    if (!encrypted || encrypted.length === 0) {
        return null;
    }
    const prefix = encrypted.subarray(0, 3).toString('latin1');
    if (prefix !== 'v10' && prefix !== 'v11') {
        // Unencrypted fallback (rare on macOS).
        return encrypted.toString('utf8');
    }
    try {
        const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '));
        const plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
        const asAscii = plain.toString('utf8');
        if (/^[\x20-\x7E]+$/.test(asAscii)) {
            return asAscii;
        }
        // Newer Chromium prepends a 32-byte SHA-256(domain) to the plaintext.
        return plain.subarray(32).toString('utf8');
    }
    catch {
        return null;
    }
}
function listCometProfiles() {
    let entries;
    try {
        entries = readdirSync(COMET_ROOT, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const profiles = entries
        .filter((e) => e.isDirectory() && (e.name === 'Default' || /^Profile \d+$/.test(e.name)))
        .map((e) => e.name)
        .filter((name) => existsSync(join(COMET_ROOT, name, 'Cookies')));
    // Stable order: Default first, then Profile 1, 2, 3... We short-circuit on
    // the first profile that yields a logged-in session.
    profiles.sort((a, b) => {
        if (a === 'Default')
            return -1;
        if (b === 'Default')
            return 1;
        return a.localeCompare(b, 'en', { numeric: true });
    });
    return profiles;
}
function readCometCookieDb(dbPath, key) {
    // Copy the DB out first so we never trip over a WAL lock while Comet runs.
    const tmp = join(tmpdir(), `bird-comet-${process.pid}-${Date.now()}.sqlite`);
    let db;
    try {
        copyFileSync(dbPath, tmp);
        db = new DatabaseSync(tmp, { readOnly: true });
        const rows = db
            .prepare("SELECT name, host_key, encrypted_value FROM cookies WHERE name IN ('auth_token', 'ct0') AND (host_key LIKE '%x.com' OR host_key LIKE '%twitter.com')")
            .all();
        const pick = (name) => {
            const matches = rows.filter((r) => r.name === name);
            const chosen = matches.find((r) => String(r.host_key).endsWith('x.com')) ??
                matches.find((r) => String(r.host_key).endsWith('twitter.com')) ??
                matches[0];
            return chosen ? decryptChromiumValue(Buffer.from(chosen.encrypted_value), key) : null;
        };
        return { authToken: pick('auth_token'), ct0: pick('ct0') };
    }
    catch {
        return { authToken: null, ct0: null };
    }
    finally {
        try {
            db?.close();
        }
        catch { }
        try {
            rmSync(tmp, { force: true });
        }
        catch { }
    }
}
export async function extractCometCookies(profile) {
    const warnings = [];
    const out = buildEmpty();
    // Stay silent on machines that don't have Comet installed.
    if (process.platform !== 'darwin' || !existsSync(COMET_ROOT)) {
        return { cookies: out, warnings };
    }
    const key = getCometSafeStorageKey();
    if (!key) {
        warnings.push('Could not read "Comet Safe Storage" from the macOS Keychain.');
        return { cookies: out, warnings };
    }
    const profiles = profile ? [profile] : listCometProfiles();
    for (const name of profiles) {
        const dbPath = join(COMET_ROOT, name, 'Cookies');
        if (!existsSync(dbPath)) {
            continue;
        }
        const { authToken, ct0 } = readCometCookieDb(dbPath, key);
        if (authToken && ct0) {
            out.authToken = authToken;
            out.ct0 = ct0;
            out.cookieHeader = cookieHeader(authToken, ct0);
            out.source = `Comet profile "${name}"`;
            return { cookies: out, warnings };
        }
    }
    warnings.push('No Twitter cookies found in Comet. Make sure you are logged into x.com in Comet.');
    return { cookies: out, warnings };
}
function readEnvCookie(cookies, keys, field) {
    if (cookies[field]) {
        return;
    }
    for (const key of keys) {
        const value = normalizeValue(process.env[key]);
        if (!value) {
            continue;
        }
        cookies[field] = value;
        if (!cookies.source) {
            cookies.source = `env ${key}`;
        }
        break;
    }
}
function resolveSources(cookieSource) {
    if (Array.isArray(cookieSource)) {
        return cookieSource;
    }
    if (cookieSource) {
        return [cookieSource];
    }
    return ['comet', 'safari', 'chrome', 'firefox'];
}
function labelForSource(source, profile) {
    if (source === 'safari') {
        return 'Safari';
    }
    if (source === 'chrome') {
        return profile ? `Chrome profile "${profile}"` : 'Chrome default profile';
    }
    return profile ? `Firefox profile "${profile}"` : 'Firefox default profile';
}
function pickCookieValue(cookies, name) {
    const matches = cookies.filter((c) => c?.name === name && typeof c.value === 'string');
    if (matches.length === 0) {
        return null;
    }
    const preferred = matches.find((c) => (c.domain ?? '').endsWith('x.com'));
    if (preferred?.value) {
        return preferred.value;
    }
    const twitter = matches.find((c) => (c.domain ?? '').endsWith('twitter.com'));
    if (twitter?.value) {
        return twitter.value;
    }
    return matches[0]?.value ?? null;
}
async function readTwitterCookiesFromBrowser(options) {
    if (options.source === 'comet') {
        return extractCometCookies(options.chromeProfile);
    }
    const warnings = [];
    const out = buildEmpty();
    const { cookies, warnings: providerWarnings } = await getCookies({
        url: TWITTER_URL,
        origins: TWITTER_ORIGINS,
        names: [...TWITTER_COOKIE_NAMES],
        browsers: [options.source],
        mode: 'merge',
        chromeProfile: options.chromeProfile,
        firefoxProfile: options.firefoxProfile,
        timeoutMs: options.cookieTimeoutMs,
    });
    warnings.push(...providerWarnings);
    const authToken = pickCookieValue(cookies, 'auth_token');
    const ct0 = pickCookieValue(cookies, 'ct0');
    if (authToken) {
        out.authToken = authToken;
    }
    if (ct0) {
        out.ct0 = ct0;
    }
    if (out.authToken && out.ct0) {
        out.cookieHeader = cookieHeader(out.authToken, out.ct0);
        out.source = labelForSource(options.source, options.source === 'chrome' ? options.chromeProfile : options.firefoxProfile);
        return { cookies: out, warnings };
    }
    if (options.source === 'safari') {
        warnings.push('No Twitter cookies found in Safari. Make sure you are logged into x.com in Safari.');
    }
    else if (options.source === 'chrome') {
        warnings.push('No Twitter cookies found in Chrome. Make sure you are logged into x.com in Chrome.');
    }
    else {
        warnings.push('No Twitter cookies found in Firefox. Make sure you are logged into x.com in Firefox and the profile exists.');
    }
    return { cookies: out, warnings };
}
export async function extractCookiesFromSafari() {
    return readTwitterCookiesFromBrowser({ source: 'safari' });
}
export async function extractCookiesFromChrome(profile) {
    return readTwitterCookiesFromBrowser({ source: 'chrome', chromeProfile: profile });
}
export async function extractCookiesFromFirefox(profile) {
    return readTwitterCookiesFromBrowser({ source: 'firefox', firefoxProfile: profile });
}
/**
 * Resolve Twitter credentials from multiple sources.
 * Priority: CLI args > environment variables > browsers (ordered).
 */
export async function resolveCredentials(options) {
    const warnings = [];
    const cookies = buildEmpty();
    const cookieTimeoutMs = typeof options.cookieTimeoutMs === 'number' &&
        Number.isFinite(options.cookieTimeoutMs) &&
        options.cookieTimeoutMs > 0
        ? options.cookieTimeoutMs
        : process.platform === 'darwin'
            ? DEFAULT_COOKIE_TIMEOUT_MS
            : undefined;
    if (options.authToken) {
        cookies.authToken = options.authToken;
        cookies.source = 'CLI argument';
    }
    if (options.ct0) {
        cookies.ct0 = options.ct0;
        if (!cookies.source) {
            cookies.source = 'CLI argument';
        }
    }
    readEnvCookie(cookies, ['AUTH_TOKEN', 'TWITTER_AUTH_TOKEN'], 'authToken');
    readEnvCookie(cookies, ['CT0', 'TWITTER_CT0'], 'ct0');
    if (cookies.authToken && cookies.ct0) {
        cookies.cookieHeader = cookieHeader(cookies.authToken, cookies.ct0);
        return { cookies, warnings };
    }
    const sourcesToTry = resolveSources(options.cookieSource);
    for (const source of sourcesToTry) {
        const res = await readTwitterCookiesFromBrowser({
            source,
            chromeProfile: options.chromeProfile,
            firefoxProfile: options.firefoxProfile,
            cookieTimeoutMs,
        });
        warnings.push(...res.warnings);
        if (res.cookies.authToken && res.cookies.ct0) {
            return { cookies: res.cookies, warnings };
        }
    }
    if (!cookies.authToken) {
        warnings.push('Missing auth_token - provide via --auth-token, AUTH_TOKEN env var, or login to x.com in Comet/Safari/Chrome/Firefox');
    }
    if (!cookies.ct0) {
        warnings.push('Missing ct0 - provide via --ct0, CT0 env var, or login to x.com in Comet/Safari/Chrome/Firefox');
    }
    if (cookies.authToken && cookies.ct0) {
        cookies.cookieHeader = cookieHeader(cookies.authToken, cookies.ct0);
    }
    return { cookies, warnings };
}
//# sourceMappingURL=cookies.js.map