/* ==========================================================================
   The shelf

   The catalogue is stored as collection pages, but a student does not think
   in pages — they think "class 6, this year, my subjects". So the collections
   are flattened into individual books once at load, and the page walks:

       class  →  year  →  the books

   Search short-circuits all of it for anyone who knows the title.
   ========================================================================== */

import { $, $$, esc, fmt, debounce, reduceMotion, bindTheme } from './core.js';
import { coverURL, bestLink, readerHref, loadLocalIndex, localCopy, localCoverURL,
         yearOrigin } from './sources.js';
import { listDocs } from './store.js';

const PAGE = 48;

const LEVEL = {
  'pre-primary': 'Pre-primary',
  primary: 'Primary',
  ebtedayi: 'Ebtedayi',
  secondary: 'Secondary',
  dakhil: 'Dakhil',
  'higher-secondary': 'Higher secondary',
  vocational: 'Vocational',
};

const norm = (s) => String(s ?? '').normalize('NFC').toLowerCase();

/**
 * English names for subjects whose books are titled in Bengali.
 *
 * Nearly every textbook here carries a Bengali title, so an English query
 * matches almost nothing: typing "Bangla" finds "Bangladesh and Global
 * Studies" — an English-titled book — and misses "আমার বাংলা বই" entirely,
 * which is the one the reader wanted. Folding these words into the haystack
 * costs one pass at load and makes the search work in the language people
 * actually type in.
 */
const SUBJECT_WORDS = [
  ['বাংলা', 'bangla bengali'],
  ['ইংরেজি', 'english'],
  ['গণিত', 'math maths mathematics'],
  ['বিজ্ঞান', 'science'],
  ['সমাজ', 'social society'],
  ['ইতিহাস', 'history'],
  ['ভূগোল', 'geography'],
  ['পদার্থ', 'physics'],
  ['রসায়ন', 'chemistry'],
  ['জীববিজ্ঞান', 'biology'],
  ['ইসলাম', 'islam islamic religion'],
  ['হিন্দু', 'hindu religion'],
  ['খ্রিষ্ট', 'christian religion'],
  ['বৌদ্ধ', 'buddhist religion'],
  ['ধর্ম', 'religion moral'],
  ['স্বাস্থ্য', 'health'],
  ['শিল্পকলা', 'arts crafts'],
  ['কৃষি', 'agriculture'],
  ['হিসাববিজ্ঞান', 'accounting'],
  ['অর্থনীতি', 'economics'],
  ['পৌরনীতি', 'civics'],
  ['তথ্য', 'ict computer information'],
  ['কর্ম', 'career work'],
  ['শিক্ষা', 'education studies'],
  ['প্রাথমিক', 'primary'],
  ['কুরআন', 'quran'],
  ['আরবি', 'arabic'],
];

/** Any English words that go with the Bengali present in a title. */
function alsoKnownAs(text) {
  const t = String(text ?? '').normalize('NFC');
  const extra = [];
  for (const [bn, en] of SUBJECT_WORDS) if (t.includes(bn)) extra.push(en);
  return extra.join(' ');
}

const state = { books: [], grade: null, year: null, level: null, q: '', shown: PAGE };

/* --------------------------------------------------------------------------
   Flatten collections into books
   -------------------------------------------------------------------------- */

function flatten(collections) {
  const seen = new Map();
  collections.forEach((c) => {
    c.items.forEach((item) => {
      const link = bestLink(item.links);
      if (!link) return;
      const cover = item.links.find((l) => l.source === 'drive' && l.fileId)?.fileId || null;

      // The same book is listed on several collection pages (a year page and a
      // level page, say). Key on the file so it appears once.
      const key = `${link.url}::${norm(item.label)}`;
      const existing = seen.get(key);
      if (existing) {
        // Keep the richest classification we have seen for this file.
        existing.grade ??= c.grade;
        for (const g of c.grades || []) {
          if (!existing.grades.includes(g)) existing.grades.push(g);
        }
        existing.level ??= c.level;
        existing.year = Math.max(existing.year || 0, c.year || 0) || null;
        return;
      }
      seen.set(key, {
        title: item.label,
        links: item.links,
        link,
        cover,
        grade: c.grade ?? null,
        // A secondary textbook is published for "নবম-দশম" — classes 9 and 10
        // both — so a book can belong to more than one class.
        grades: c.grades?.length ? c.grades : (c.grade == null ? [] : [c.grade]),
        year: c.year ?? null,
        level: c.level ?? null,
        version: c.version,
        kind: c.kind,
        path: c.path,
        _hay: norm(`${item.label} ${c.title} ${alsoKnownAs(`${item.label} ${c.title}`)}`),
      });
    });
  });
  return [...seen.values()];
}

