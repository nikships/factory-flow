import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { CODE_COLLAPSE_LINES, codeBlockCollapses, codeBlockLabel } from '../src/client/ui/thread-md-code.js';
import { fitDiagramView, clampDiagramView, IMAGE_ZOOM_STEPS, nextImageZoom, zoomDiagramAt } from '../src/client/ui/thread-md-lightbox.js';
import { quoteAsMarkdown, quotePillPosition } from '../src/client/ui/thread-md-quote.js';
import { codePathRef, fenceClosed, trimProvisionalTable } from '../src/client/ui/thread-markdown.js';
import { browserStatus, closeBrowser, launchBrowser, newIsolatedContext } from '../src/server/whiteboard-browser.js';

test('Thread Markdown helper modules load in Node without DOM globals', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(codeBlockLabel('ts'), 'ts');
  assert.equal(codeBlockLabel(' plaintext '), 'code');
  assert.equal(codeBlockLabel(''), 'code');
});

test('codePathRef opens inline-code paths with lines and rejects prose, URLs and unsafe paths', () => {
  assert.deepEqual(codePathRef('src/client/ui/dom.ts:12-14'), { path: 'src/client/ui/dom.ts', line: 12, endLine: 14 });
  assert.deepEqual(codePathRef('src/client/ui/dom.ts:12–14'), { path: 'src/client/ui/dom.ts', line: 12, endLine: 14 });
  assert.deepEqual(codePathRef('/Users/dev/a b.ts:4:2'), { path: '/Users/dev/a b.ts', line: 4 });
  assert.deepEqual(codePathRef('./README.md'), { path: 'README.md' });
  assert.deepEqual(codePathRef('package.json'), { path: 'package.json' });
  for (const text of ['Camera.ts', 'factory.ai', '@scope', 'https://factory.ai/a.ts', '../outside.ts', 'src/../escape.ts', '~/secret/key.pem', 'src/a.ts:0', 'src/a  b.ts', 'src/a\tb.ts', 'before/after']) {
    assert.equal(codePathRef(text), null, text);
  }
});

test('code blocks collapse after ten lines and fenceClosed distinguishes live fences', () => {
  assert.equal(codeBlockCollapses(Array.from({ length: CODE_COLLAPSE_LINES }, (_, i) => `${i}`).join('\n')), false);
  assert.equal(codeBlockCollapses(Array.from({ length: CODE_COLLAPSE_LINES + 1 }, (_, i) => `${i}`).join('\n')), true);
  assert.equal(fenceClosed('```ts\nconst n = 1;\n```'), true);
  assert.equal(fenceClosed('```ts\nconst n = 1;'), false);
  assert.equal(fenceClosed('~~~~\nbody\n~~~~~  '), true);
  assert.equal(fenceClosed('    indented code'), true);
});

test('trimProvisionalTable holds back only an unfinished streaming row', () => {
  const complete = '| A | B |\n| --- | --- |\n| 1 | 2 |';
  assert.equal(trimProvisionalTable(complete), complete);
  assert.equal(trimProvisionalTable(`${complete}\n`), `${complete}\n`);
  assert.equal(trimProvisionalTable(`${complete}\n| 3 |`), complete);
  assert.equal(trimProvisionalTable('Before\n\n| A | B |\n| --- | --- |\n| 1 |'), 'Before\n\n| A | B |\n| --- | --- |');
  assert.equal(trimProvisionalTable('not a table'), 'not a table');
});

test('image zoom steps and diagram fit, pan clamping and anchored zoom match the viewers', () => {
  assert.deepEqual([...IMAGE_ZOOM_STEPS], [1, 1.5, 2, 3, 4]);
  assert.equal(nextImageZoom(1, 1), 1.5);
  assert.equal(nextImageZoom(1.6, -1), 1.5);
  assert.equal(nextImageZoom(4, 1), 4);
  assert.equal(nextImageZoom(1, -1), 1);
  assert.deepEqual(fitDiagramView({ width: 200, height: 100 }, { width: 1000, height: 500 }), { scale: 1.5, x: 350, y: 175 });
  assert.deepEqual(fitDiagramView({ width: 2000, height: 1000 }, { width: 1000, height: 500 }), { scale: 0.42, x: 80, y: 40 });
  const zoomed = zoomDiagramAt({ scale: 1, x: 20, y: 30 }, 2, { x: 220, y: 230 });
  assert.equal((220 - zoomed.x) / zoomed.scale, 200);
  assert.equal((230 - zoomed.y) / zoomed.scale, 200);
  assert.deepEqual(clampDiagramView({ scale: 1, x: -9999, y: 9999 }, { width: 200, height: 100 }, { width: 800, height: 600 }), { scale: 1, x: -136, y: 536 });
});

