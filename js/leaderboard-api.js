// Network module — Google Forms POST + Sheets gviz CSV fetch.
// Single responsibility: talk to Google. No DOM, no parsing.

const FORM_URL =
    'https://docs.google.com/forms/d/e/1FAIpQLSe0-ickhCFnhMwfKCiQdz9CtSgGsQxTsE9PvrejBlJjue2ISw/formResponse';

const SHEET_ID = '1NmnFfvXfJhL9m0a3E_hgcq-Fheb7_EGtOziJpQSgcOI';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;

const FIELD = Object.freeze({
    name:     'entry.1486174166',
    level:    'entry.1189866117',
    score:    'entry.1732872896',
    wpm:      'entry.2103321478',
    accuracy: 'entry.1446010918',
    skin:     'entry.232156388',
});

const NAME_LIMIT = 20;

/**
 * Submit a single score row to the Google Form. Fire-and-forget — Google
 * Forms does not return CORS headers so the response is opaque; we treat
 * a non-throw as success.
 *
 * @param {object} entry
 * @param {string} entry.name
 * @param {number} entry.level
 * @param {number} entry.score
 * @param {number} entry.wpm
 * @param {number} entry.accuracy
 * @param {string} entry.skin
 * @returns {Promise<{ok: boolean, error?: Error}>}
 */
export async function submitScore(entry) {
    const fd = new FormData();
    fd.append(FIELD.name,     String(entry.name).slice(0, NAME_LIMIT));
    fd.append(FIELD.level,    String(entry.level));
    fd.append(FIELD.score,    String(entry.score));
    fd.append(FIELD.wpm,      String(entry.wpm));
    fd.append(FIELD.accuracy, String(entry.accuracy));
    fd.append(FIELD.skin,     String(entry.skin || 'default'));

    try {
        await fetch(FORM_URL, { method: 'POST', mode: 'no-cors', body: fd });
        return { ok: true };
    } catch (error) {
        return { ok: false, error };
    }
}

const CACHE_KEY    = 'burtuTrepe_lbCsv';
const CACHE_AT_KEY = 'burtuTrepe_lbCsvAt';

/**
 * Fetch the raw CSV from the published sheet, with a short sessionStorage
 * cache so a classroom of kids hammering refresh doesn't trigger throttling.
 *
 * @param {object} [opts]
 * @param {number} [opts.ttlMs=20000] cache time-to-live
 * @param {boolean} [opts.force=false] bypass cache
 * @returns {Promise<string>} raw CSV text
 */
export async function fetchLeaderboardCsv({ ttlMs = 20_000, force = false } = {}) {
    if (!force) {
        const at  = Number(sessionStorage.getItem(CACHE_AT_KEY) || 0);
        const csv = sessionStorage.getItem(CACHE_KEY);
        if (csv && (Date.now() - at) < ttlMs) return csv;
    }
    const res = await fetch(SHEET_CSV_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);
    const csv = await res.text();
    try {
        sessionStorage.setItem(CACHE_KEY, csv);
        sessionStorage.setItem(CACHE_AT_KEY, String(Date.now()));
    } catch { /* quota exceeded — ignore */ }
    return csv;
}

/** Force-clear the in-memory cache (useful right after a submit). */
export function invalidateCache() {
    sessionStorage.removeItem(CACHE_KEY);
    sessionStorage.removeItem(CACHE_AT_KEY);
}