/* --------------------------------------------------------------------------
   Rendering
   -------------------------------------------------------------------------- */

/**
 * Cover art for a book: our own render first, Drive's thumbnail otherwise.
 *
 * Drive rate-limits thumbnails independently of the files, so a popular book
 * showed a grey tile even once its PDF was downloaded here. Page one of the
 * local copy is the same picture and always available.
 */
function coverSrc(b, ref) {
  return localCoverURL(ref) || (b.cover ? coverURL(b.cover, 300) : null);
}

function bookCard(b, i) {
  const href = readerHref({ path: b.path, label: b.title, link: b.link, links: b.links });
  const meta = [];
  if (b.year) meta.push(`<span>${b.year}</span>`);
  if (b.level) meta.push(`<span>${esc(LEVEL[b.level] || b.level)}</span>`);
  if (b.version === 'english') meta.push('<span class="en">English</span>');

  // Held in books/ by the fetcher: opens instantly, offline, no Google.
  const ref = {
    driveId: b.link?.source === 'drive' ? b.link.fileId : null,
    url: b.link?.url,
  };
  const offline = Boolean(localCopy(ref));
  const art = coverSrc(b, ref);

  return `
    <article class="book${offline ? ' is-offline' : ''}" style="--i:${i}">
      <a class="book-cover" href="${esc(href)}" aria-label="Open ${esc(b.title)}${offline ? ', saved on this device' : ''}">
        ${offline ? '<span class="offline-dot" title="Saved on this device — opens instantly, offline" aria-hidden="true"></span>' : ''}
        <span class="book-blank"><span>${esc(b.title)}</span></span>
        ${art
          ? `<img src="${esc(art)}" alt="" loading="lazy" decoding="async"
                  referrerpolicy="no-referrer" width="300" height="400" onerror="this.remove()">`
          : ''}
      </a>
      <a class="book-title" href="${esc(href)}">${esc(b.title)}</a>
      <p class="book-meta">${meta.join('')}</p>
    </article>`;
}

function matching() {
  const terms = norm(state.q).trim().split(/\s+/).filter(Boolean);
  return state.books.filter((b) => {
    if (terms.length) return terms.every((t) => b._hay.includes(t));
    if (state.grade !== null && !b.grades.includes(state.grade)) return false;
    if (state.year !== null && b.year !== state.year) return false;
    if (state.level !== null && b.level !== state.level) return false;
    return true;
  });
}

function render() {
  const rows = matching();
  const slice = rows.slice(0, state.shown);

  $('#grid').innerHTML = slice.map(bookCard).join('');
  $('#none').hidden = rows.length > 0;
  $('#more').hidden = rows.length <= state.shown;
  $('#books-wrap').hidden = false;

  $('#count').textContent = rows.length
    ? `${fmt.format(rows.length)} ${rows.length === 1 ? 'book' : 'books'}`
    : '';
}

/** Year and level options are derived from the books actually in scope. */
function renderFilters() {
  const scope = state.books.filter((b) => state.grade === null || b.grades.includes(state.grade));

  // A year is judged against the whole catalogue, not the current class, so a
  // year does not read as "streamed" merely because this class has few books.
  const listed = new Map();
  for (const b of state.books) listed.set(b.year, (listed.get(b.year) || 0) + 1);

  const years = [...new Set(scope.map((b) => b.year).filter(Boolean))].sort((a, b) => b - a);
  $('#years').innerHTML = years.map((y) => {
    const here = yearOrigin(y, listed.get(y)) === 'local';
    return `
    <button class="pill${here ? ' pill-local' : ''}" type="button" data-year="${y}"
            aria-pressed="${state.year === y}"
            title="${here ? 'Stored here — opens instantly' : 'Streams from NCTB'}">${y}${
      here ? '<span class="pill-dot" aria-hidden="true"></span>' : ''
    }</button>`;
  }).join('');
  $('#year-row').hidden = years.length < 2;

  // Say where the books are coming from, but only when it is worth knowing:
  // silent for a stored year, a warning only when one is actually selected.
  const note = $('#year-note');
  const remote = state.year !== null && yearOrigin(state.year, listed.get(state.year)) !== 'local';
  note.textContent = remote
    ? `${state.year} books stream from NCTB — slower, and Google may rate-limit a popular title.`
    : '';
  note.hidden = !remote;

  const inYear = scope.filter((b) => state.year === null || b.year === state.year);
  const levels = [...new Set(inYear.map((b) => b.level).filter(Boolean))];
  $('#levels').innerHTML = levels.map((l) => `
    <button class="pill" type="button" data-level="${esc(l)}" aria-pressed="${state.level === l}">${esc(LEVEL[l] || l)}</button>`).join('');
  $('#level-row').hidden = levels.length < 2;
}

