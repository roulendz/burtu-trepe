// UI module — renders leaderboard cards, sort toggle, name input modal.
// Speaks to the data module for ranking and the api module for submissions.

import { SORTERS, rankForLevel, viewWindow, withOptimistic } from './leaderboard-data.js';

const SKIN_EMOJI = Object.freeze({
    default:   '🧒',
    spiderman: '🕷️',
    mavuika:   '🔥',
});

const TIER = Object.freeze({ 1: 'gold', 2: 'silver', 3: 'bronze' });
const MEDAL = Object.freeze({ 1: '🥇', 2: '🥈', 3: '🥉' });

/** Escape user-typed strings before injecting into innerHTML. */
function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Build a single card element for one ranked entry.
 *
 * @param {object} entry  ranked entry (must have .rank)
 * @param {object} [opts]
 * @param {boolean} [opts.isUser] highlight as the current player
 * @param {boolean} [opts.isPending] show "🆕" tag for unconfirmed submissions
 */
export function renderCard(entry, opts = {}) {
    const { isUser = false, isPending = false, showLevel = false } = opts;
    const card = document.createElement('div');
    card.className = 'lb-card';
    if (isUser) card.classList.add('lb-card--user');
    if (isPending) card.classList.add('lb-card--pending');
    if (TIER[entry.rank]) card.classList.add(`lb-card--${TIER[entry.rank]}`);

    const skin = SKIN_EMOJI[entry.skin] || SKIN_EMOJI.default;
    const medal = MEDAL[entry.rank] || '';

    card.innerHTML = `
        <div class="lb-rank">
            ${medal ? `<span class="lb-medal" aria-hidden="true">${medal}</span>` : ''}
            <span class="lb-rank-num">#${entry.rank}</span>
        </div>
        <div class="lb-avatar" aria-hidden="true">${skin}</div>
        <div class="lb-name-wrap">
            <div class="lb-name">${esc(entry.name)}</div>
            ${showLevel ? `<div class="lb-level-tag">${entry.level}. līmenis</div>` : ''}
            ${isPending ? '<div class="lb-pending">🆕 tikko</div>' : ''}
        </div>
        <div class="lb-stats">
            <div class="lb-stat lb-stat--score" title="Punkti">
                <span class="lb-stat-icon">⭐</span>
                <span class="lb-stat-num">${entry.score}</span>
            </div>
            <div class="lb-stat lb-stat--wpm" title="Vārdi minūtē">
                <span class="lb-stat-icon">⚡</span>
                <span class="lb-stat-num">${entry.wpm}</span>
            </div>
            <div class="lb-stat lb-stat--acc" title="Akurātums">
                <span class="lb-stat-icon">✓</span>
                <span class="lb-stat-num">${entry.accuracy}%</span>
            </div>
        </div>
    `;
    return card;
}

/**
 * Live leaderboard view — renders a sortable, paginated list of entries.
 *
 * Emits `sortchange` when the user toggles the sort metric.
 *
 * Usage:
 *   const view = new LeaderboardView(container, {
 *     entries, level, userEntry, initialSort: 'score'
 *   });
 *   view.setEntries(newEntries);  // re-render with fresh data
 *   view.setUserEntry(submitted); // set the player to highlight
 */
export class LeaderboardView extends EventTarget {
    #container;
    #entries = [];
    #level;
    #userEntry = null;
    #sortBy;
    #topN;

    constructor(container, opts = {}) {
        super();
        this.#container = container;
        this.#entries = opts.entries || [];
        this.#level = opts.level;
        this.#userEntry = opts.userEntry || null;
        this.#sortBy = opts.initialSort || 'score';
        this.#topN = opts.topN || 10;
        this.#render();
    }

    setEntries(entries) {
        this.#entries = entries || [];
        this.#render();
    }

    setUserEntry(entry) {
        this.#userEntry = entry;
        this.#render();
    }

