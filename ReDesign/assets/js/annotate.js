/* ==========================================================================
   NCTB Atlas — annotation layer

   Every mark is stored in normalised page coordinates (0..1 on both axes)
   rather than pixels. That single decision means zooming, resizing and
   re-rendering at a different device pixel ratio all cost nothing: the SVG
   overlay uses `viewBox="0 0 1 1"` with `preserveAspectRatio="none"`, so the
   browser maps stored coordinates onto whatever size the page is drawn at.

   Marks:
     highlight  {x, y, w, h}          translucent block, multiply-blended
     rect       {x, y, w, h}          outline box
     pen        {pts: [[x, y], ...]}  freehand polyline
     note       {x, y, text}          pin that opens the note editor
     text       {x, y, text, size}    text written onto the page
     bookmark   page only, no geometry
   ========================================================================== */

const SVG_NS = 'http://www.w3.org/2000/svg';

export const TOOLS = ['pan', 'highlight', 'pen', 'rect', 'note', 'text', 'erase'];

/* Print-ink hues rather than screen neon: each one sits over a scanned page
   without hiding the text underneath it. Mirrors --mark-* in tokens.css. */
export const PALETTE = [
  { name: 'হলুদ', value: '#f2c14e' },
  { name: 'লাল',  value: '#e8836f' },
  { name: 'সবুজ', value: '#7fc8a0' },
  { name: 'নীল',  value: '#7cb3d9' },
  { name: 'বেগুনি', value: '#a68cc8' },
  { name: 'কালো', value: '#33302b' },
];

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/**
 * @param {object} opts
 * @param {() => string} opts.getTool     current tool id
 * @param {() => string} opts.getColor    current colour
 * @param {(mark) => void} opts.onCreate  a finished mark, without id/docId
 * @param {(mark) => void} opts.onDelete
 * @param {(mark) => void} opts.onEditNote opens the text editor for a mark
 */