function renderClasses() {
  const grades = [...new Set(state.books.flatMap((b) => b.grades))].sort((a, b) => a - b);
  $('#classes').innerHTML = grades.map((g, i) => {
    const n = state.books.filter((b) => b.grades.includes(g)).length;
    return `
      <button class="class-btn" type="button" data-grade="${g}" style="--i:${i}" aria-pressed="${state.grade === g}">
        <span class="class-n">${g}<small>Class</small></span>
        <span class="class-count">${fmt.format(n)} books</span>
      </button>`;
  }).join('');
}

/* --------------------------------------------------------------------------
   Navigation between the two steps
   -------------------------------------------------------------------------- */

function showClasses() {
  state.grade = null;
  state.level = null;
  state.q = '';
  $('#q').value = '';
  $('#pick').hidden = false;
  $('#refine').hidden = true;
  $('#books-wrap').hidden = true;
  renderClasses();
  syncURL();
}

function showBooks({ scrollTo = true } = {}) {
  $('#pick').hidden = Boolean(state.grade !== null);
  $('#refine').hidden = state.grade === null && !state.q;

  if (state.grade !== null) {
    $('#refine-title').textContent = `Class ${state.grade}`;
  } else if (state.q) {
    $('#refine-title').textContent = `Results for “${state.q}”`;
  }

  renderFilters();
  render();
  syncURL();

  if (scrollTo) {
    // Only move if the results are not already sitting at the top. Searching
    // re-runs this on every keystroke, and re-scrolling each time would fight
    // the reader; the results are below a full-height hero, so leaving them
    // there means hunting for them by hand.
    const top = $('#refine').getBoundingClientRect().top;
    if (top > 140 || top < -40) {
      $('#refine').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

function pickClass(grade) {
  state.grade = grade;
  state.q = '';
  $('#q').value = '';
  state.level = null;
  state.shown = PAGE;

  // Default to the newest year that class actually has, so the shelf opens on
  // this year's books rather than a wall of every edition ever printed.
  const years = state.books.filter((b) => b.grades.includes(grade)).map((b) => b.year).filter(Boolean);
  state.year = years.length ? Math.max(...years) : null;

  renderClasses();
  showBooks();
}

/* --------------------------------------------------------------------------
   URL state
   -------------------------------------------------------------------------- */

function syncURL() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  else {
    if (state.grade !== null) p.set('class', state.grade);
    if (state.year !== null) p.set('year', state.year);
    if (state.level !== null) p.set('level', state.level);
  }
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

function readURL() {
  const p = new URLSearchParams(location.search);
  const g = p.get('class');
  state.q = p.get('q') || '';
  state.grade = g !== null && g !== '' ? Number(g) : null;
  const y = p.get('year');
  state.year = y ? Number(y) : null;
  state.level = p.get('level') || null;
}

/* --------------------------------------------------------------------------
   Continue reading
   -------------------------------------------------------------------------- */

async function renderResume() {
  let docs = [];
  try { docs = await listDocs(); } catch { return; }
  docs = docs.filter((d) => d.pageCount);
  if (!docs.length) return;

  $('#resume-row').innerHTML = docs.slice(0, 8).map((d) => {
    const id = d.driveId || (d.id.startsWith('drive:') ? d.id.slice(6) : null);
    return `
      <a class="resume-card" href="./reader.html?doc=${encodeURIComponent(d.id)}">
        ${(() => {
          const src = localCoverURL({ driveId: id }) || (id ? coverURL(id, 120) : null);
          return src
            ? `<img class="resume-cover" src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" width="120" height="160" onerror="this.remove()">`
            : '<span class="resume-cover"></span>';
        })()}
        <span>
          <b>${esc(d.title || 'Untitled')}</b>
          <small>page ${d.lastPage || 1} of ${d.pageCount}</small>
          <span class="resume-bar"><i style="width:${Math.round(((d.lastPage || 1) / d.pageCount) * 100)}%"></i></span>
        </span>
      </a>`;
  }).join('');
  $('#resume').hidden = false;
}

/* --------------------------------------------------------------------------
   Hero: the cover wall, and the numbers counting up
   -------------------------------------------------------------------------- */

/** Two rows of real covers drifting opposite ways. Duplicated so -50% loops. */
function buildWall(books) {
  const wall = $('#wall');
  const seen = new Set();
  const picks = [];
  for (const b of books) {
    const src = coverSrc(b, {
      driveId: b.link?.source === 'drive' ? b.link.fileId : null,
      url: b.link?.url,
    });
    if (!src || seen.has(src)) continue;
    seen.add(src);
    picks.push([b, src]);
    if (picks.length >= 46) break;
  }
  if (picks.length < 10) { wall.remove(); return; }

  const tile = ([b, src]) => {
    const box = document.createElement('div');
    box.className = 'cv';
    box.title = b.title;
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.width = 260; img.height = 347;
    img.addEventListener('load', () => img.setAttribute('data-in', 'true'), { once: true });
    img.addEventListener('error', () => box.remove(), { once: true });
    box.append(img);
    return box;
  };

  const half = Math.ceil(picks.length / 2);
  [picks.slice(0, half), picks.slice(half)].forEach((set, row) => {
    const track = document.createElement('div');
    track.className = row ? 'wall-row wall-row--rev' : 'wall-row';
    [...set, ...set].forEach((b) => track.append(tile(b)));
    wall.append(track);
  });
}

/**
 * Count from zero to `value`.
 *
 * The final figure is written first, so a browser that never runs animation
 * frames — a background tab, reduced motion — shows the real number rather
 * than a permanent zero. The ramp only starts once a frame actually arrives.
 */
function countUp(el, value) {
  const target = Number(value) || 0;
  el.textContent = fmt.format(target);
  if (reduceMotion()) return;

  const dur = 1100;
  requestAnimationFrame((t0) => {
    const step = (now) => {
      const p = Math.min((now - t0) / dur, 1);
      el.textContent = fmt.format(Math.round(target * (1 - (1 - p) ** 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    step(t0);
    setTimeout(() => { el.textContent = fmt.format(target); }, dur + 250);
  });
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

async function init() {
  bindTheme($('[data-theme-toggle]'));

  let data;
  try {
    data = await (await fetch('./data/library.json')).json();
  } catch (err) {
    console.error('[shelf]', err);
    $('#classes').innerHTML = '<p class="none">The book list could not be loaded.</p>';
    return;
  }

  // The local library is authoritative for what opens instantly, so it has to
  // be loaded before the first card is drawn.
  await loadLocalIndex();
  state.books = flatten(data.collections);

  document.documentElement.classList.add('js-ready');
  buildWall(state.books);
  countUp($('#stat-books'), state.books.length);
  countUp($('#stat-years'), new Set(state.books.map((b) => b.year).filter(Boolean)).size);

  // Hairline under the bar only once the hero has scrolled past it.
  const sentinel = document.createElement('div');
  $('#hero').before(sentinel);
  new IntersectionObserver(([e]) => {
    $('.bar').dataset.stuck = String(!e.isIntersecting);
  }, { threshold: 1 }).observe(sentinel);

  readURL();
  renderClasses();
  renderResume();

  if (state.q || state.grade !== null) showBooks({ scrollTo: false });

  /* --- events --- */

  $('#classes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-grade]');
    if (b) pickClass(Number(b.dataset.grade));
  });

  $('#back-classes').addEventListener('click', () => {
    showClasses();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  $('#years').addEventListener('click', (e) => {
    const b = e.target.closest('[data-year]');
    if (!b) return;
    const y = Number(b.dataset.year);
    state.year = state.year === y ? null : y;
    state.level = null;
    state.shown = PAGE;
    showBooks({ scrollTo: false });
  });

  $('#levels').addEventListener('click', (e) => {
    const b = e.target.closest('[data-level]');
    if (!b) return;
    state.level = state.level === b.dataset.level ? null : b.dataset.level;
    state.shown = PAGE;
    showBooks({ scrollTo: false });
  });

  $('#q').addEventListener('input', debounce((e) => {
    state.q = e.target.value.trim();
    state.shown = PAGE;
    if (state.q) {
      state.grade = null;
      state.year = null;
      state.level = null;
      renderClasses();
      showBooks();
    } else if (state.grade === null) {
      showClasses();
    } else {
      showBooks({ scrollTo: false });
    }
  }, 160));

  $('#more').addEventListener('click', () => {
    state.shown += PAGE;
    render();
  });

  // The cover you click carries into the reader. Only one element may hold a
  // given view-transition-name, so it is assigned on the way out and cleared
  // if the reader is restored from the back/forward cache.
  $('#grid').addEventListener('click', (e) => {
    const cover = e.target.closest('.book-cover');
    if (!cover || !document.startViewTransition) return;
    $$('.book-cover').forEach((c) => { c.style.viewTransitionName = ''; });
    cover.style.viewTransitionName = 'book';
  });
  window.addEventListener('pageshow', () => {
    $$('.book-cover').forEach((c) => { c.style.viewTransitionName = ''; });
  });
}

init();
