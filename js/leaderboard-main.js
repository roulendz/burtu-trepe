import { submitScore, fetchLeaderboardCsv, invalidateCache } from './leaderboard-api.js';
import { parseCsv, projectedRank } from './leaderboard-data.js';
import { LeaderboardView } from './leaderboard-ui.js';

const NAME_KEY     = 'burtuTrepe_lastName';
const AUTOSAVE_KEY = 'burtuTrepe_autoSave';

function rememberName(name)    { try { localStorage.setItem(NAME_KEY, name); } catch {} }
function recallName()          { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } }
function rememberAutoSave(on)  { try { localStorage.setItem(AUTOSAVE_KEY, on ? '1' : '0'); } catch {} }
function recallAutoSave()      { try { return localStorage.getItem(AUTOSAVE_KEY) !== '0'; } catch { return true; } }

document.addEventListener('game:level-complete', async (e) => {
    showLeaderboardFlow(e.detail).catch(err => {
        console.error('Leaderboard flow failed:', err);
        document.dispatchEvent(new CustomEvent('leaderboard:done', { detail: { skipped: true } }));
    });
});

async function showLeaderboardFlow(stats) {
    const overlay     = ensureOverlay();
    const view        = overlay._view;
    const projEl      = overlay.querySelector('[data-role="projection"]');
    const saveSection = overlay.querySelector('[data-role="save-section"]');
    const nameInput   = overlay.querySelector('[data-role="name-input"]');
    const submitBtn   = overlay.querySelector('[data-action="submit"]');
    const autoCheck   = overlay.querySelector('[data-role="autosave"]');
    const savedMsg    = overlay.querySelector('[data-role="saved-msg"]');

    overlay.querySelector('.lb-overlay-title').textContent = `${stats.level}. līmenis pabeigts!`;
    overlay.querySelector('[data-role="stats"]').innerHTML = `
        <div class="lb-mystat lb-mystat--score"><span>⭐</span><strong>${stats.score}</strong><small>Punkti</small></div>
        <div class="lb-mystat lb-mystat--wpm"><span>⚡</span><strong>${stats.wpm}</strong><small>Vārdi/min</small></div>
        <div class="lb-mystat lb-mystat--acc"><span>✓</span><strong>${stats.accuracy}%</strong><small>Akurāti</small></div>
    `;
    overlay.classList.add('open');

    // Reset save section
    saveSection.classList.remove('lb-save-section--saved');
    nameInput.value = recallName();
    autoCheck.checked = recallAutoSave();
    submitBtn.disabled = !nameInput.value.trim();
    savedMsg.textContent = '';

    // Fetch leaderboard
    view.setLevel(stats.level);
    let entries = [];
    try {
        entries = parseCsv(await fetchLeaderboardCsv());
    } catch (err) {
        console.warn('Could not fetch leaderboard:', err);
    }
    view.setEntries(entries);
    view.setUserEntry(null);

    const projection = projectedRank(entries, stats, view.sortBy);
    projEl.innerHTML = projection.rank
        ? `Tu būsi <strong>#${projection.rank}</strong> vietā`
        : 'Sāc vēsturi šajā līmenī!';

    // Single save routine used by both manual click and auto-save
    const save = async () => {
        const name = nameInput.value.trim();
        if (!name) return;
        submitBtn.disabled = true;

        const userEntry = {
            name, level: stats.level, score: stats.score,
            wpm: stats.wpm, accuracy: stats.accuracy, skin: stats.skin,
        };
        rememberName(name);
        view.setUserEntry(userEntry);

        saveSection.classList.add('lb-save-section--saved');
        savedMsg.textContent = '🎉 Rezultāts saglabāts!';

        const result = await submitScore(userEntry);
        if (!result.ok) savedMsg.textContent = '⚠️ Saglabāšana neizdevās';
        submitBtn.title = 'Rezultāts jau saglabāts';
        invalidateCache();
        setTimeout(async () => {
            try {
                view.setEntries(parseCsv(await fetchLeaderboardCsv({ force: true })));
            } catch {}
        }, 3000);
    };

    nameInput.oninput = () => {
        submitBtn.disabled = !nameInput.value.trim();
        submitBtn.title = '';
        saveSection.classList.remove('lb-save-section--saved');
    };
    nameInput.onkeydown = (e) => { if (e.key === 'Enter' && !submitBtn.disabled) save(); };
    submitBtn.onclick = save;
    autoCheck.onchange = () => rememberAutoSave(autoCheck.checked);

    if (autoCheck.checked && nameInput.value.trim()) save();

    const nav = (evt) => () => closeOverlay(() => document.dispatchEvent(new CustomEvent(evt)));
    overlay.querySelector('[data-action="replay"]').onclick = nav('leaderboard:replay');
    overlay.querySelector('[data-action="next"]').onclick   = nav('leaderboard:next');
    overlay.querySelector('[data-action="menu"]').onclick   = nav('leaderboard:menu');
}

function closeOverlay(after) {
    const overlay = document.getElementById('lbOverlay');
    if (!overlay) return after();
    overlay.classList.remove('open');
    setTimeout(after, 250);
}

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
            <div class="lb-save-section" data-role="save-section">
                <div class="lb-save-row">
                    <input type="text" class="lb-save-name" data-role="name-input"
                           maxlength="20" autocomplete="off" spellcheck="false"
                           placeholder="Tavs vārds" />
                    <button type="button" class="lb-btn lb-btn--primary lb-save-btn"
                            data-action="submit" disabled>Saglabāt</button>
                </div>
                <label class="lb-autosave">
                    <input type="checkbox" data-role="autosave" checked />
                    <span>Automātiski saglabāt pēc līmeņa</span>
                </label>
                <div class="lb-saved-msg" data-role="saved-msg"></div>
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

    return overlay;
}
