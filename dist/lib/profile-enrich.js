// Pure profile-enrichment helpers: extract structured signals from a user's bio
// and normalize the org affiliation badge X attaches to some accounts.
// No network, no state.

const HANDLE_RE = /(^|[^A-Za-z0-9_@])@([A-Za-z0-9_]{1,15})\b/g;
const DOMAIN_RE = /\b((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/[^\s]*)?/gi;
const COMPANY_RE = /\b(?:building|founder(?:\s+of|\s+at)?|ceo(?:\s+of|\s+at)?|cto(?:\s+of|\s+at)?|work(?:ing)?\s+(?:on|at)|at)\s+@?([A-Z][A-Za-z0-9._-]{1,30})/g;

const SKIP_DOMAINS = new Set(['e.g', 'i.e', 'a.m', 'p.m']);

// Returns deduped entities: [{ kind: 'handle'|'domain'|'company', value }]
export function extractBioEntities(description) {
    if (typeof description !== 'string' || description.length === 0) {
        return [];
    }
    const seen = new Set();
    const out = [];
    const add = (kind, rawValue) => {
        const value = rawValue.trim();
        if (!value) {
            return;
        }
        const key = `${kind}:${value.toLowerCase()}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        out.push({ kind, value });
    };
    for (const m of description.matchAll(HANDLE_RE)) {
        add('handle', `@${m[2]}`);
    }
    for (const m of description.matchAll(DOMAIN_RE)) {
        let host = m[1].toLowerCase();
        if (SKIP_DOMAINS.has(host)) {
            continue;
        }
        host = host.replace(/^www\./, '');
        add('domain', host);
    }
    for (const m of description.matchAll(COMPANY_RE)) {
        add('company', m[1]);
    }
    return out;
}

function inferHandleFromUrl(url) {
    if (typeof url !== 'string') {
        return undefined;
    }
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        if (host === 'x.com' || host === 'twitter.com' || host.endsWith('.x.com') || host.endsWith('.twitter.com')) {
            const seg = parsed.pathname.split('/').filter(Boolean)[0];
            return seg ? `@${seg}` : undefined;
        }
    }
    catch {
        // fall through
    }
    return undefined;
}

// Normalize the affiliation badge from a raw user result. Returns
// { label, handle?, url?, badgeUrl? } or null. Tolerant of camel/snake shapes.
export function normalizeAffiliation(rawUser) {
    if (!rawUser || typeof rawUser !== 'object') {
        return null;
    }
    const aff = rawUser.affiliates_highlighted_label?.label ??
        rawUser.affiliation?.label ??
        rawUser.affiliation ??
        null;
    if (!aff) {
        return null;
    }
    const label = typeof aff === 'string' ? aff : aff.description ?? aff.text ?? aff.label;
    if (typeof label !== 'string' || label.length === 0) {
        return null;
    }
    const url = aff.url?.url ?? aff.url ?? rawUser.affiliation?.url?.url;
    const badgeUrl = aff.badge?.url ?? aff.badge_url;
    const handle = inferHandleFromUrl(typeof url === 'string' ? url : undefined);
    const result = { label };
    if (handle) {
        result.handle = handle;
    }
    if (typeof url === 'string') {
        result.url = url;
    }
    if (typeof badgeUrl === 'string') {
        result.badgeUrl = badgeUrl;
    }
    return result;
}
