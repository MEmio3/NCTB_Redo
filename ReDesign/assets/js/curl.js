/* ==========================================================================
   Page curl

   The turn people actually picture when they picture a page turning: the
   corner peels, you see the back of the sheet with its own text showing
   through in reverse, and the next page is underneath the whole time.

   Three layers, all in the outgoing page's own pixel space:

     under   the next page — already mounted by the caller, never touched here
     body    the outgoing page, clipped to the part still lying flat
     flap    a copy of it, clipped to the peeled corner and reflected across
             the fold, which is what puts the back of the sheet on show

   The fold is a straight line sweeping corner to corner. Real paper curves,
   and a curved fold needs WebGL to do honestly; a straight fold is exact
   rather than approximate, and at turn speed the difference does not read.
   What sells it is not the curvature but the three things around it — seeing
   the reverse of the sheet, the shadow it drops on the page beneath, and the
   sheet lightening as it lifts away from the paper.

   Geometry. The fold is the line n·p = d, with the peeled corner on the far
   side of it. Reflecting across that line is what produces the flap:

     forward   n = (1, 1),  d sweeps w+h -> 0   (peels the bottom-right corner)
     backward  n = (-1, 1), d sweeps h -> -w    (peels the bottom-left corner)

   Reflection of p across n̂·p = d is p - 2(n̂·p - d)n̂, which for these two
   normals comes out as a plain 2×2 with determinant -1 — the mirroring is the
   whole point, since it is what shows the back of the page.
   ========================================================================== */

/**
 * A sheet has weight: it takes a moment to come off the page, swings through
 * the middle of the arc, and settles rather than stopping dead. Ease-in-out.
 * (An ease-out here spends two thirds of the turn already past halfway, which
 * reads as a wipe rather than as paper moving.)
 */
const ease = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - ((-2 * t + 2) ** 3) / 2);

const DURATION = 620;

/**
 * Clip the w×h page rect to one side of the fold, as a CSS polygon().
 *
 * Sutherland–Hodgman against a single half-plane. The rect is convex so one
 * pass is exact, and it copes with every phase of the sweep — the region is a
 * triangle at the corners and a pentagon in the middle, and this derives that
 * rather than special-casing it.
 */
function clipPolygon(w, h, nx, ny, d, keepFar) {
  const pts = [[0, 0], [w, 0], [w, h], [0, h]];
  // Positive means "keep". `keepFar` selects the peeled corner instead.
  const side = (p) => (keepFar ? nx * p[0] + ny * p[1] - d : d - nx * p[0] - ny * p[1]);

  const out = [];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const sa = side(a);
    const sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  if (out.length < 3) return 'polygon(0 0, 0 0, 0 0)';
  return `polygon(${out.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(', ')})`;
}

/** The reflection across the fold, as a CSS matrix. */
function foldMatrix(nx, d) {
  // n = (1,1):  (x,y) -> (d - y, d - x)
  // n = (-1,1): (x,y) -> (y + d, x - d)
  return nx > 0
    ? `matrix(0, -1, -1, 0, ${d.toFixed(1)}, ${d.toFixed(1)})`
    : `matrix(0, 1, 1, 0, ${(d).toFixed(1)}, ${(-d).toFixed(1)})`;
}

/**
 * The whole state of a turn at one instant — the only geometry there is.
 *
 * Pure, so the sweep can be reasoned about (and checked) a frame at a time
 * without a running animation.
 *
 * @param {number} w page width in px
 * @param {number} h page height in px
 * @param {'next'|'prev'} dir
 * @param {number} t 0 = flat, 1 = gone
 */
export function curlFrame(w, h, dir, t) {
  const forward = dir === 'next';
  const nx = forward ? 1 : -1;
  // Start with the fold on the peeling corner so nothing pops at t=0, and end
  // past the opposite corner so the sheet is fully gone.
  const from = forward ? w + h : h;
  const to = forward ? 0 : -w;
  const d = from + (to - from) * ease(Math.min(1, Math.max(0, t)));

  return {
    d,
    body: clipPolygon(w, h, nx, 1, d, false),
    flap: clipPolygon(w, h, nx, 1, d, true),
    transform: foldMatrix(nx, d),
    // Where the fold sits along the shading gradient's axis, 0..1. The crease
    // has to travel with the fold; a gradient with fixed stops is pinned to
    // the page box and drifts away from it within a few frames.
    fold: forward ? d / (w + h) : (h - d) / (w + h),
  };
}

