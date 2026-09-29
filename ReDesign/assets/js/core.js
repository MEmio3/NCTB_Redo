/* ==========================================================================
   Shared helpers for the shelf and the reader.

   Deliberately small. An earlier version auto-ran a boot() on import that
   bound its own theme handler, which then fought with each page's — so
   nothing here runs on load. Pages call what they need.
   ========================================================================== */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const reduceMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Escape a value for interpolation into an HTML template. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export const fmt = new Intl.NumberFormat('en-US');

/** Debounce that keeps the latest call's arguments. */
export function debounce(fn, wait = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/* --------------------------------------------------------------------------
   Theme — light is the default; dark is night reading.
   -------------------------------------------------------------------------- */

const THEME_KEY = 'atlas:theme';

export const isLightTheme = () =>
  (localStorage.getItem(THEME_KEY)
    || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')) === 'light';

/** Wire a toggle button. `aria-pressed` means "night reading is on". */
export function bindTheme(btn) {
  if (!btn) return;
  const sync = () => btn.setAttribute('aria-pressed', String(!isLightTheme()));
  btn.addEventListener('click', () => {
    const next = isLightTheme() ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(THEME_KEY, next);
    sync();
  });
  sync();
}

/* --------------------------------------------------------------------------
   Toasts
   -------------------------------------------------------------------------- */

function toastStack() {
  let stack = $('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    document.body.append(stack);
  }
  return stack;
}

export function toast(message, tone = 'info', ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.tone = tone;
  el.textContent = message;
  toastStack().append(el);
  setTimeout(() => {
    el.dataset.leaving = 'true';
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 600);   // animationend never fires when hidden
  }, ms);
  return el;
}