export function createAnnotator({ getTool, getColor, onCreate, onDelete, onEditNote }) {
  /** pageNum -> { box, svg, marksG, draftG, pins } */
  const layers = new Map();
  /** pageNum -> mark[] */
  const byPage = new Map();

  /* ---------------------------------------------------------------- layers */

  function attach(box, pageNum) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'layer');
    svg.setAttribute('viewBox', '0 0 1 1');
    svg.setAttribute('preserveAspectRatio', 'none');
    // Deliberately not `data-tool` — the toolbar buttons own that attribute,
    // and a shared name would make `[data-tool]` select the overlays too.
    svg.dataset.activeTool = getTool();

    const marksG = document.createElementNS(SVG_NS, 'g');
    const draftG = document.createElementNS(SVG_NS, 'g');
    svg.append(marksG, draftG);

    const pins = document.createElement('div');
    pins.className = 'pin-layer';

    box.append(svg, pins);
    layers.set(pageNum, { box, svg, marksG, draftG, pins });

    bindPointer(pageNum);
    draw(pageNum);
    return svg;
  }

  function detach(pageNum) {
    const layer = layers.get(pageNum);
    if (!layer) return;
    layer.svg.remove();
    layer.pins.remove();
    layers.delete(pageNum);
  }

  function setTool(tool) {
    layers.forEach((l) => { l.svg.dataset.activeTool = tool; });
  }

  /* ----------------------------------------------------------------- marks */

  function setMarks(marks) {
    byPage.clear();
    marks.forEach((m) => {
      if (!byPage.has(m.page)) byPage.set(m.page, []);
      byPage.get(m.page).push(m);
    });
    layers.forEach((_, page) => draw(page));
  }

  function addMark(mark) {
    if (!byPage.has(mark.page)) byPage.set(mark.page, []);
    byPage.get(mark.page).push(mark);
    draw(mark.page);
  }

  function removeMark(mark) {
    const list = byPage.get(mark.page);
    if (!list) return;
    const i = list.findIndex((m) => m.id === mark.id);
    if (i >= 0) list.splice(i, 1);
    draw(mark.page);
  }

  function updateMark(mark) {
    const list = byPage.get(mark.page) || [];
    const i = list.findIndex((m) => m.id === mark.id);
    if (i >= 0) list[i] = mark;
    draw(mark.page);
  }

  const marksOn = (page) => byPage.get(page) || [];

  /* --------------------------------------------------------------- drawing */

  function shapeFor(mark) {
    if (mark.type === 'highlight') {
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', mark.x); r.setAttribute('y', mark.y);
      r.setAttribute('width', mark.w); r.setAttribute('height', mark.h);
      r.setAttribute('fill', mark.color);
      r.setAttribute('fill-opacity', '0.38');
      // Multiply keeps the scanned text readable through the wash.
      r.setAttribute('style', 'mix-blend-mode: multiply');
      return r;
    }
    if (mark.type === 'rect') {
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', mark.x); r.setAttribute('y', mark.y);
      r.setAttribute('width', mark.w); r.setAttribute('height', mark.h);
      r.setAttribute('fill', 'none');
      r.setAttribute('stroke', mark.color);
      r.setAttribute('stroke-width', '2.5');
      r.setAttribute('vector-effect', 'non-scaling-stroke');
      return r;
    }
    if (mark.type === 'pen' && mark.pts?.length) {
      const p = document.createElementNS(SVG_NS, 'polyline');
      p.setAttribute('points', mark.pts.map(([x, y]) => `${x},${y}`).join(' '));
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', mark.color);
      p.setAttribute('stroke-width', String(mark.width || 3));
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      // Without this the stroke would squash on non-square pages.
      p.setAttribute('vector-effect', 'non-scaling-stroke');
      return p;
    }
    return null;
  }

  function draw(page) {
    const layer = layers.get(page);
    if (!layer) return;

    layer.marksG.replaceChildren();
    layer.pins.replaceChildren();

    const width = layer.box.clientWidth || 1;

    marksOn(page).forEach((mark) => {
      if (mark.type === 'note') {
        const pin = document.createElement('button');
        pin.type = 'button';
        pin.className = 'pin';
        pin.style.cssText = `left:${mark.x * 100}%;top:${mark.y * 100}%;--c:${mark.color}`;
        pin.textContent = '✎';
        pin.title = mark.text || 'Note';
        pin.setAttribute('aria-label', `Note on page ${page}: ${mark.text || 'empty'}`);
        pin.addEventListener('click', (e) => {
          e.stopPropagation();
          if (getTool() === 'erase') onDelete(mark);
          else onEditNote(mark);
        });
        layer.pins.append(pin);
        return;
      }

      if (mark.type === 'text') {
        const el = document.createElement('div');
        el.className = 'text-mark';
        el.style.cssText =
          `left:${mark.x * 100}%;top:${mark.y * 100}%;--c:${mark.color};` +
          `font-size:${Math.max(9, (mark.size || 0.026) * width)}px`;
        el.textContent = mark.text || '';
        el.style.pointerEvents = 'auto';
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (getTool() === 'erase') onDelete(mark);
          else onEditNote(mark);
        });
        layer.pins.append(el);
        return;
      }

      const shape = shapeFor(mark);
      if (!shape) return;
      shape.classList.add('hit');
      shape.addEventListener('click', (e) => {
        if (getTool() !== 'erase') return;
        e.stopPropagation();
        onDelete(mark);
      });
      layer.marksG.append(shape);
    });
  }

  /** Redraw every attached page — used after a zoom, for text sizing. */
  function redrawAll() { layers.forEach((_, page) => draw(page)); }

  /* -------------------------------------------------------------- pointers */

  function pointOf(evt, svg) {
    const r = svg.getBoundingClientRect();
    return {
      x: clamp01((evt.clientX - r.left) / r.width),
      y: clamp01((evt.clientY - r.top) / r.height),
    };
  }

  function bindPointer(page) {
    const { svg, draftG } = layers.get(page);

    svg.addEventListener('pointerdown', (evt) => {
      const tool = getTool();
      if (tool === 'pan' || tool === 'erase') return;
      if (evt.button !== 0) return;

      const color = getColor();
      const start = pointOf(evt, svg);

      /* --- one-click tools --- */
      if (tool === 'note') {
        onCreate({ page, type: 'note', x: start.x, y: start.y, color, text: '' });
        return;
      }
      if (tool === 'text') {
        onCreate({ page, type: 'text', x: start.x, y: start.y, color, text: '', size: 0.026 });
        return;
      }

      /* --- drag tools --- */
      evt.preventDefault();
      svg.setPointerCapture(evt.pointerId);

      const pts = [[start.x, start.y]];
      let preview = null;

      const paint = () => {
        draftG.replaceChildren();
        const mark = tool === 'pen'
          ? { type: 'pen', color, pts, width: 3 }
          : {
              type: tool,
              color,
              x: Math.min(start.x, preview.x),
              y: Math.min(start.y, preview.y),
              w: Math.abs(preview.x - start.x),
              h: Math.abs(preview.y - start.y),
            };
        const shape = shapeFor(mark);
        if (shape) {
          shape.setAttribute('opacity', '0.75');
          draftG.append(shape);
        }
      };

      const move = (e) => {
        preview = pointOf(e, svg);
        if (tool === 'pen') {
          const [lx, ly] = pts[pts.length - 1];
          // Drop points closer than ~0.3% of the page to keep paths small.
          if (Math.hypot(preview.x - lx, preview.y - ly) < 0.003) return;
          pts.push([preview.x, preview.y]);
        }
        paint();
      };

      const finish = (e) => {
        svg.releasePointerCapture?.(evt.pointerId);
        svg.removeEventListener('pointermove', move);
        svg.removeEventListener('pointerup', finish);
        svg.removeEventListener('pointercancel', cancel);
        draftG.replaceChildren();

        preview = pointOf(e, svg);
        if (tool === 'pen') {
          if (pts.length < 2) return;
          onCreate({ page, type: 'pen', color, pts, width: 3 });
          return;
        }
        const w = Math.abs(preview.x - start.x);
        const h = Math.abs(preview.y - start.y);
        // Ignore accidental taps that produce a degenerate box.
        if (w < 0.008 || h < 0.006) return;
        onCreate({
          page, type: tool, color,
          x: Math.min(start.x, preview.x),
          y: Math.min(start.y, preview.y),
          w, h,
        });
      };

      const cancel = () => {
        svg.removeEventListener('pointermove', move);
        svg.removeEventListener('pointerup', finish);
        svg.removeEventListener('pointercancel', cancel);
        draftG.replaceChildren();
      };

      svg.addEventListener('pointermove', move);
      svg.addEventListener('pointerup', finish);
      svg.addEventListener('pointercancel', cancel);
    });
  }

  return {
    attach, detach, setTool, setMarks, addMark, removeMark, updateMark,
    draw, redrawAll, marksOn,
    attached: (page) => layers.has(page),
  };
}