/**
 * Turn one sheet.
 *
 * Going back is this same motion run backwards, not a mirrored one. A book has
 * no separate gesture for turning back: the sheet you just turned comes off
 * the left-hand stack and settles onto the right again, along the identical
 * arc. So `reverse` replays the forward fold from finished to flat, and the
 * caller hands it the *incoming* page — the one coming back — rather than the
 * one being left. Peeling the current page away to the left instead, which is
 * what a mirrored animation does, is a motion no book makes.
 *
 * The box is put back where it was when the turn ends; whether it then stays
 * or goes is the caller's business.
 *
 * @param {HTMLElement} box the .page to animate, temporarily moved into a wrapper
 * @param {HTMLCanvasElement} canvas its rendered face, copied for the flap
 * @param {'next'|'prev'} dir which corner the fold runs from
 * @param {{reverse?: boolean}} [opts] play the fold from finished back to flat
 * @returns {Promise<void>} resolves once the sheet has settled
 */
export function curlPage(box, canvas, dir, { reverse = false } = {}) {
  const w = box.offsetWidth;
  const h = box.offsetHeight;
  if (!w || !h) return Promise.resolve();

  const forward = dir === 'next';

  // The flap is a copy of the face. drawImage off an existing canvas is a GPU
  // blit — cheaper than re-rendering the page, and it cannot go out of step
  // with what is on screen.
  const face = document.createElement('canvas');
  face.width = canvas.width || 1;
  face.height = canvas.height || 1;
  face.className = 'curl-face';
  try {
    face.getContext('2d').drawImage(canvas, 0, 0);
  } catch {
    // A tainted or zero-sized canvas is not worth failing a page turn over.
  }

  // Two elements, not one: clip-path is applied *after* filter, so a shadow
  // on the element that carries the clip is clipped away by it. The outer flap
  // reflects and casts; the inner sheet is what gets cut to the fold.
  const flap = document.createElement('div');
  flap.className = 'curl-flap';
  flap.style.width = `${w}px`;
  flap.style.height = `${h}px`;

  const sheet = document.createElement('div');
  sheet.className = 'curl-sheet';
  const sheen = document.createElement('span');
  sheen.className = 'curl-sheen';
  sheet.append(face, sheen);
  flap.append(sheet);

  const wrap = document.createElement('div');
  wrap.className = 'curl';
  wrap.dataset.dir = dir;
  wrap.style.width = `${w}px`;
  wrap.style.height = `${h}px`;
  box.replaceWith(wrap);
  wrap.append(box, flap);
  box.classList.add('curl-body');

  // The shading runs perpendicular to the fold and the fold angle never
  // changes through a sweep, so it is a fixed gradient per direction and lives
  // in the stylesheet, keyed off data-dir.

  const paint = (t) => {
    const f = curlFrame(w, h, dir, t);
    box.style.clipPath = f.body;
    sheet.style.clipPath = f.flap;
    flap.style.transform = f.transform;
    sheen.style.setProperty('--fold', f.fold.toFixed(4));
  };

  // Lay the first state down now. Waiting for the first frame would show one
  // frame of an unclipped sheet over the page, which reads as a flicker.
  paint(reverse ? 1 : 0);

  return new Promise((resolve) => {
    let start = 0;
    let raf = 0;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      // Hand the page back intact, in the place the wrapper is holding.
      box.style.clipPath = '';
      box.classList.remove('curl-body');
      delete box.dataset.leaving;
      wrap.replaceWith(box);
      resolve();
    };

    const frame = (now) => {
      if (!start) start = now;
      const p = Math.min(1, (now - start) / DURATION);
      paint(reverse ? 1 - p : p);
      if (p < 1) raf = requestAnimationFrame(frame);
      else finish();
    };

    raf = requestAnimationFrame(frame);
    // rAF stops entirely in a background tab, so the sheet would otherwise sit
    // there forever. Guarantee the cleanup on a timer as well.
    setTimeout(finish, DURATION + 400);
  });
}