test('quote reply produces Markdown and positions its pill above or below the selection', () => {
  assert.equal(quoteAsMarkdown('\n First line  \n\nSecond\u00a0line\n'), '>  First line\n>\n> Second line\n\n');
  assert.equal(quoteAsMarkdown(' \n '), '');
  assert.deepEqual(quotePillPosition({ top: 100, bottom: 120, left: 100, width: 200 }, 60, { width: 800, height: 600 }), { top: 92, left: 200, above: true });
  assert.deepEqual(quotePillPosition({ top: 10, bottom: 30, left: 0, width: 20 }, 60, { width: 800, height: 600 }), { top: 38, left: 68, above: false });
});

const status = browserStatus();
const skipChromium = status.installed ? false : `Chromium is not installed in ${status.path}`;

test('real Chromium exercises Factory Thread Markdown blocks, streaming, lightboxes and quote reply', { skip: skipChromium }, async (t: TestContext) => {
  const browser = await launchBrowser();
  t.after(closeBrowser);
  const context = await newIsolatedContext(browser);
  t.after(() => context.close());
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  const bundle = buildSync({
    stdin: {
      contents: `
        export { threadMarkdown, tableToMarkdown } from './src/client/ui/thread-markdown.ts';
        export { attachQuoteReply } from './src/client/ui/thread-md-quote.ts';
        export { closeTopModal } from './src/client/ui/dom.ts';
      `,
      resolveDir: fileURLToPath(new URL('../', import.meta.url)),
      sourcefile: 'thread-md-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    globalName: 'ThreadMD',
    write: false,
    target: 'es2022',
  }).outputFiles[0].text;
  await page.setContent('<!doctype html><div id="root"></div><div id="modal-root"></div><div id="toasts" data-single></div>');
  await page.addStyleTag({ content: readFileSync(new URL('../src/client/style.css', import.meta.url), 'utf8') });
  await page.addScriptTag({ content: bundle });
  await page.addScriptTag({ content: 'window.__name = (fn) => fn;' });

  const result = await page.evaluate(async () => {
    const w = window as any;
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied = text;
        },
      },
    });
    const tableSource = '| Name | Value |\n| --- | --- |\n| Alpha | Beta |';
    const longCode = Array.from({ length: 11 }, (_, i) => `const line${i + 1} = ${i + 1};`).join('\n');
    const source = ['> [!WARNING] Custom caution\n> Read this carefully.', '', tableSource, '', '```suggestion\nconst improved = true;\n```', '', '```math\nx^2 + y^2 = z^2\n```', '', `\`\`\`ts\n${longCode}\n\`\`\``].join('\n');
    const el = w.ThreadMD.threadMarkdown(source) as HTMLElement;
    document.getElementById('root')!.append(el);

    const codes = [...el.querySelectorAll('.wt-md-code')];
    const code = codes[codes.length - 1]!;
    const initiallyCollapsed = code.querySelector('.wt-md-code-body')!.classList.contains('collapsed');
    code.querySelector<HTMLButtonElement>('.wt-md-code-more')!.click();
    const expanded = code.querySelector('.wt-md-code-body')!.classList.contains('expanded');

    const tableButtons = el.querySelectorAll<HTMLButtonElement>('.wt-md-table-btn');
    tableButtons[1].click();
    await Promise.resolve();
    await Promise.resolve();
    const copiedTable = copied;
    const generatedTable = w.ThreadMD.tableToMarkdown(el.querySelector('table'));
    tableButtons[0].click();
    const tableModalOpen = Boolean(document.querySelector('.wt-md-table-modal table'));
    w.ThreadMD.closeTopModal();

    const emailSource = '```email\nTo: dev@example.com\nSubject: Ship it\n\nReady now.\n```';
    const email = w.ThreadMD.threadMarkdown(emailSource) as HTMLElement;
    document.getElementById('root')!.append(email);
    const emailLang = email.querySelector('.wt-md-code-lang')?.textContent ?? '';
    const hasEmailForm = Boolean(email.querySelector('.wt-md-email, input, textarea'));
    const pendingDiagram = w.ThreadMD.threadMarkdown('```mermaid\nflowchart LR\n A --> B', { streaming: true }) as HTMLElement;
    const diagramPending = Boolean(pendingDiagram.querySelector('.wt-mermaid-pending'));

    w.ThreadMD.threadMarkdown('First block', { key: 'message-1', streaming: true });
    const stream = w.ThreadMD.threadMarkdown('First block\n\nSecond block', { key: 'message-1', streaming: true }) as HTMLElement;
    const entering = [...stream.children].map((child) => child.hasAttribute('data-entering'));

    const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const pictures = w.ThreadMD.threadMarkdown(`![one](${pixel})\n\n![two](${pixel})`) as HTMLElement;
    document.getElementById('root')!.append(pictures);
    const firstImage = pictures.querySelector<HTMLImageElement>('img.wt-md-img')!;
    firstImage.click();
    const lightboxCount = document.querySelector('.wt-lightbox-count')!.textContent;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    document.querySelector<HTMLButtonElement>('button[aria-label="Next image"]')!.click();
    const nextAlt = document.querySelector<HTMLImageElement>('.wt-lightbox-img')!.alt;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    document.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')!.click();
    const zoomLabel = document.querySelector('.wt-lightbox-pct')!.textContent;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const stage = document.querySelector<HTMLElement>('.wt-lightbox-stage')!;
    const image = stage.querySelector<HTMLImageElement>('img')!;
    image.style.width = '3000px';
    image.style.height = '3000px';
    stage.scrollLeft = 500;
    stage.scrollTop = 500;
    const scrolled = stage.scrollLeft > 0 || stage.scrollTop > 0;
    document.querySelector<HTMLButtonElement>('button[aria-label="Previous image"]')!.click();
    const resetScroll = [stage.scrollLeft, stage.scrollTop];
    w.ThreadMD.closeTopModal();

    const quoteRoot = w.ThreadMD.threadMarkdown('Quote this reply', { key: 'quote-message' }) as HTMLElement;
    document.getElementById('root')!.append(quoteRoot);
    let quoted = '';
    const detach = w.ThreadMD.attachQuoteReply(document.body, (quote: string) => {
      quoted = quote;
    });
    const text = quoteRoot.querySelector('p')!.firstChild!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(text);
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
    const pillVisible = Boolean(document.querySelector('.wt-quote-pill'));
    document.querySelector<HTMLButtonElement>('.wt-quote-btn')!.click();
    detach();

    const styles = getComputedStyle(el);
    return {
      initiallyCollapsed,
      expanded,
      copiedTable,
      generatedTable,
      tableModalOpen,
      alertClass: el.querySelector('blockquote')!.className,
      alertTitle: el.querySelector('.wt-md-alert-title')!.textContent,
      alertColor: getComputedStyle(el.querySelector('.wt-md-alert-title')!).color,
      suggestionLang: codes[0]!.querySelector('.wt-md-code-lang')!.textContent,
      suggestionCardCount: el.querySelectorAll('.wt-md-suggest').length,
      mathBlocks: el.querySelectorAll('.wt-math-block math').length,
      emailLang,
      hasEmailForm,
      diagramPending,
      entering,
      lightboxCount,
      nextAlt,
      zoomLabel,
      scrolled,
      resetScroll,
      pillVisible,
      quoted,
      fontSize: styles.fontSize,
      codeWhitespace: getComputedStyle(code.querySelector('pre')!).whiteSpace,
      tableCollapse: getComputedStyle(el.querySelector('table')!).borderCollapse,
    };
  });

  assert.deepEqual(pageErrors, []);
  assert.equal(result.initiallyCollapsed, true);
  assert.equal(result.expanded, true);
  assert.equal(result.copiedTable, '| Name | Value |\n| --- | --- |\n| Alpha | Beta |');
  assert.equal(result.generatedTable, '| Name | Value |\n| --- | --- |\n| Alpha | Beta |');
  assert.equal(result.tableModalOpen, true);
  assert.match(result.alertClass, /wt-md-alert-warning/);
  assert.equal(result.alertTitle, 'Custom caution');
  assert.equal(result.alertColor, 'rgb(247, 168, 40)');
  assert.equal(result.suggestionLang, 'suggestion');
  assert.equal(result.suggestionCardCount, 0);
  assert.equal(result.mathBlocks, 1);
  assert.equal(result.emailLang, 'email');
  assert.equal(result.hasEmailForm, false);
  assert.equal(result.diagramPending, true);
  assert.deepEqual(result.entering, [false, true]);
  assert.equal(result.lightboxCount, '1 / 2');
  assert.equal(result.nextAlt, 'two');
  assert.equal(result.zoomLabel, '150%');
  assert.equal(result.scrolled, true);
  assert.deepEqual(result.resetScroll, [0, 0]);
  assert.equal(result.pillVisible, true);
  assert.equal(result.quoted, '> Quote this reply\n\n');
  assert.equal(result.fontSize, '13px');
  assert.equal(result.codeWhitespace, 'pre-wrap');
  assert.equal(result.tableCollapse, 'separate');
});
