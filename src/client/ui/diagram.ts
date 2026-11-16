import { claimEscape, h } from './dom';
import { renderMdCodeBlock } from './thread-md-code';
import { mdIcon } from './thread-md-icons';
import { openDiagramLightbox } from './thread-md-lightbox';

// Mermaid diagrams in wiki pages and Thread messages, drawn as strict-mode SVG. The library is
// large, so it loads the first time a diagram renders, and sanitized SVG markup caches in an LRU
// map so Thread re-paints reuse the rendered diagram synchronously without flashing.

type Mermaid = typeof import('mermaid').default;

const MAX_SVG_CACHE = 64;

let loaded: Promise<Mermaid> | undefined;
let counter = 0;
const svgCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function mermaid(): Promise<Mermaid> {
  loaded ??= import('mermaid').then((m) => {
    m.default.initialize({
      startOnLoad: false,
      // Pages and messages come from model output or repositories: 'strict' keeps scripts and click handlers out of the SVG.
      securityLevel: 'strict',
      // Factory's diagram palette (core-v2 dark): surface fill, hairline borders, orange accent.
      theme: 'base',
      themeVariables: {
        darkMode: true,
        background: '#0c0b0a',
        primaryColor: '#100e0d',
        primaryTextColor: '#fdfcfb',
        primaryBorderColor: '#564e4a',
        secondaryColor: '#151311',
        tertiaryColor: '#151311',
        lineColor: '#80756f',
        textColor: '#fdfcfb',
        mainBkg: '#100e0d',
        nodeBorder: '#564e4a',
        clusterBkg: '#151311',
        clusterBorder: '#38322f',
        edgeLabelBackground: '#0c0b0a',
        noteBkgColor: '#210b00',
        noteBorderColor: '#b34000',
        noteTextColor: '#fdfcfb',
        actorBkg: '#100e0d',
        actorBorder: '#564e4a',
        actorTextColor: '#fdfcfb',
        signalColor: '#ff5a00',
        signalTextColor: '#fdfcfb',
        fontSize: '13px',
      },
      fontFamily: 'inherit',
      // Labels as SVG text, so no foreignObject (HTML inside the SVG) is needed.
      htmlLabels: false,
      flowchart: { htmlLabels: false },
    });
    return m.default;
  });
  return loaded;
}

function readLru(key: string): string | undefined {
  const hit = svgCache.get(key);
  if (hit === undefined) return undefined;
  // Refresh LRU order.
  svgCache.delete(key);
  svgCache.set(key, hit);
  return hit;
}

function writeLru(key: string, svgMarkup: string): void {
  if (svgCache.has(key)) svgCache.delete(key);
  else if (svgCache.size >= MAX_SVG_CACHE) {
    const oldest = svgCache.keys().next().value;
    if (oldest !== undefined) svgCache.delete(oldest);
  }
  svgCache.set(key, svgMarkup);
}

function parseSanitizedSvg(svg: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
    throw new Error('The diagram did not draw');
  }
  for (const bad of root.querySelectorAll('script, foreignObject, iframe, object, embed')) bad.remove();
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) {
      if (attr.name.toLowerCase().startsWith('on')) el.removeAttribute(attr.name);
    }
  }
  root.removeAttribute('height');
  const natural = Number(root.getAttribute('viewBox')?.split(/\s+/)[2]);
  root.setAttribute('width', natural > 0 ? `${Math.ceil(natural)}` : '100%');
  root.classList.add('wt-diagram-svg');
  return document.importNode(root, true) as unknown as SVGSVGElement;
}

function peekCachedMermaidSvg(source: string): SVGSVGElement | null {
  const key = source.trim();
  if (!key) return null;
  const cached = readLru(key);
  if (!cached) return null;
  try {
    return parseSanitizedSvg(cached);
  } catch {
    svgCache.delete(key);
    return null;
  }
}

async function renderSanitizedMarkup(source: string): Promise<string> {
  const key = source.trim();
  if (!key) throw new Error('Empty diagram');
  const cached = readLru(key);
  if (cached) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;

  const id = `wk-mermaid-${++counter}`;
  const job = (async () => {
    try {
      const m = await mermaid();
      const { svg } = await m.render(id, key);
      const cleanEl = parseSanitizedSvg(svg);
      const serialized = new XMLSerializer().serializeToString(cleanEl);
      writeLru(key, serialized);
      return serialized;
    } finally {
      inflight.delete(key);
      // A failed render leaves mermaid's error element (its id, or with a "d" in front) in the document; take it away.
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }
  })();

  inflight.set(key, job);
  return job;
}

/** Renders `source` to a sanitized strict-mode `<svg>` element, reusing a 64-entry LRU cache on repeat renders. */
export async function renderMermaidSvg(source: string): Promise<SVGSVGElement> {
  const markup = await renderSanitizedMarkup(source);
  return parseSanitizedSvg(markup);
}

