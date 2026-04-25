// Pure data module — parsing, normalization, ranking, pagination.
// No DOM, no network. Easy to reason about and test.

// PapaParse handles RFC 4180 CSV (quoted fields, commas in names, emoji,
// embedded newlines). ~7 KB gzipped via jsdelivr's ESM build.
import Papa from 'https://cdn.jsdelivr.net/npm/papaparse@5/+esm';

/** Sheet column headers (Latvian, exactly as Google Forms creates them). */
export const COL = Object.freeze({
    timestamp: 'Column 1',
    name:      'Vārds',
    level:     'Līmenis',
    score:     'Punkti',
    wpm:       'Vārdi minūtē',
    accuracy:  'Akurātums',
    skin:      'Varonis',
});

/**
 * Available sort metrics. Each has a primary numeric field, a secondary
 * tie-breaker, and a label/icon for the toggle UI.
 */
export const SORTERS = Object.freeze({
    score:    { primary: 'score',    secondary: 'wpm',      label: 'Punkti',     icon: '⭐' },
    wpm:      { primary: 'wpm',      secondary: 'accuracy', label: 'Ātrums',     icon: '⚡' },
    accuracy: { primary: 'accuracy', secondary: 'score',    label: 'Akurātums',  icon: '✓' },
});

/** Coerce a sheet cell to a non-negative integer. */
function toInt(value) {
    const n = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

/**
 * Parse the raw CSV text into normalized entry objects.
 *
 * @param {string} csvText
 * @returns {Array<{name:string, level:number, score:number, wpm:number, accuracy:number, skin:string, timestamp:string}>}
 */
export function parseCsv(csvText) {
    const { data } = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
    });
    return data
        .map(row => ({
            timestamp: row[COL.timestamp] || '',
            name:      String(row[COL.name] || '').trim(),
            level:     toInt(row[COL.level]),
            score:     toInt(row[COL.score]),
            wpm:       toInt(row[COL.wpm]),
            accuracy:  toInt(row[COL.accuracy]),
            skin:      String(row[COL.skin] || 'default').trim().toLowerCase(),
        }))
        .filter(e => e.name.length > 0 && e.level > 0);
}

/**
 * Compare two entries by the chosen sort metric. Returns true if a is better
 * than b (would rank higher).
 */
function isBetter(a, b, sortBy) {
    const s = SORTERS[sortBy] || SORTERS.score;
    if (a[s.primary] !== b[s.primary]) return a[s.primary] > b[s.primary];
    return a[s.secondary] > b[s.secondary];
}

/**
 * For a given level, deduplicate by player (keep best entry per name)
 * then sort by the selected metric. Adds a `rank` field starting from 1.
 *
 * Names are case-insensitive for deduplication, but the original casing
 * is preserved in the output.
 */
export function rankForLevel(entries, level, sortBy = 'score') {
    // Filter early — drop entries without a name (e.g. nameless candidates
    // used purely for rank projection) so we never .toLowerCase() undefined.
    const filtered = entries.filter(e => e && e.level === level && typeof e.name === 'string' && e.name.length > 0);

    const best = new Map();
    for (const e of filtered) {
        const key = e.name.toLowerCase();
        const prev = best.get(key);
        if (!prev || isBetter(e, prev, sortBy)) best.set(key, e);
    }

    const s = SORTERS[sortBy] || SORTERS.score;
    const ranked = [...best.values()].sort((a, b) =>
        b[s.primary] - a[s.primary] ||
        b[s.secondary] - a[s.secondary] ||
        a.name.localeCompare(b.name, 'lv')
    );

    return ranked.map((e, i) => ({ ...e, rank: i + 1 }));
}

/**
 * Find a target entry's position in a ranked list. Match is fuzzy: same
 * name (case-insensitive) and exact level — ignores score/wpm so we still
 * find the row even if the user's stats changed since submission.
 */
export function findRank(rankedEntries, target) {
    if (!target || !target.name) return null;
    const name = String(target.name).toLowerCase();
    const idx = rankedEntries.findIndex(e =>
        e && typeof e.name === 'string' &&
        e.name.toLowerCase() === name && e.level === target.level
    );
    return idx === -1 ? null : rankedEntries[idx];
}

/**
 * Return a viewing window: top N entries, plus the user's row (if outside top N).
 * Useful for "show top 10 + this is you at #47".
 *
 * @returns {{top: Array, user: Object|null, isUserInTop: boolean, total: number}}
 */
export function viewWindow(rankedEntries, userTarget, topN = 10) {
    const top = rankedEntries.slice(0, topN);
    const user = userTarget ? findRank(rankedEntries, userTarget) : null;
    const isUserInTop = !!(user && user.rank <= topN);
    return { top, user, isUserInTop, total: rankedEntries.length };
}

/**
 * Insert an optimistic entry into the entry pool — used to show the user's
 * row immediately, before the Google Sheet has caught up.
 *
 * @param {Array} entries - all entries (NOT yet filtered)
 * @param {Object} optimistic - new entry to insert
 * @returns {Array} new array with optimistic entry tagged `_pending: true`
 */
export function withOptimistic(entries, optimistic) {
    return [...entries, { ...optimistic, _pending: true }];
}

/**
 * Compute the rank a hypothetical entry would receive on the given level
 * with the given sort metric — without actually submitting it. Used for
 * "if you submit, you'd be at #X" before the player has typed a name.
 *
 * The candidate only needs `level`, `score`, `wpm`, `accuracy`. No name required.
 */
export function projectedRank(entries, candidate, sortBy = 'score') {
    const s = SORTERS[sortBy] || SORTERS.score;
    const peers = entries
        .filter(e => e && e.level === candidate.level && typeof e.name === 'string' && e.name)
        .sort((a, b) =>
            b[s.primary] - a[s.primary] ||
            b[s.secondary] - a[s.secondary]
        );

    let rank = 1;
    for (const e of peers) {
        if (
            e[s.primary] > candidate[s.primary] ||
            (e[s.primary] === candidate[s.primary] && e[s.secondary] > candidate[s.secondary])
        ) {
            rank++;
        } else {
            break;
        }
    }
    return { rank, total: peers.length };
}
