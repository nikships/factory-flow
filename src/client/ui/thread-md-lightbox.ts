import { h, type Modal, openModal } from './dom';
import { mdIcon } from './thread-md-icons';

// Factory's full-screen viewers for Thread Markdown: the image lightbox (stepped zoom, next and
// previous, download) and the Mermaid diagram viewer (drag to pan, pinch or Ctrl+wheel to zoom).
// Both open through openModal so Esc and the window stack stay one system.

export interface LightboxImage {
  src: string;
  alt?: string;
  description?: string;
  filename?: string;
}

/** Factory's image zoom stops. */
export const IMAGE_ZOOM_STEPS = [1, 1.5, 2, 3, 4] as const;

/** The next zoom stop above (`dir` 1) or below (`dir` -1) `scale`, holding at the ends. */
export function nextImageZoom(scale: number, dir: 1 | -1): number {
  const steps = IMAGE_ZOOM_STEPS;
  if (dir === 1) return steps.find((s) => s > scale) ?? steps[steps.length - 1];
  return [...steps].reverse().find((s) => s < scale) ?? steps[0];
}

function iconButton(name: Parameters<typeof mdIcon>[0], label: string, onclick: () => void, size = 16): HTMLButtonElement {
  const btn = h('button.wt-lightbox-btn', { type: 'button', 'aria-label': label, title: label }, mdIcon(name, size));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onclick();
  });
  return btn;
}

function downloadName(src: string, fallback: string): string {
  try {
    const url = new URL(src, location.href);
    const fromQuery = url.searchParams.get('path');
    const base = (fromQuery ?? url.pathname).split('/').pop() ?? '';
    return base && /\.[a-z0-9]{2,5}$/i.test(base) ? base : fallback;
  } catch {
    return fallback;
  }
}

function saveUrl(href: string, name: string): void {
  const a = h('a', { href, download: name, rel: 'noopener' });
  document.body.append(a);
  a.click();
  a.remove();
}

/** Opens Factory's image lightbox on `images[index]`; arrows step through the rest. */
export function openImageLightbox(images: readonly LightboxImage[], index = 0): Modal {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  let at = Math.min(Math.max(index, 0), Math.max(images.length - 1, 0));
  let scale = 1;
  let fitWidth = 0;

  const img = h('img.wt-lightbox-img', { alt: images[at]?.alt ?? '', draggable: 'false' });
  const stage = h('div.wt-lightbox-stage', {}, img);
  const pct = h('button.wt-lightbox-btn.wt-lightbox-pct', { type: 'button', 'aria-label': 'Reset zoom', title: 'Reset zoom' }, '100%');
  const counter = h('span.wt-lightbox-count', { role: 'status' });
  const prev = iconButton('chevronLeft', 'Previous image', () => go(-1));
  const next = iconButton('chevronRight', 'Next image', () => go(1));
  const zoomOut = iconButton('minus', 'Zoom out', () => zoomTo(nextImageZoom(scale, -1)));
  const zoomIn = iconButton('plus', 'Zoom in', () => zoomTo(nextImageZoom(scale, 1)));
  pct.addEventListener('click', (e) => {
    e.stopPropagation();
    zoomTo(1);
  });
  const many = images.length > 1;
  const bar = h(
    'div.wt-lightbox-bar',
    { role: 'toolbar', 'aria-label': 'Image actions' },
    many ? h('div.wt-lightbox-group', {}, prev, counter, next) : null,
    many ? h('span.wt-lightbox-sep', { 'aria-hidden': 'true' }) : null,
    h('div.wt-lightbox-group', {}, zoomOut, pct, zoomIn),
    h('span.wt-lightbox-sep', { 'aria-hidden': 'true' }),
    iconButton('download', 'Download image', () => {
      const src = images[at]?.src;
      if (src) saveUrl(src, images[at].filename ?? downloadName(src, 'image.png'));
    }),
    h('span.wt-lightbox-sep', { 'aria-hidden': 'true' }),
    iconButton('x', 'Close preview', () => modal.close()),
  );
  const content = h(
    'div.wt-lightbox.wt-image-lightbox',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Image preview', 'aria-describedby': 'wt-lightbox-hint', tabindex: -1 },
    h('p.wt-lightbox-hint', { id: 'wt-lightbox-hint' }, 'Press Escape or click outside the image to close.'),
    stage,
    bar,
  );

  const paint = () => {
    const zoomed = scale > 1;
    stage.classList.toggle('zoomed', zoomed);
    img.classList.toggle('zoomed', zoomed);
    if (zoomed && fitWidth > 0) img.style.width = `${fitWidth * scale}px`;
    else img.style.removeProperty('width');
    pct.textContent = `${Math.round(scale * 100)}%`;
    zoomIn.disabled = scale >= IMAGE_ZOOM_STEPS[IMAGE_ZOOM_STEPS.length - 1];
    zoomOut.disabled = scale <= IMAGE_ZOOM_STEPS[0];
    counter.textContent = `${at + 1} / ${images.length}`;
    counter.setAttribute('aria-label', `Image ${at + 1} of ${images.length}`);
    prev.disabled = at <= 0;
    next.disabled = at >= images.length - 1;
  };

  const zoomTo = (target: number, anchor?: { x: number; y: number }) => {
    if (target === scale) return;
    if (scale === 1) fitWidth = img.getBoundingClientRect().width;
    if (fitWidth <= 0) return;
    const fx = anchor?.x ?? (stage.scrollLeft + stage.clientWidth / 2 - img.offsetLeft) / Math.max(img.offsetWidth, 1);
    const fy = anchor?.y ?? (stage.scrollTop + stage.clientHeight / 2 - img.offsetTop) / Math.max(img.offsetHeight, 1);
    scale = target;
    paint();
    requestAnimationFrame(() => {
      stage.scrollLeft = img.offsetLeft + fx * img.offsetWidth - stage.clientWidth / 2;
      stage.scrollTop = img.offsetTop + fy * img.offsetHeight - stage.clientHeight / 2;
    });
  };

  const show = (i: number) => {
    at = i;
    scale = 1;
    fitWidth = 0;
    img.src = images[at]?.src ?? '';
    img.alt = images[at]?.alt ?? '';
    img.title = images[at]?.description ?? '';
    content.setAttribute('aria-label', images[at]?.alt || 'Image preview');
    content.setAttribute('aria-description', images[at]?.description ?? '');
    paint();
    stage.scrollLeft = 0;
    stage.scrollTop = 0;
  };
  const go = (d: number) => {
    const i = at + d;
    if (i >= 0 && i < images.length && i !== at) show(i);
  };

  img.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = img.getBoundingClientRect();
    const anchor = r.width > 0 && r.height > 0 ? { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height } : undefined;
    zoomTo(scale > 1 ? 1 : 2, anchor);
  });
  // Anything that is not the picture or the toolbar is "outside the image".
  content.addEventListener('click', (e) => {
    if (e.target instanceof Node && (img.contains(e.target) || bar.contains(e.target))) return;
    modal.close();
  });
  content.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const act: Record<string, () => void> = {
      '+': () => zoomTo(nextImageZoom(scale, 1)),
      '=': () => zoomTo(nextImageZoom(scale, 1)),
      '-': () => zoomTo(nextImageZoom(scale, -1)),
      '0': () => zoomTo(1),
      ArrowLeft: () => go(-1),
      ArrowRight: () => go(1),
    };
    const fn = act[e.key];
    if (!fn || (!many && e.key.startsWith('Arrow'))) return;
    e.preventDefault();
    e.stopPropagation();
    fn();
  });

  const modal = openModal(content, { closeButton: false, backdropCloses: true, onClose: () => opener?.focus() });
  modal.backdrop.classList.add('wt-lightbox-backdrop');
  show(at);
  content.focus();
  return modal;
}