/** Replaces a ```mermaid code block on a wiki page with its drawing. A diagram that won't parse stays as its source, with the reason. */
export async function drawDiagram(pre: HTMLElement, source: string): Promise<void> {
  const box = h('div.wk-diagram-box', { role: 'img', 'aria-label': 'Diagram' }, h('span.spinner'));
  pre.replaceWith(box);
  try {
    const svg = await renderMermaidSvg(source);
    svg.style.maxWidth = '100%';
    box.replaceChildren(svg);
  } catch (e) {
    box.className = 'wk-diagram-box failed';
    box.replaceChildren(h('div.wk-diagram', {}, `mermaid diagram, couldn’t draw it: ${e instanceof Error ? e.message.split('\n')[0] : 'unknown error'}`), h('pre', {}, h('code', {}, source)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** `svg` as a standalone file with the Thread's surface color painted behind it. */
function standaloneSvg(svg: SVGSVGElement, background = '#0c0b0a'): string {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('xmlns', SVG_NS);
  const vb = copy
    .getAttribute('viewBox')
    ?.split(/[\s,]+/)
    .map(Number);
  const bg = document.createElementNS(SVG_NS, 'rect');
  if (vb && vb.length === 4 && vb.every(Number.isFinite)) {
    bg.setAttribute('x', String(vb[0]));
    bg.setAttribute('y', String(vb[1]));
    bg.setAttribute('width', String(vb[2]));
    bg.setAttribute('height', String(vb[3]));
  } else {
    bg.setAttribute('width', '100%');
    bg.setAttribute('height', '100%');
  }
  bg.setAttribute('fill', background);
  copy.insertBefore(bg, copy.firstChild);
  return new XMLSerializer().serializeToString(copy);
}

function diagramPending(): HTMLElement {
  return h('div.wt-mermaid-pending', { role: 'status', 'aria-label': 'Rendering diagram' }, h('span.spinner'));
}

function diagramActions(source: string, svg: SVGSVGElement): HTMLElement {
  const trigger = h('button.wt-mermaid-more', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Mermaid diagram actions', title: 'Mermaid diagram actions' }, mdIcon('more', 16));
  const copyItem = h('button.wt-mermaid-item', { type: 'button', role: 'menuitem' });
  const saveItem = h('button.wt-mermaid-item', { type: 'button', role: 'menuitem' }, mdIcon('download', 14), h('span', {}, 'Download as SVG'));
  const menu = h('div.wt-mermaid-menu', { role: 'menu', hidden: true }, copyItem, saveItem);
  const wrap = h('div.wt-mermaid-actions', {}, trigger, menu);

  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  const paintCopy = (copied: boolean) => {
    copyItem.replaceChildren(mdIcon(copied ? 'check' : 'copy', 14), h('span', {}, copied ? 'Mermaid code copied' : 'Copy Mermaid code'));
    trigger.replaceChildren(mdIcon(copied ? 'check' : 'more', 16));
    trigger.classList.toggle('copied', copied);
    trigger.setAttribute('aria-label', copied ? 'Mermaid code copied' : 'Mermaid diagram actions');
  };
  paintCopy(false);

  let releaseEsc: (() => void) | undefined;
  const onOutside = (e: MouseEvent) => {
    if (!wrap.contains(e.target as Node)) setOpen(false);
  };
  const setOpen = (open: boolean) => {
    menu.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    wrap.classList.toggle('open', open);
    if (open) {
      document.addEventListener('mousedown', onOutside, true);
      releaseEsc = claimEscape(wrap, () => {
        if (menu.hidden) return false;
        setOpen(false);
        trigger.focus();
        return true;
      });
    } else {
      document.removeEventListener('mousedown', onOutside, true);
      releaseEsc?.();
      releaseEsc = undefined;
    }
  };
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!wrap.classList.contains('open'));
  });
  copyItem.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(false);
    void navigator.clipboard
      ?.writeText(source)
      .then(() => {
        paintCopy(true);
        if (copiedTimer !== undefined) clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => paintCopy(false), 2000);
      })
      .catch(() => {});
  });
  saveItem.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(false);
    const url = URL.createObjectURL(new Blob([standaloneSvg(svg)], { type: 'image/svg+xml' }));
    const a = h('a', { href: url, download: 'diagram.svg' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return wrap;
}

function diagramCard(source: string, svg: SVGSVGElement): HTMLElement {
  const stage = h('div.wt-mermaid-stage', { role: 'img', 'aria-label': 'Rendered Mermaid diagram preview' }, svg);
  const card = h('div.wt-mermaid', { 'data-testid': 'mermaid-diagram', tabindex: 0, title: 'Expand diagram' }, diagramActions(source, svg), stage);
  const open = () => openDiagramLightbox(svg);
  stage.addEventListener('click', open);
  card.addEventListener('keydown', (e) => {
    if (e.target === card && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      open();
    }
  });
  return card;
}

/**
 * A Thread Markdown Mermaid diagram as Factory draws it: a spinner while the fence is still
 * streaming (`complete` false), then a clickable card that opens the pan and zoom viewer, with a
 * Copy Mermaid code / Download as SVG menu. Source that will not draw falls back to a code block.
 */
export function renderThreadMermaid(source: string, opts: { complete?: boolean } = {}): HTMLElement {
  const host = h('div.wt-mermaid-host');
  if (opts.complete === false || !source.trim()) {
    host.append(diagramPending());
    return host;
  }
  const cached = peekCachedMermaidSvg(source);
  if (cached) {
    host.append(diagramCard(source, cached));
    return host;
  }
  host.append(diagramPending());
  void renderMermaidSvg(source)
    .then((svg) => host.replaceChildren(diagramCard(source, svg)))
    .catch(() => host.replaceChildren(renderMdCodeBlock(source, 'mermaid')));
  return host;
}