/* --------------------------------------------------------------------------
   Static painting — used for exporting a flattened PDF.
   Draws the same marks onto a 2D canvas context sized w × h pixels.
   -------------------------------------------------------------------------- */

export function paintMarks(ctx, marks, w, h) {
  marks.forEach((m) => {
    ctx.save();
    if (m.type === 'highlight') {
      ctx.globalAlpha = 0.38;
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = m.color;
      ctx.fillRect(m.x * w, m.y * h, m.w * w, m.h * h);
    } else if (m.type === 'rect') {
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(m.x * w, m.y * h, m.w * w, m.h * h);
    } else if (m.type === 'pen' && m.pts?.length > 1) {
      ctx.strokeStyle = m.color;
      ctx.lineWidth = m.width || 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      m.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
      ctx.stroke();
    } else if (m.type === 'text' && m.text) {
      const size = Math.max(9, (m.size || 0.026) * w);
      ctx.font = `600 ${size}px "Anek Bangla", "Noto Sans Bengali", system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      const pad = size * 0.22;
      const tw = ctx.measureText(m.text).width;
      ctx.globalAlpha = 0.78;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(m.x * w - pad, m.y * h - size * 0.7, tw + pad * 2, size * 1.4);
      ctx.globalAlpha = 1;
      ctx.fillStyle = m.color;
      ctx.fillText(m.text, m.x * w, m.y * h);
    } else if (m.type === 'note') {
      // Notes are pins on screen; on paper they become a numbered dot, with
      // the text collected onto the page margin by the caller.
      const r = Math.max(7, w * 0.011);
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(m.x * w, m.y * h, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#12140a';
      ctx.font = `700 ${r}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(m._n ?? '•'), m.x * w, m.y * h);
    }
    ctx.restore();
  });
}