// ------------------------------------------------------------------------------------------------
// Diagram viewer

export interface DiagramView {
  scale: number;
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

const FIT_MARGIN = 0.08;
const FIT_MAX = 1.5;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.1;
const WHEEL_ZOOM = 0.005;
const LINE_PX = 16;
const KEY_PAN = 48;
const KEEP_VISIBLE = 64;

/** The view that centers `content` in `viewport` with an 8% margin, at most 150%. */
export function fitDiagramView(content: Size, viewport: Size): DiagramView {
  const scale = Math.min((viewport.width * (1 - FIT_MARGIN * 2)) / content.width, (viewport.height * (1 - FIT_MARGIN * 2)) / content.height, FIT_MAX);
  return { scale, x: (viewport.width - content.width * scale) / 2, y: (viewport.height - content.height * scale) / 2 };
}

/** `view` panned back so at least 64px of the diagram stays inside the viewport. */
export function clampDiagramView(view: DiagramView, content: Size, viewport: Size): DiagramView {
  const w = content.width * view.scale;
  const hgt = content.height * view.scale;
  const kx = Math.min(KEEP_VISIBLE, w);
  const ky = Math.min(KEEP_VISIBLE, hgt);
  return { scale: view.scale, x: Math.min(Math.max(view.x, kx - w), viewport.width - kx), y: Math.min(Math.max(view.y, ky - hgt), viewport.height - ky) };
}

/** `view` rescaled to `scale` keeping the diagram point under `at` (viewport coordinates) still. */
export function zoomDiagramAt(view: DiagramView, scale: number, at: { x: number; y: number }): DiagramView {
  const dx = (at.x - view.x) / view.scale;
  const dy = (at.y - view.y) / view.scale;
  return { scale, x: at.x - dx * scale, y: at.y - dy * scale };
}

function svgSize(svg: SVGSVGElement): Size {
  const vb =
    svg
      .getAttribute('viewBox')
      ?.split(/[\s,]+/)
      .map(Number) ?? [];
  const width = vb[2] > 0 ? vb[2] : Number(svg.getAttribute('width')) || 800;
  const height = vb[3] > 0 ? vb[3] : Number(svg.getAttribute('height')) || 600;
  return { width, height };
}

/** Opens Factory's Mermaid diagram viewer on a copy of `svg`. */
export function openDiagramLightbox(svg: SVGSVGElement): Modal {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const size = svgSize(copy);
  copy.setAttribute('width', String(size.width));
  copy.setAttribute('height', String(size.height));
  copy.style.removeProperty('max-width');

  const canvas = h('div.wt-diagram-canvas', { role: 'img', 'aria-label': 'Rendered Mermaid diagram' }, copy);
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
  const viewport = h('div.wt-diagram-viewport', {}, canvas);
  const level = h('span.wt-diagram-level', { 'aria-live': 'polite' }, '100%');
  const controls = h(
    'div.wt-diagram-controls',
    {},
    iconButton('minus', 'Zoom out', () => zoomBy(-ZOOM_STEP)),
    level,
    iconButton('plus', 'Zoom in', () => zoomBy(ZOOM_STEP)),
    h('span.wt-lightbox-sep', { 'aria-hidden': 'true' }),
    iconButton('reset', 'Reset diagram view', () => reset()),
  );
  const close = iconButton('x', 'Close diagram', () => modal.close());
  const panel = h('div.wt-diagram-panel', {}, h('div.wt-diagram-close', {}, close), viewport, controls);
  const content = h('div.wt-lightbox.wt-diagram-lightbox', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Mermaid diagram viewer', tabindex: -1 }, panel);

  const vp = (): Size => {
    const r = viewport.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { width: r.width, height: r.height } : { width: innerWidth, height: innerHeight };
  };
  let view: DiagramView = { scale: 1, x: 0, y: 0 };
  const apply = (next: DiagramView) => {
    view = clampDiagramView(next, size, vp());
    canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    level.textContent = `${Math.round(view.scale * 100)}%`;
  };
  const clampScale = (s: number) => Math.min(Math.max(s, Math.min(ZOOM_MIN, fitDiagramView(size, vp()).scale, view.scale)), ZOOM_MAX);
  const center = () => {
    const v = vp();
    return { x: v.width / 2, y: v.height / 2 };
  };
  const zoomBy = (d: number) => apply(zoomDiagramAt(view, clampScale(view.scale + d), center()));
  const reset = () => apply(fitDiagramView(size, vp()));
  const local = (e: { clientX: number; clientY: number }) => {
    const r = viewport.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const pointers = new Map<number, { x: number; y: number }>();
  let drag: { px: number; py: number; view: DiagramView } | undefined;
  let pinch: { dist: number; view: DiagramView; at: { x: number; y: number } } | undefined;
  const pinchState = () => {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }) };
  };
  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    viewport.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const p = pinchState();
      pinch = { dist: p.dist, view, at: p.mid };
      drag = undefined;
      viewport.classList.remove('dragging');
    } else {
      drag = { px: e.clientX, py: e.clientY, view };
      viewport.classList.add('dragging');
    }
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const p = pinchState();
      apply(zoomDiagramAt(pinch.view, clampScale(pinch.view.scale * (p.dist / Math.max(pinch.dist, 1))), pinch.at));
    } else if (drag) apply({ scale: view.scale, x: drag.view.x + (e.clientX - drag.px), y: drag.view.y + (e.clientY - drag.py) });
  });
  const release = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = undefined;
    if (pointers.size === 0) {
      drag = undefined;
      viewport.classList.remove('dragging');
    }
  };
  viewport.addEventListener('pointerup', release);
  viewport.addEventListener('pointercancel', release);
  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const mult = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? vp().height : 1;
      if (e.ctrlKey) apply(zoomDiagramAt(view, clampScale(view.scale * 2 ** (-e.deltaY * mult * WHEEL_ZOOM)), local(e)));
      else apply({ scale: view.scale, x: view.x - e.deltaX * mult, y: view.y - e.deltaY * mult });
    },
    { passive: false },
  );
  content.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const pan = (dx: number, dy: number) => apply({ scale: view.scale, x: view.x + dx, y: view.y + dy });
    const act: Record<string, () => void> = {
      '+': () => zoomBy(ZOOM_STEP),
      '=': () => zoomBy(ZOOM_STEP),
      '-': () => zoomBy(-ZOOM_STEP),
      '0': reset,
      ArrowLeft: () => pan(KEY_PAN, 0),
      ArrowRight: () => pan(-KEY_PAN, 0),
      ArrowUp: () => pan(0, KEY_PAN),
      ArrowDown: () => pan(0, -KEY_PAN),
    };
    const fn = act[e.key];
    if (!fn) return;
    e.preventDefault();
    e.stopPropagation();
    fn();
  });
  content.addEventListener('mousedown', (e) => {
    if (!panel.contains(e.target as Node)) modal.close();
  });

  const modal = openModal(content, { closeButton: false });
  modal.backdrop.classList.add('wt-lightbox-backdrop', 'wt-diagram-backdrop');
  reset();
  content.focus();
  return modal;
}