    setSort(sortBy) {
        if (!SORTERS[sortBy] || this.#sortBy === sortBy) return;
        this.#sortBy = sortBy;
        this.#render();
    }

    setLevel(level) {
        if (this.#level === level) return;
        this.#level = level;
        this.#render();
    }

    get sortBy() { return this.#sortBy; }
    get level()  { return this.#level; }

    #render() {
        const entriesWithUser = this.#userEntry
            ? withOptimistic(this.#entries.filter(e => !sameEntry(e, this.#userEntry)), this.#userEntry)
            : this.#entries;

        const ranked = rankForLevel(entriesWithUser, this.#level, this.#sortBy);
        const { top, user, isUserInTop, total } = viewWindow(ranked, this.#userEntry, this.#topN);

        this.#container.innerHTML = '';
        this.#container.appendChild(this.#renderSortBar());

        const cardsWrap = document.createElement('div');
        cardsWrap.className = 'lb-cards';

        if (top.length === 0) {
            cardsWrap.appendChild(this.#renderEmpty());
        } else {
            top.forEach((entry, i) => {
                const isUser = !!user && entry.rank === user.rank && sameName(entry.name, user.name);
                const card = renderCard(entry, { isUser, isPending: !!entry._pending });
                card.style.setProperty('--lb-delay', `${i * 60}ms`);
                cardsWrap.appendChild(card);
            });

            // User outside top N → show a separator + their row pinned at bottom
            if (user && !isUserInTop) {
                cardsWrap.appendChild(this.#renderSeparator());
                const userCard = renderCard(user, { isUser: true, isPending: !!user._pending });
                userCard.style.setProperty('--lb-delay', `${top.length * 60}ms`);
                cardsWrap.appendChild(userCard);
            }
        }

        this.#container.appendChild(cardsWrap);
        this.#container.appendChild(this.#renderFooter(total));
    }

    #renderSortBar() {
        const bar = document.createElement('div');
        bar.className = 'lb-sortbar';
        bar.setAttribute('role', 'tablist');
        bar.setAttribute('aria-label', 'Sortēt pēc');

        for (const [key, info] of Object.entries(SORTERS)) {
            const btn = document.createElement('button');
            btn.className = 'lb-sort-btn';
            btn.type = 'button';
            btn.dataset.sort = key;
            btn.setAttribute('role', 'tab');
            btn.setAttribute('aria-selected', String(this.#sortBy === key));
            if (this.#sortBy === key) btn.classList.add('active');
            btn.innerHTML = `<span class="lb-sort-icon">${info.icon}</span><span class="lb-sort-label">${info.label}</span>`;
            btn.addEventListener('click', () => this.#changeSort(key));
            bar.appendChild(btn);
        }
        return bar;
    }

    #renderEmpty() {
        const empty = document.createElement('div');
        empty.className = 'lb-empty';
        empty.innerHTML = `
            <div class="lb-empty-emoji">🏆</div>
            <div class="lb-empty-text">Tu esi pirmais!</div>
            <div class="lb-empty-sub">Saglabā savu rezultātu un kļūsti par čempionu</div>
        `;
        return empty;
    }

    #renderSeparator() {
        const sep = document.createElement('div');
        sep.className = 'lb-separator';
        sep.innerHTML = '<span aria-hidden="true">• • •</span>';
        return sep;
    }

    #renderFooter(total) {
        const footer = document.createElement('div');
        footer.className = 'lb-footer';
        footer.textContent = total === 0
            ? 'Vēl nav rezultātu'
            : `${total} ${pluralize(total, 'spēlētājs', 'spēlētāji', 'spēlētāju')} šajā līmenī`;
        return footer;
    }

    #changeSort(key) {
        if (!SORTERS[key] || this.#sortBy === key) return;
        this.#sortBy = key;
        this.#render();
        this.dispatchEvent(new CustomEvent('sortchange', { detail: { sort: key } }));
    }
}

function sameName(a, b) {
    return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

function sameEntry(a, b) {
    return sameName(a.name, b.name) && a.level === b.level;
}

/** Latvian noun pluralization for counts. */
function pluralize(n, one, few, many) {
    const last2 = n % 100;
    if (last2 >= 11 && last2 <= 19) return many;
    const last = n % 10;
    if (last === 1) return one;
    if (last >= 2 && last <= 9) return few;
    return many;
}

