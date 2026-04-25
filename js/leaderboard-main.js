// Module entrypoint — wires the game's level-complete event into the
// leaderboard flow. Submits to Google Forms, fetches latest entries,
// renders the cards UI, and emits continue events back to the game.

import { submitScore, fetchLeaderboardCsv, invalidateCache } from './leaderboard-api.js';
import { parseCsv, projectedRank } from './leaderboard-data.js';
import { LeaderboardView, promptName } from './leaderboard-ui.js';

const NAME_KEY = 'burtuTrepe_lastName';

/**
 * Read/write the last submitted name so we can pre-fill the input.
 */
function rememberName(name) {
    try { localStorage.setItem(NAME_KEY, name); } catch { /* ignore */ }
}
function recallName() {
    try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}

/**
 * Listen for the game's level-complete event. Detail shape:
 *   { level: number, score: number, wpm: number, accuracy: number, skin: string }
 */
document.addEventListener('game:level-complete', async (e) => {
    const stats = e.detail;
    showLeaderboardFlow(stats).catch(err => {
        console.error('Leaderboard flow failed:', err);
        // Fall back: just emit continue so the game isn't stuck
        document.dispatchEvent(new CustomEvent('leaderboard:done', { detail: { skipped: true } }));
    });
});

async function showLeaderboardFlow(stats) {
    const overlay = ensureOverlay();
    const view = overlay._view;
    const statsEl = overlay.querySelector('[data-role="stats"]');
    const submitBtn = overlay.querySelector('[data-action="submit"]');
    const replayBtn = overlay.querySelector('[data-action="replay"]');
    const nextBtn   = overlay.querySelector('[data-action="next"]');
    const menuBtn   = overlay.querySelector('[data-action="menu"]');

    // Reset state
    statsEl.innerHTML = `
        <div class="lb-mystat lb-mystat--score"><span>⭐</span><strong>${stats.score}</strong><small>Punkti</small></div>
        <div class="lb-mystat lb-mystat--wpm"><span>⚡</span><strong>${stats.wpm}</strong><small>Vārdi/min</small></div>
        <div class="lb-mystat lb-mystat--acc"><span>✓</span><strong>${stats.accuracy}%</strong><small>Akurāti</small></div>
    `;
    overlay.querySelector('.lb-overlay-title').textContent = `${stats.level}. līmenis pabeigts!`;
    overlay.classList.add('open');
    submitBtn.classList.remove('hidden');
    submitBtn.disabled = false;
    submitBtn.textContent = '💾 Saglabāt rezultātu';

    // Update view's level so it filters correctly
    view.setLevel(stats.level);

    // Initial fetch + render with current data
    let entries = [];
    try {
        const csv = await fetchLeaderboardCsv();
        entries = parseCsv(csv);
    } catch (err) {
        console.warn('Could not fetch leaderboard:', err);
    }

    view.setEntries(entries);
    view.setUserEntry(null);

    // Show projected rank in the header
    const projection = projectedRank(entries, stats, view.sortBy);
    const projEl = overlay.querySelector('[data-role="projection"]');
    projEl.innerHTML = projection.rank
        ? `Tu būsi <strong>#${projection.rank}</strong> vietā`
        : 'Sāc vēsturi šajā līmenī!';

    // Set up button handlers (replace each render to avoid stale closures)
    submitBtn.onclick = async () => {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saglabā…';

        const result = await promptName({
            defaultName: recallName(),
            projectedRankInfo: projection,
        });
        if (!result) {
            submitBtn.disabled = false;
            submitBtn.textContent = '💾 Saglabāt rezultātu';
            return;
        }

        const userEntry = {
            name: result.name,
            level: stats.level,
            score: stats.score,
            wpm: stats.wpm,
            accuracy: stats.accuracy,
            skin: stats.skin,
        };
        rememberName(result.name);

        // Optimistic insert — show user in leaderboard immediately
        view.setUserEntry(userEntry);
        submitBtn.classList.add('hidden');
        projEl.innerHTML = '🎉 Tavs rezultāts saglabāts!';

        // Fire-and-forget submit, then refetch in background
        const sendResult = await submitScore(userEntry);
        if (!sendResult.ok) {
            projEl.innerHTML = '⚠️ Saglabāšana neizdevās. Mēģini vēlāk.';
        }
        invalidateCache();
        // Sheets has a small lag — try a fresh fetch ~3s later
        setTimeout(async () => {
            try {
                const fresh = await fetchLeaderboardCsv({ force: true });
                view.setEntries(parseCsv(fresh));
            } catch { /* keep optimistic data */ }
        }, 3000);
    };

    replayBtn.onclick = () => closeOverlay(() =>
        document.dispatchEvent(new CustomEvent('leaderboard:replay'))
    );
    nextBtn.onclick = () => closeOverlay(() =>
        document.dispatchEvent(new CustomEvent('leaderboard:next'))
    );
    menuBtn.onclick = () => closeOverlay(() =>
        document.dispatchEvent(new CustomEvent('leaderboard:menu'))
    );
}

function closeOverlay(after) {
    const overlay = document.getElementById('lbOverlay');
    if (!overlay) return after();
    overlay.classList.remove('open');
    setTimeout(after, 250);
}

/** Build the overlay DOM once and reuse it. */
function ensureOverlay() {
    let overlay = document.getElementById('lbOverlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'lbOverlay';
    overlay.className = 'lb-overlay';
    overlay.innerHTML = `
        <div class="lb-overlay-card">
            <div class="lb-overlay-header">
                <h2 class="lb-overlay-title">Līmenis pabeigts!</h2>
                <div class="lb-overlay-projection" data-role="projection"></div>
            </div>
            <div class="lb-overlay-stats" data-role="stats"></div>
            <div class="lb-overlay-actions-top">
                <button type="button" class="lb-btn lb-btn--primary" data-action="submit">💾 Saglabāt rezultātu</button>
            </div>
            <div class="lb-overlay-board" data-role="board"></div>
            <div class="lb-overlay-actions">
                <button type="button" class="lb-btn lb-btn--ghost" data-action="menu">← Izvēlne</button>
                <button type="button" class="lb-btn lb-btn--secondary" data-action="replay">↻ Atkārtot</button>
                <button type="button" class="lb-btn lb-btn--primary" data-action="next">Nākamais →</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay._view = new LeaderboardView(
        overlay.querySelector('[data-role="board"]'),
        { entries: [], level: 1, initialSort: 'score' }
    );

    // Re-fetch projected rank when sort changes (it can affect rank position)
    overlay._view.addEventListener('sortchange', () => {
        // No-op for now — projection text isn't critical to update on sort.
    });

    return overlay;
}

// Expose a programmatic hook for the game to set the level on the view.
// Done via the level-complete event detail, but kept here for clarity.
function setLevel(level) {
    const overlay = document.getElementById('lbOverlay');
    if (!overlay || !overlay._view) return;
    overlay._view.constructor.prototype; // no-op
}
