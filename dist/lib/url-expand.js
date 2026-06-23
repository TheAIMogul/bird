// Expand t.co short links in tweet text using the tweet's own url entities.
// X delivers `legacy.full_text` with t.co links plus `legacy.entities.urls[]`
// carrying the real `expanded_url`. Pure string transform, no network.
export function expandShortUrls(text, urls) {
    if (typeof text !== 'string' || text.length === 0 || !Array.isArray(urls) || urls.length === 0) {
        return text;
    }
    let out = text;
    for (const entry of urls) {
        const short = entry?.url;
        const expanded = entry?.expanded_url;
        if (typeof short === 'string' && short.length > 0 && typeof expanded === 'string' && expanded.length > 0) {
            // t.co links are unique tokens; global replace is safe and order-independent.
            out = out.split(short).join(expanded);
        }
    }
    return out;
}

// Pull the url entities array off a raw tweet result (defensive across shapes).
export function urlEntitiesFromResult(result) {
    const urls = result?.legacy?.entities?.urls;
    return Array.isArray(urls) ? urls : undefined;
}
