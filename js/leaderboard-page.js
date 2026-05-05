import { fetchLeaderboardCsv } from './leaderboard-api.js';
import { parseCsv, rankForLevel, rankAll, SORTERS } from './leaderboard-data.js';
import { renderCard } from './leaderboard-ui.js';

const LEVEL_NAMES = [
    'Mājas burti', 'Mājas zilbes', 'Mājas spec. burti', 'Mājas spec. zilbes', 'Mājas vārdi',
    'Augšējās burti', 'Augšējās zilbes', 'Augšējās garumzīmes', 'Augšējās spec. zilbes', 'Mājas + Augšējā',
    'Apakšējās burti', 'Apakšējās zilbes', 'Apakšējās speciālie', 'Apakšējās spec. zilbes', 'Visu rindu vārdi',
    'Teikumi',
];

const $title = document.getElementById('lpTitle');
const $level = document.getElementById('lpLevel');
const $sort  = document.getElementById('lpSort');
const $list  = document.getElementById('lpList');
const $info  = document.getElementById('lpInfo');
const $share = document.getElementById('lpShare');

const PAGE_SIZE = 10;
let allEntries = [];
let currentPage = 1;
let rankedCache = [];

function readParams() {
    const p = new URLSearchParams(location.search);
    const level = p.get('level');
    const sort  = p.get('sort') || 'score';
    return {
        level: level ? Number(level) : null,
        sort:  SORTERS[sort] ? sort : 'score',
    };
}

function writeParams(level, sort) {
    const p = new URLSearchParams();
    if (level) p.set('level', String(level));
    if (sort && sort !== 'score') p.set('sort', sort);
    const qs = p.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

function buildLevelOptions() {
    LEVEL_NAMES.forEach((name, i) => {
        const opt = document.createElement('option');
        opt.value = String(i + 1);
        opt.textContent = `${i + 1}. ${name}`;
        $level.appendChild(opt);
    });
}

function buildSortBar(activeSort) {
    $sort.innerHTML = '';
    for (const [key, info] of Object.entries(SORTERS)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'lp-sort-btn';
        if (key === activeSort) btn.classList.add('active');
        btn.dataset.sort = key;
        btn.innerHTML = `<span class="lp-sort-icon">${info.icon}</span><span class="lp-sort-label">${info.label}</span>`;
        btn.addEventListener('click', () => {
            if (key === currentSort) return;
            currentSort = key;
            writeParams(currentLevel, currentSort);
            buildSortBar(currentSort);
            renderList();
        });
        $sort.appendChild(btn);
    }
}

function pluralize(n, one, few, many) {
    const last2 = n % 100;
    if (last2 >= 11 && last2 <= 19) return many;
    const last = n % 10;
    if (last === 1) return one;
    if (last >= 2 && last <= 9) return few;
    return many;
}

function updateTitle() {
    const sortLabel = SORTERS[currentSort]?.label || 'Punkti';
    const levelLabel = currentLevel
        ? `${currentLevel}. ${LEVEL_NAMES[currentLevel - 1]}`
        : 'Visi līmeņi';
    const heading = `${levelLabel} — ${sortLabel}`;
    $title.textContent = heading;

    const pageTitle = `${heading} — Burtu Trepe`;
    const desc = currentLevel
        ? `Burtu Trepe ${levelLabel} — labākie rezultāti pēc ${sortLabel.toLowerCase()}`
        : `Burtu Trepe rezultātu tabula — visi līmeņi, ${sortLabel.toLowerCase()}`;
    document.title = pageTitle;
    setMeta('metaDesc', 'content', desc);
    setMeta('ogTitle', 'content', pageTitle);
    setMeta('ogDesc', 'content', desc);
    setMeta('twTitle', 'content', pageTitle);
    setMeta('twDesc', 'content', desc);
}

function setMeta(id, attr, value) {
    const el = document.getElementById(id);
    if (el) el.setAttribute(attr, value);
}

function renderList() {
    rankedCache = currentLevel
        ? rankForLevel(allEntries, currentLevel, currentSort)
        : rankAll(allEntries, currentSort);
    currentPage = 1;
    updateTitle();
    renderPage();
}

function renderPage() {
    $list.innerHTML = '';

    if (rankedCache.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'lp-empty';
        const playHref = currentLevel ? `index.html?level=${currentLevel}` : 'index.html';
        const playLink = `<a href="${playHref}" class="lp-play-cta">▶ Pierādi, ka Tu vari!</a>`;
        empty.innerHTML = `
            <div class="lp-empty-emoji">🏆</div>
            <div class="lp-empty-text">Esi pirmais!</div>
            <div class="lp-empty-sub">Neviens vēl nav spēlējis šo līmeni — iekaro pirmo vietu!</div>
            ${playLink}
        `;
        $list.appendChild(empty);
        $info.textContent = '';
        return;
    }

    const totalPages = Math.ceil(rankedCache.length / PAGE_SIZE);
    const start = (currentPage - 1) * PAGE_SIZE;
    const page = rankedCache.slice(start, start + PAGE_SIZE);

    page.forEach((entry, i) => {
        const card = renderCard(entry, { showLevel: true });
        card.style.setProperty('--lb-delay', `${i * 40}ms`);
        $list.appendChild(card);
    });

    $info.textContent = `${rankedCache.length} ${pluralize(rankedCache.length, 'rezultāts', 'rezultāti', 'rezultātu')}`;

    if (totalPages > 1) $list.appendChild(buildPager(totalPages));
}

function buildPager(totalPages) {
    const pager = document.createElement('div');
    pager.className = 'lp-pager';

    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'lp-pager-btn';
    prev.textContent = '←';
    prev.disabled = currentPage === 1;
    prev.addEventListener('click', () => { currentPage--; renderPage(); scrollToList(); });

    const label = document.createElement('span');
    label.className = 'lp-pager-label';
    label.textContent = `${currentPage} / ${totalPages}`;

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'lp-pager-btn';
    next.textContent = '→';
    next.disabled = currentPage === totalPages;
    next.addEventListener('click', () => { currentPage++; renderPage(); scrollToList(); });

    pager.append(prev, label, next);
    return pager;
}

function scrollToList() {
    $list.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let currentLevel;
let currentSort;

async function init() {
    const params = readParams();
    currentLevel = params.level;
    currentSort  = params.sort;

    buildLevelOptions();
    if (currentLevel) $level.value = String(currentLevel);
    buildSortBar(currentSort);

    $level.addEventListener('change', () => {
        currentLevel = $level.value ? Number($level.value) : null;
        writeParams(currentLevel, currentSort);
        renderList();
    });

    $share.addEventListener('click', shareCurrentPage);

    $info.textContent = 'Ielādē…';
    try {
        const csv = await fetchLeaderboardCsv({ ttlMs: 30_000 });
        allEntries = parseCsv(csv);
        renderList();
    } catch {
        $info.textContent = 'Neizdevās ielādēt datus.';
    }
}

async function shareCurrentPage() {
    const url = location.href;
    const levelLabel = currentLevel
        ? `${currentLevel}. ${LEVEL_NAMES[currentLevel - 1]}`
        : 'Visi līmeņi';
    const text = `Burtu Trepe — ${levelLabel} rezultāti`;

    if (navigator.share) {
        try {
            await navigator.share({ title: text, url });
        } catch { /* user cancelled */ }
        return;
    }

    try {
        await navigator.clipboard.writeText(url);
        const orig = $share.textContent;
        $share.textContent = '✅ Nokopēts!';
        setTimeout(() => { $share.textContent = orig; }, 2000);
    } catch { /* clipboard unavailable */ }
}

init();
