import { isDocPath, isEditablePath, resolveDocLink, type DocFile, type DocList, type DocSaveResult, type DocSearchHit, type DocSearchResults, type DocText } from '../../shared/docs';
import { withToken } from '../token';
import { claimEscape, clip, h, openModal, timeAgo, toast } from './dom';
import type { CodeEditor, CodeEditorCursor } from './editor';
import { fileIcon, glyph, iconSvg, type ToolGlyph } from './file-icons';
import { createFileTree, GIT_LABEL, marked, shelfOrder } from './file-tree';
import { emptyState, windowHeader } from './kit';
import { markdownFile } from './markdown';

// The Factory window's Files tab: project docs, file search and a CodeMirror editor with
// Markdown preview and conflict-aware saves. The host owns the modal and close confirmation.

const LAST_KEY = 'factory-flow.bookshelf';
const TREE_KEY = 'factory-flow.bookshelf.tree';

export interface ShelfDeps {
  /** The floor whose project it is, and the project's name. */
  floor: string;
  project?: string;
  /** Where the project's files are on its forge (…/blob/HEAD on GitHub, …/-/blob/HEAD on GitLab) and the forge's name, for links to files on the forge. */
  blob?: { url: string; site: string };
  isActive(): boolean;
  keyboardRoot: HTMLElement;
}

export interface FilesTab {
  beforeClose(proceed: () => void): void;
  dispose(): void;
}
export type DocViewMode = 'preview' | 'edit' | 'split';
type ShelfScope = 'docs' | 'all';
type SidebarLayout = 'files' | 'grep';

const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** Highlights every case-insensitive occurrence of `needle` inside `text`. */
function markSubstring(text: string, needle: string): (string | HTMLElement)[] {
  const q = needle.trim().toLowerCase();
  if (!q) return [text];
  const at = new Set<number>();
  const lower = text.toLowerCase();
  let pos = 0;
  while (pos < lower.length) {
    const idx = lower.indexOf(q, pos);
    if (idx < 0) break;
    for (let k = 0; k < q.length; k++) at.add(idx + k);
    pos = idx + q.length;
  }
  return marked(text, at);
}

/** A heading's anchor, as GitHub makes them: lower case, punctuation dropped, spaces to dashes. */
function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

function size(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

function lastRead(floor: string): string | undefined {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}')[floor];
  } catch {
    return undefined;
  }
}

function rememberRead(floor: string, path: string) {
  try {
    const all = JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}');
    all[floor] = path;
    localStorage.setItem(LAST_KEY, JSON.stringify(all));
  } catch {
    // Private mode, or storage is full: it just won't reopen where you were.
  }
}

const SCOPE_KEY = 'factory-flow.bookshelf.scope';

function lastScope(floor: string): ShelfScope | undefined {
  try {
    const s = JSON.parse(localStorage.getItem(SCOPE_KEY) ?? '{}')[floor];
    return s === 'docs' || s === 'all' ? s : undefined;
  } catch {
    return undefined;
  }
}

function rememberScope(floor: string, scope: ShelfScope) {
  try {
    const all = JSON.parse(localStorage.getItem(SCOPE_KEY) ?? '{}');
    all[floor] = scope;
    localStorage.setItem(SCOPE_KEY, JSON.stringify(all));
  } catch {
    // Storage is off: it opens on Docs next time.
  }
}

/** Gives a rendered page's headings their anchors (GitHub's, numbered when repeated) and fills the contents menu with them. */
export function anchorHeadings(body: HTMLElement, toc: HTMLSelectElement) {
  const seen = new Map<string, number>();
  const heads: { level: number; text: string; anchor: string }[] = [];
  for (const hd of body.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
    const base = slug(hd.textContent ?? '');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const anchor = n ? `${base}-${n}` : base;
    hd.dataset.anchor = anchor;
    const level = Number(hd.tagName[1]);
    if (level <= 3 && hd.textContent?.trim()) heads.push({ level, text: hd.textContent.trim(), anchor });
  }
  toc.replaceChildren(h('option', { value: '' }, '☰ Contents'), ...heads.map((x) => h('option', { value: x.anchor }, `${' '.repeat(x.level - 1)}${clip(x.text, 60)}`)));
  toc.hidden = heads.length < 3;
}

/** Scrolls `page` to the heading (or named anchor) `hash` names, or to the top for none. */
export function jumpTo(page: HTMLElement, hash: string) {
  if (!hash) return page.scrollTo({ top: 0 });
  let id = hash;
  try {
    id = decodeURIComponent(hash);
  } catch {
    // Not encoded after all.
  }
  id = id.replace(/^user-content-/, '');
  const esc = CSS.escape(id);
  const at = page.querySelector(`[data-anchor="${esc}"]`) ?? page.querySelector(`[data-anchor="${CSS.escape(id.toLowerCase())}"]`) ?? page.querySelector(`[id="${esc}"], [name="${esc}"]`);
  at?.scrollIntoView({ block: 'start' });
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(withToken(url), { credentials: 'same-origin' });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

class SaveConflictError extends Error {
  constructor(
    message: string,
    readonly mtime?: number,
  ) {
    super(message);
  }
}

async function putFileJson(url: string, body: { path: string; text: string; baseMtime?: number }): Promise<DocSaveResult> {
  const r = await fetch(withToken(url), {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const payload = (await r.json().catch(() => null)) as { error?: string; mtime?: number } | null;
    const msg = payload?.error ?? `HTTP ${r.status}`;
    if (r.status === 409) throw new SaveConflictError(msg, payload?.mtime);
    throw new Error(msg);
  }
  return r.json() as Promise<DocSaveResult>;
}

function parseLineHash(hash: string): number | undefined {
  const m = /^L(\d+)/i.exec(hash.trim());
  return m ? Number(m[1]) : undefined;
}

export function mountFilesTab(el: HTMLElement, deps: ShelfDeps): FilesTab {
  const { floor, blob } = deps;
  const blobUrl = (path: string, hash = '') => `${blob?.url}/${path.split('/').map(encodeURIComponent).join('/')}${hash ? `#${hash}` : ''}`;
  const q = (params: Record<string, string>) => new URLSearchParams({ floor, ...params }).toString();
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const modKey = isMac ? '⌘' : 'Ctrl+';

  // Start warming the CodeMirror chunk in the background so switching to Edit/Split is instant.
  const editorModulePromise = import('./editor');

  // Sidebar controls: scope (Docs vs All files), the Files tree or a Search inside them, and the tree's tools.
  let scope: ShelfScope = 'docs';
  let layout: SidebarLayout = 'files';
  const scopeDocsBtn = h('button.btn.sm.on', { type: 'button', role: 'radio', 'aria-checked': 'true', 'data-scope': 'docs', title: 'Only Markdown docs' }, 'Docs') as HTMLButtonElement;
  const scopeAllBtn = h('button.btn.sm', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-scope': 'all', title: 'Every text file in the project' }, 'All files') as HTMLButtonElement;
  const scopeGroup = h('div.seg.bs-scope', { role: 'radiogroup', 'aria-label': 'File scope' }, scopeDocsBtn, scopeAllBtn);

  const layoutTab = (l: SidebarLayout, icon: ToolGlyph, label: string, title: string) =>
    h('button.tab.bs-side-tab', { type: 'button', role: 'tab', 'aria-selected': String(l === layout), 'data-layout': l, title }, glyph(icon), label) as HTMLButtonElement;
  const layoutFilesBtn = layoutTab('files', 'files', 'Files', 'The project tree; type to go to a file');
  const layoutGrepBtn = layoutTab('grep', 'search', 'Search', 'Search inside files');
  const toolBtn = (icon: ToolGlyph, title: string) => h('button.bs-tool', { type: 'button', title, 'aria-label': title }, glyph(icon)) as HTMLButtonElement;
  const locateBtn = toolBtn('locate', 'Select the open file in the tree');
  const expandBtn = toolBtn('expand', 'Expand all folders');
  const collapseBtn = toolBtn('collapse', 'Collapse all folders');
  const refreshBtn = toolBtn('refresh', 'Reload the file list from disk');
  const treeTools = h('div.bs-tools', {}, locateBtn, expandBtn, collapseBtn, refreshBtn);
  const layoutBar = h('div.bs-side-tabs', { role: 'tablist', 'aria-label': 'Sidebar view' }, layoutFilesBtn, layoutGrepBtn, h('span.grow'), treeTools);

  const filter = h('input.bs-filter', { type: 'text', placeholder: 'Go to file…', 'aria-label': 'Go to file', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const findBox = h('label.bs-go', {}, glyph('search', 'bs-go-icon'), filter);
  const count = h('div.bs-count', {}, 'Loading project files…');
  const tree = createFileTree({
    storageKey: TREE_KEY,
    onOpen: (path) => requestOpenDoc(path),
    onReveal: (path) => revealInSidebar(path),
    ...(blob ? { forge: { site: blob.site, url: (p: string) => blobUrl(p) } } : {}),
    empty: (query) => (query ? `No ${scope === 'docs' ? 'doc' : 'file'} matches “${query}”.` : scope === 'docs' ? 'No Markdown files in this project yet.' : 'No editable files in this project yet.'),
  });
  const grepList = h('div.bs-grep', { role: 'listbox', 'aria-label': 'Search results', hidden: true });
  const resizer = h('div.bs-resize', { role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize the sidebar', title: 'Drag to resize; double-click to reset' });

  // Reader / Editor bar controls.
  const crumbs = h('div.bs-crumbs');
  const modePreviewBtn = h('button.btn.sm.on', { type: 'button', role: 'radio', 'aria-checked': 'true', 'data-mode': 'preview', title: 'Rendered Markdown preview' }, 'Preview') as HTMLButtonElement;
  const modeEditBtn = h('button.btn.sm', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-mode': 'edit', title: `Edit file (${modKey}E)` }, 'Edit') as HTMLButtonElement;
  const modeSplitBtn = h('button.btn.sm', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-mode': 'split', title: 'Side-by-side editor and live preview' }, 'Split') as HTMLButtonElement;
  const modeGroup = h('div.seg.bs-mode', { role: 'radiogroup', 'aria-label': 'View mode', hidden: true }, modePreviewBtn, modeEditBtn, modeSplitBtn);

  const findBtn = h('button.btn.sm.ghost.bs-find-btn', { type: 'button', title: `Find & replace in file (${modKey}F)`, hidden: true }, 'Find') as HTMLButtonElement;
  const discardBtn = h('button.btn.sm.ghost.bs-discard-btn', { type: 'button', title: 'Revert unsaved changes', hidden: true }, 'Discard') as HTMLButtonElement;
  const saveBtn = h('button.btn.sm.accent.bs-save-btn', { type: 'button', title: `Save to disk (${modKey}S)`, disabled: true, hidden: true }, 'Save ', h('span.key', {}, `${modKey}S`)) as HTMLButtonElement;

  const meta = h('div.bs-meta');
  const toc = h('select.select.sm.bs-toc', { 'aria-label': 'Jump to a heading', title: 'Jump to a heading', hidden: true }) as HTMLSelectElement;

  // Conflict banner (shown when disk mtime changed while editing).
  const conflictReloadBtn = h('button.btn.sm', { type: 'button' }, 'Reload from disk') as HTMLButtonElement;
  const conflictForceBtn = h('button.btn.sm.accent', { type: 'button' }, 'Overwrite disk') as HTMLButtonElement;
  const conflictMsg = h('span.bs-conflict-text', {}, 'This file changed on disk since you opened it.');
  const conflictBar = h('div.note.warn.bs-conflict', { hidden: true }, conflictMsg, h('div.bs-conflict-actions', {}, conflictReloadBtn, conflictForceBtn));

  // Workspace: holds the CodeMirror editor pane and the Markdown preview pane.
  const editorPane = h('div.bs-editor-pane', { hidden: true });
  const page = h('div.bs-page', { tabindex: -1 });
  const work = h('div.bs-work', {}, editorPane, page);

  // Editor status bar at the bottom of the reader pane.
  const statusLang = h('span.pill.bs-lang', {}, 'Markdown');
  const statusInfo = h('span.bs-status-info');
  const statusForge = h('span.bs-status-forge');
  const statusCursor = h('span.bs-status-cursor', {}, 'Ln 1, Col 1');
  const statusBar = h('div.bs-status', { hidden: true }, h('div.bs-status-left', {}, statusLang, statusInfo, statusForge), h('div.bs-status-right', {}, statusCursor));

  const docsBody = h(
    'div.body.flush.split.bs-split',
    { role: 'tabpanel' },
    h('aside.bs-side', {}, h('div.bs-side-bar', {}, scopeGroup), layoutBar, findBox, count, tree.el, grepList, resizer),
    h('article.bs-reader.flush', {}, h('div.bs-bar', {}, crumbs, modeGroup, findBtn, discardBtn, saveBtn, meta, toc), conflictBar, work, statusBar),
  );
  el.classList.add('factory-files');
  el.append(docsBody);
  page.append(h('div.bs-loading', {}, h('span.spinner')));

  let allFiles: DocFile[] = [];
  let files: DocFile[] = [];
  let moreFiles = false;
  /** Which search result ↑ ↓ are on. */
  let grepSel = 0;
  /** The file open now, and each open's number, so a slow one that's been overtaken is dropped. */
  let current: string | null = null;
  let currentMtime: number | undefined;
  let loadedText = '';
  let dirty = false;
  let saving = false;
  let viewMode: DocViewMode = 'preview';
  let preferredMdMode: DocViewMode = 'preview';
  let editor: CodeEditor | null = null;
  let disposed = false;
  let splitPreviewTimer: ReturnType<typeof setTimeout> | null = null;
  let grepTimer: ReturnType<typeof setTimeout> | null = null;
  let grepSeq = 0;
  let grepResults: DocSearchResults | null = null;
  let grepLoading = false;
  let opening = 0;
  const confirmUnsaved = (actionLabel: string, onProceed: () => void) => {
    if (!dirty || !current) return onProceed();
    const fileLabel = nameOf(current);
    const keepBtn = h('button.btn.ghost', { type: 'button' }, 'Keep editing');
    const dropBtn = h('button.btn.danger', { type: 'button' }, 'Discard changes');
    const saveAndGoBtn = h('button.btn.accent', { type: 'button' }, `Save & ${actionLabel}`);
    const dialogEl = h(
      'div.modal.sm',
      { role: 'alertdialog', 'aria-label': `Unsaved changes in ${fileLabel}` },
      windowHeader('Unsaved changes', current),
      h('div.body.stack', {}, h('p', {}, `You have unsaved edits in ${fileLabel}. Save them to disk before leaving?`)),
      h('footer', {}, dropBtn, h('span.grow'), keepBtn, saveAndGoBtn),
    );
    const subModal = openModal(dialogEl);
    keepBtn.addEventListener('click', () => {
      subModal.close();
      editor?.focus();
    });
    dropBtn.addEventListener('click', () => {
      subModal.close();
      editor?.discard();
      setDirtyState(false);
      onProceed();
    });
    saveAndGoBtn.addEventListener('click', () => {
      saveAndGoBtn.disabled = true;
      void saveCurrentFile(false).then((ok) => {
        subModal.close();
        if (ok) onProceed();
      });
    });
    setTimeout(() => saveAndGoBtn.focus(), 20);
  };

  const releaseEscape = claimEscape(el, () => deps.isActive() && !!editor?.closeSearch());

  const updateCrumbs = () => {
    if (!current) {
      crumbs.replaceChildren();
      crumbs.title = '';
      return;
    }
    const segs = current.split('/');
    const name = segs.pop()!;
    const parts: (string | Node)[] = [];
    segs.forEach((seg, i) => {
      const dirPath = segs.slice(0, i + 1).join('/');
      const b = h('button.bs-crumb', { type: 'button', title: `Show ${dirPath}/ in the tree` }, seg);
      b.addEventListener('click', () => revealInSidebar(dirPath));
      parts.push(b, h('span.bs-crumb-sep', { 'aria-hidden': 'true' }, '›'));
    });
    const git = allFiles.find((f) => f.path === current)?.git;
    crumbs.replaceChildren(
      ...parts,
      iconSvg(fileIcon(current)),
      h('span.bs-crumb-name', { class: git ? `git-${git}` : '' }, name),
      git ? h('span.bs-git-pill', { class: `git-${git}`, title: `${GIT_LABEL[git]} in git` }, GIT_LABEL[git]) : '',
      dirty ? h('span.bs-dirty-pill', { title: 'Unsaved changes in editor' }, '● Modified') : '',
    );
    crumbs.title = current;
  };

  const updateStatusAndMeta = () => {
    if (!current) return;
    const info = allFiles.find((f) => f.path === current);
    const activeText = editor ? editor.getText() : loadedText;
    const byteLen = new TextEncoder().encode(activeText).length;
    const words = activeText.split(/\s+/).filter(Boolean).length;
    meta.replaceChildren(
      [isDocPath(current) ? `${Math.max(1, Math.round(words / 220))} min read` : '', size(info && !dirty ? info.size : byteLen), info ? `updated ${timeAgo(info.mtime)}` : ''].filter(Boolean).join(' · '),
      blob ? h('a', { href: blobUrl(current), target: '_blank', rel: 'noopener noreferrer', title: `Open it on ${blob.site}` }, `${blob.site} ↗`) : '',
    );
    if (editor) statusLang.textContent = editor.languageName();
    statusInfo.textContent = [size(byteLen), saving ? 'Saving…' : dirty ? '● Unsaved changes' : info ? `Saved · updated ${timeAgo(info.mtime)}` : 'Saved'].join(' · ');
    statusInfo.classList.toggle('dirty', dirty);
    statusForge.replaceChildren(blob ? h('a', { href: blobUrl(current), target: '_blank', rel: 'noopener noreferrer', title: `Open it on ${blob.site}` }, `${blob.site} ↗`) : '');
  };

  const updateToolbar = () => {
    const hasFile = Boolean(current);
    const isMd = Boolean(current && isDocPath(current));
    modeGroup.hidden = !hasFile;
    modePreviewBtn.hidden = !isMd;
    modeSplitBtn.hidden = !isMd;
    for (const [m, btn] of [
      ['preview', modePreviewBtn],
      ['edit', modeEditBtn],
      ['split', modeSplitBtn],
    ] as const) {
      const on = viewMode === m;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-checked', String(on));
    }
    const inEditor = hasFile && (viewMode === 'edit' || viewMode === 'split');
    findBtn.hidden = !inEditor;
    discardBtn.hidden = !dirty;
    saveBtn.hidden = !inEditor && !dirty;
    saveBtn.disabled = !dirty || saving;
    saveBtn.replaceChildren(saving ? 'Saving…' : 'Save ', saving ? '' : h('span.key', {}, `${modKey}S`));
    meta.hidden = inEditor;
    statusBar.hidden = !inEditor;
    if (!isMd || viewMode === 'edit') toc.hidden = true;
    updateCrumbs();
    updateStatusAndMeta();
  };

  const setDirtyState = (nextDirty: boolean) => {
    const changed = dirty !== nextDirty;
    dirty = nextDirty;
    updateToolbar();
    if (changed) tree.setCurrent(current, dirty);
  };

  const renderMarkdownIntoPage = (text: string, path: string, preserveScroll = false) => {
    const prevTop = page.scrollTop;
    const body = text.trim() ? markdownFile(text) : h('div.md', {}, h('p.none', {}, 'This file is empty.'));
    wire(body, path);
    if (viewMode === 'edit' || !isDocPath(path)) toc.hidden = true;
    page.replaceChildren(body);
    if (preserveScroll) page.scrollTop = prevTop;
  };

  const ensureEditor = async (path: string, text: string): Promise<CodeEditor | null> => {
    if (editor) return editor;
    const mod = await editorModulePromise;
    if (disposed) return null;
    if (editor) return editor;
    editor = mod.createCodeEditor({
      parent: editorPane,
      path,
      text,
      onChange: (newText, isNowDirty) => {
        setDirtyState(isNowDirty);
        if (viewMode === 'split' && current && isDocPath(current)) {
          if (splitPreviewTimer) clearTimeout(splitPreviewTimer);
          splitPreviewTimer = setTimeout(() => {
            if (current && isDocPath(current)) renderMarkdownIntoPage(newText, current, true);
          }, 90);
        }
      },
      onSave: () => {
        void saveCurrentFile(false);
      },
      onCursor: (c: CodeEditorCursor) => {
        const selPart = c.selected > 0 ? ` (${c.selected} selected)` : '';
        statusCursor.textContent = `Ln ${c.line}, Col ${c.col}${selPart} · ${c.lines} line${c.lines === 1 ? '' : 's'}`;
      },
    });
    return editor;
  };

  const setViewMode = async (mode: DocViewMode, focusEditor = true) => {
    if (!current) return;
    const isMd = isDocPath(current);
    const targetMode: DocViewMode = isMd ? mode : 'edit';
    if (isMd) preferredMdMode = targetMode;
    viewMode = targetMode;

    editorPane.hidden = targetMode === 'preview';
    page.hidden = targetMode === 'edit';
    work.classList.toggle('is-split', targetMode === 'split');

    if (targetMode === 'preview') {
      const textToRender = editor ? editor.getText() : loadedText;
      renderMarkdownIntoPage(textToRender, current, true);
      updateToolbar();
      return;
    }

    const ed = await ensureEditor(current, loadedText);
    if (!ed || !el.isConnected || !current) return;
    if (targetMode === 'split' && isMd) {
      renderMarkdownIntoPage(ed.getText(), current, true);
    }
    updateToolbar();
    if (focusEditor) ed.focus();
  };

  const saveCurrentFile = async (forceOverwrite: boolean): Promise<boolean> => {
    if (!current || !editor || saving) return false;
    if (!dirty && !forceOverwrite) return true;
    const savingPath = current;
    const textToSave = editor.getText();
    saving = true;
    conflictBar.hidden = true;
    updateToolbar();
    try {
      const res = await putFileJson(`/api/docs/file?${q({})}`, {
        path: savingPath,
        text: textToSave,
        ...(forceOverwrite || currentMtime === undefined ? {} : { baseMtime: currentMtime }),
      });
      if (!el.isConnected) return false;
      loadedText = textToSave;
      currentMtime = res.mtime;
      const existing = allFiles.find((f) => f.path === savingPath);
      if (existing) {
        existing.size = res.size;
        existing.mtime = res.mtime;
        if (res.title !== undefined) existing.title = res.title;
        else delete existing.title;
      }
      if (current === savingPath) {
        editor.setSavedText(textToSave);
        if (isDocPath(savingPath) && viewMode !== 'edit') {
          renderMarkdownIntoPage(textToSave, savingPath, true);
        }
      }
      saving = false;
      setDirtyState(false);
      // Saving can change the file's git status, so the tree asks again.
      void loadFiles();
      toast(`Saved ${nameOf(savingPath)}`, 'info');
      return true;
    } catch (err) {
      if (!el.isConnected) return false;
      saving = false;
      if (err instanceof SaveConflictError) {
        conflictMsg.textContent = `${nameOf(savingPath)} changed on disk since you opened it.`;
        conflictBar.hidden = false;
      } else {
        toast(`Couldn't save ${nameOf(savingPath)}: ${(err as Error).message}`, 'error');
      }
      updateToolbar();
      return false;
    }
  };

  conflictReloadBtn.addEventListener('click', () => {
    if (!current) return;
    conflictBar.hidden = true;
    setDirtyState(false);
    const reloadPath = current;
    current = null;
    void openDoc(reloadPath);
  });

  conflictForceBtn.addEventListener('click', () => {
    void saveCurrentFile(true);
  });

  modePreviewBtn.addEventListener('click', () => void setViewMode('preview'));
  modeEditBtn.addEventListener('click', () => void setViewMode('edit'));
  modeSplitBtn.addEventListener('click', () => void setViewMode('split'));
  findBtn.addEventListener('click', () => {
    editor?.openSearch();
  });
  discardBtn.addEventListener('click', () => {
    if (!editor || !current) return;
    conflictBar.hidden = true;
    editor.discard();
    if (isDocPath(current) && viewMode !== 'edit') {
      renderMarkdownIntoPage(loadedText, current, true);
    }
    setDirtyState(false);
    toast(`Reverted changes in ${nameOf(current)}`, 'info');
  });
  saveBtn.addEventListener('click', () => {
    void saveCurrentFile(false);
  });

  const grepRows = () => [...grepList.querySelectorAll<HTMLElement>('.bs-grep-row')];
  const setGrepSel = (i: number) => {
    const all = grepRows();
    if (!all.length) return;
    grepSel = Math.max(0, Math.min(all.length - 1, i));
    for (const [k, r] of all.entries()) r.setAttribute('aria-selected', String(k === grepSel));
    all[grepSel].scrollIntoView({ block: 'nearest' });
  };

  /** The results the list was last drawn from, so reopening a file keeps your place in it. */
  let grepDrawn: DocSearchResults | null = null;
  const renderGrepResults = () => {
    const queryText = filter.value.trim();
    if (!queryText) {
      grepDrawn = null;
      count.textContent = `Search inside ${scope === 'docs' ? 'the docs' : 'every project file'}`;
      grepList.replaceChildren(h('div.ft-empty', {}, 'Type a word or phrase to find the lines it is on.'));
      return;
    }
    if (grepLoading) {
      count.textContent = 'Searching…';
      return;
    }
    const hits: DocSearchHit[] = grepResults?.hits ?? [];
    const totalMatches = hits.reduce((sum, x) => sum + x.matches.length, 0);
    count.textContent = hits.length ? `${totalMatches} match${totalMatches === 1 ? '' : 'es'} in ${hits.length}${grepResults?.more ? '+' : ''} file${hits.length === 1 ? '' : 's'}` : 'No matches';
    if (!hits.length) {
      grepDrawn = null;
      grepList.replaceChildren(h('div.ft-empty', {}, `Nothing ${scope === 'docs' ? 'in the docs' : 'in the project'} says “${queryText}”.`));
      return;
    }
    if (grepDrawn === grepResults) {
      for (const row of grepList.querySelectorAll<HTMLElement>('.bs-grep-file')) row.classList.toggle('is-open', row.title === current);
      return;
    }
    grepDrawn = grepResults;
    const items: HTMLElement[] = [];
    for (const hit of hits) {
      const name = nameOf(hit.path);
      const dir = hit.path.slice(0, hit.path.length - name.length - 1);
      const fileRow = h(
        'div.bs-grep-row.bs-grep-file',
        { role: 'option', 'aria-selected': 'false', class: hit.path === current ? 'is-open' : '', title: hit.path },
        iconSvg(fileIcon(hit.path)),
        h('span.ft-name', {}, name),
        dir ? h('span.ft-dir', {}, dir) : '',
        h('span.bs-grep-count', {}, String(hit.matches.length)),
      );
      fileRow.addEventListener('click', () => requestOpenDoc(hit.path));
      items.push(fileRow);
      for (const m of hit.matches) {
        const lineRow = h(
          'div.bs-grep-row.bs-grep-line',
          { role: 'option', 'aria-selected': 'false', title: `${hit.path}:${m.line}` },
          h('span.bs-grep-ln', {}, String(m.line)),
          h('span.bs-grep-text', {}, ...markSubstring(m.text, queryText)),
        );
        lineRow.addEventListener('click', () => requestOpenDoc(hit.path, `L${m.line}`));
        items.push(lineRow);
      }
    }
    grepList.replaceChildren(...items);
    grepSel = -1;
  };

  const updateCount = () => {
    const noun = scope === 'docs' ? 'doc' : 'file';
    const { shown, total, changed } = tree.counts();
    const plural = (n: number) => `${n} ${noun}${n === 1 ? '' : 's'}`;
    if (!total) count.textContent = '';
    else if (filter.value.trim()) count.textContent = `${shown} of ${plural(total)}`;
    else count.textContent = `${plural(total)}${moreFiles ? ` (the first ${total})` : ''}${changed ? ` · ${changed} changed` : ''}`;
  };

  const renderSidebar = () => {
    const grep = layout === 'grep';
    tree.el.hidden = grep;
    grepList.hidden = !grep;
    treeTools.hidden = grep;
    if (grep) renderGrepResults();
    else updateCount();
  };

  const triggerGrep = () => {
    if (grepTimer) clearTimeout(grepTimer);
    const queryText = filter.value.trim();
    if (!queryText) {
      grepLoading = false;
      grepResults = null;
      renderSidebar();
      return;
    }
    grepLoading = true;
    renderSidebar();
    const mySeq = ++grepSeq;
    grepTimer = setTimeout(() => {
      void getJson<DocSearchResults>(`/api/docs/search?${q({ q: queryText, all: scope === 'all' ? '1' : '0' })}`)
        .then((res) => {
          if (mySeq !== grepSeq || !el.isConnected) return;
          grepLoading = false;
          grepResults = res;
          renderSidebar();
        })
        .catch(() => {
          if (mySeq !== grepSeq || !el.isConnected) return;
          grepLoading = false;
          grepResults = { query: queryText, hits: [], more: false };
          renderSidebar();
        });
    }, 150);
  };

  const refilter = () => {
    if (layout === 'grep') {
      triggerGrep();
      return;
    }
    tree.setQuery(filter.value);
    renderSidebar();
  };

  const syncScopeAndLayoutUI = () => {
    for (const [s, btn] of [
      ['docs', scopeDocsBtn],
      ['all', scopeAllBtn],
    ] as const) {
      const on = scope === s;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-checked', String(on));
    }
    for (const [l, btn] of [
      ['files', layoutFilesBtn],
      ['grep', layoutGrepBtn],
    ] as const) {
      btn.setAttribute('aria-selected', String(layout === l));
    }
    filter.placeholder = layout === 'grep' ? (scope === 'docs' ? 'Search inside docs…' : 'Search inside files…') : scope === 'docs' ? 'Go to doc…' : 'Go to file…';
    filter.setAttribute('aria-label', filter.placeholder);
  };

  /** Hand the tree this scope's files. */
  const feedTree = () => {
    files = scope === 'all' ? allFiles : allFiles.filter((f) => isDocPath(f.path));
    tree.setFiles(files, `${floor}:${scope}`);
  };

  /** Whether you picked a scope yourself this visit, so the first listing doesn't override it. */
  let scopePicked = false;
  const applyScope = (nextScope: ShelfScope) => {
    if (scope === nextScope) return;
    scope = nextScope;
    feedTree();
    syncScopeAndLayoutUI();
    refilter();
  };

  const applyLayout = (nextLayout: SidebarLayout) => {
    if (layout === nextLayout) return;
    layout = nextLayout;
    if (layout === 'files') tree.setQuery('');
    filter.value = '';
    syncScopeAndLayoutUI();
    refilter();
    filter.focus();
  };

  /** Show `path` (a file or folder) in the tree, clearing a filter that would hide it. */
  const revealInSidebar = (path: string) => {
    if (layout !== 'files') applyLayout('files');
    if (filter.value) {
      filter.value = '';
      refilter();
    }
    tree.reveal(path);
    tree.focus();
  };

  /** Fetch the file list again (after a save, or the ↻ button), keeping what's expanded and open. */
  const loadFiles = async (): Promise<boolean> => {
    try {
      const r = await getJson<DocList>(`/api/docs?${q({ all: '1' })}`);
      if (!el.isConnected) return false;
      allFiles = r.files;
      moreFiles = r.more;
      feedTree();
      renderSidebar();
      updateCrumbs();
      return true;
    } catch (err) {
      if (el.isConnected) toast(`Couldn't list the project's files: ${(err as Error).message}`, 'warn');
      return false;
    }
  };

  const pickScope = (next: ShelfScope) => {
    scopePicked = true;
    rememberScope(floor, next);
    applyScope(next);
  };
  scopeDocsBtn.addEventListener('click', () => pickScope('docs'));
  scopeAllBtn.addEventListener('click', () => pickScope('all'));
  layoutFilesBtn.addEventListener('click', () => applyLayout('files'));
  layoutGrepBtn.addEventListener('click', () => applyLayout('grep'));
  locateBtn.addEventListener('click', () => {
    if (current) revealInSidebar(current);
  });
  expandBtn.addEventListener('click', () => tree.expandAll());
  collapseBtn.addEventListener('click', () => tree.collapseAll());
  refreshBtn.addEventListener('click', () => {
    refreshBtn.classList.add('spin');
    void loadFiles().then((ok) => {
      refreshBtn.classList.remove('spin');
      if (ok) toast('File list reloaded', 'info');
    });
  });

  filter.addEventListener('input', refilter);
  filter.addEventListener('keydown', (e) => {
    const grep = layout === 'grep';
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const by = e.key === 'ArrowDown' ? 1 : -1;
      if (grep) setGrepSel(grepSel + by);
      else tree.moveCursor(by);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (grep) grepRows()[Math.max(0, grepSel)]?.click();
      else tree.activateCursor();
    } else if (e.key === 'Tab' && !e.shiftKey && !grep) {
      e.preventDefault();
      tree.focus();
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      // The page, not the box: read on without leaving the filter.
      e.preventDefault();
      page.scrollBy({ top: (e.key === 'PageDown' ? 1 : -1) * page.clientHeight * 0.85, behavior: 'smooth' });
    }
  });
  // Typing while the tree has focus goes to the filter, the way IDE trees speed-search.
  tree.el.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1 || e.key === ' ' || e.key === '*') return;
    filter.focus();
  });

  // Dragging the sidebar's edge resizes it; the width is remembered.
  const SIDE_KEY = 'factory-flow.bookshelf.side';
  const setSide = (px: number) => {
    const w = Math.round(Math.max(200, Math.min(560, px)));
    el.style.setProperty('--bs-side', `${w}px`);
    return w;
  };
  try {
    const savedSide = Number(localStorage.getItem(SIDE_KEY));
    if (savedSide) setSide(savedSide);
  } catch {
    // Storage is off: the sidebar starts at its default width.
  }
  resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    resizer.setPointerCapture(e.pointerId);
    const left = docsBody.getBoundingClientRect().left;
    let width = el.style.getPropertyValue('--bs-side');
    const onMove = (ev: PointerEvent) => {
      width = String(setSide(ev.clientX - left));
    };
    const onEnd = () => {
      resizer.removeEventListener('pointermove', onMove);
      resizer.removeEventListener('pointerup', onEnd);
      resizer.removeEventListener('pointercancel', onEnd);
      resizer.removeEventListener('lostpointercapture', onEnd);
      try {
        if (width) localStorage.setItem(SIDE_KEY, String(Number.parseInt(width, 10)));
      } catch {
        // Storage is off: the width just won't be remembered.
      }
    };
    resizer.addEventListener('pointermove', onMove);
    resizer.addEventListener('pointerup', onEnd);
    resizer.addEventListener('pointercancel', onEnd);
    resizer.addEventListener('lostpointercapture', onEnd);
  });
  resizer.addEventListener('dblclick', () => {
    el.style.removeProperty('--bs-side');
    try {
      localStorage.removeItem(SIDE_KEY);
    } catch {
      // Storage is off.
    }
  });

  // Esc in a filled box clears it first; the next Esc closes the window.
  const releaseFilterEscape = claimEscape(findBox, () => {
    if (!deps.isActive()) return false;
    const at = document.activeElement;
    if (!filter.value || !(at === filter || tree.el.contains(at))) return false;
    filter.value = '';
    refilter();
    return true;
  });

  // File commands stay scoped to the active tab.
  const onKey = (e: KeyboardEvent) => {
    if (!deps.isActive() || e.defaultPrevented) return;
    const mod = (e.metaKey || e.ctrlKey) && !e.altKey;
    const key = e.key.toLowerCase();
    if (mod && !e.shiftKey && key === 'p') {
      // Go to file, as in IDEs (and not the browser's Print).
      e.preventDefault();
      applyLayout('files');
      filter.focus();
      filter.select();
      return;
    }
    if (mod && e.shiftKey && key === 'f') {
      e.preventDefault();
      applyLayout('grep');
      filter.focus();
      filter.select();
      return;
    }
    if (!current) return;
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void saveCurrentFile(false);
    } else if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'e') {
      if (isDocPath(current)) {
        e.preventDefault();
        void setViewMode(viewMode === 'preview' ? 'edit' : 'preview');
      }
    }
  };
  deps.keyboardRoot.addEventListener('keydown', onKey);

  const jump = (hash: string) => {
    const lineNum = parseLineHash(hash);
    if (lineNum !== undefined) {
      void setViewMode(isDocPath(current ?? '') && viewMode === 'split' ? 'split' : 'edit').then(() => {
        editor?.goToLine(lineNum);
      });
      return;
    }
    jumpTo(page, hash);
  };

  /** Points the doc's links and pictures at the project: project docs & editable files open here, the rest on the forge. */
  function wire(body: HTMLElement, path: string) {
    anchorHeadings(body, toc);
    for (const a of body.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const to = resolveDocLink(path, a.getAttribute('href') ?? '');
      if (!to) continue;
      if (to.path === path || isDocPath(to.path) || isEditablePath(to.path)) {
        a.removeAttribute('target');
        a.dataset.doc = to.path;
        a.dataset.hash = to.hash;
      } else if (blob) {
        a.href = blobUrl(to.path, to.hash);
      } else {
        a.removeAttribute('href');
        a.title = to.path;
      }
    }
    for (const img of body.querySelectorAll<HTMLImageElement>('img[src]')) {
      const to = resolveDocLink(path, img.getAttribute('src') ?? '');
      if (to) img.src = withToken(`/api/docs/picture?${q({ path: to.path })}`);
    }
  }

  const openDoc = async (path: string, hash = '') => {
    if (path === current) {
      jump(hash);
      return;
    }
    const mine = ++opening;
    let doc: DocText;
    try {
      doc = await getJson<DocText>(`/api/docs/file?${q({ path })}`);
    } catch (err) {
      if (mine !== opening) return;
      toast(`Couldn't open ${nameOf(path)}: ${(err as Error).message}`, 'warn');
      if (!current) page.replaceChildren(emptyState('📕', `Couldn't open ${nameOf(path)}`, (err as Error).message));
      return;
    }
    if (mine !== opening || !el.isConnected) return;

    // If a non-Markdown file was opened (e.g. via a link in a doc), switch scope to All files so it shows in the sidebar.
    if (!isDocPath(path) && scope === 'docs') applyScope('all');

    current = path;
    currentMtime = doc.mtime;
    loadedText = doc.text;
    dirty = false;
    saving = false;
    conflictBar.hidden = true;
    rememberRead(floor, path);

    const isMd = isDocPath(path);
    const lineNum = parseLineHash(hash);
    const nextMode: DocViewMode = !isMd ? 'edit' : lineNum !== undefined ? (preferredMdMode === 'split' ? 'split' : 'edit') : preferredMdMode;
    viewMode = nextMode;

    editorPane.hidden = nextMode === 'preview';
    page.hidden = nextMode === 'edit';
    work.classList.toggle('is-split', nextMode === 'split');

    if (editor) {
      editor.loadFile(path, doc.text);
    } else if (nextMode !== 'preview') {
      await ensureEditor(path, doc.text);
    }
    if (disposed) return;

    if (isMd && nextMode !== 'edit') {
      renderMarkdownIntoPage(doc.text, path, false);
    }

    updateToolbar();
    tree.setCurrent(path, false);
    renderSidebar();
    if (lineNum !== undefined) {
      editor?.goToLine(lineNum);
    } else if (nextMode !== 'edit') {
      jumpTo(page, hash);
    } else {
      editor?.focus();
    }
  };

  const requestOpenDoc = (path: string, hash = '') => {
    if (path === current) {
      jump(hash);
      return;
    }
    confirmUnsaved('open file', () => {
      void openDoc(path, hash);
    });
  };

  page.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[data-doc]') : null;
    if (!a) return;
    e.preventDefault();
    requestOpenDoc(a.dataset.doc!, a.dataset.hash ?? '');
  });
  toc.addEventListener('change', () => {
    jumpTo(page, toc.value);
    toc.value = '';
  });

  getJson<DocList>(`/api/docs?${q({ all: '1' })}`)
    .then((r) => {
      if (!el.isConnected) return;
      allFiles = r.files;
      moreFiles = r.more;
      // Docs when the project has Markdown, else All files; and whichever you picked last time.
      const hasDocs = allFiles.some((f) => isDocPath(f.path));
      const saved = lastScope(floor);
      if (!scopePicked) scope = !hasDocs && allFiles.length ? 'all' : (saved ?? 'docs');
      feedTree();
      syncScopeAndLayoutUI();
      refilter();
      const last = lastRead(floor);
      const start = [last, ...shelfOrder(files).map((f) => f.path)].find((p) => p && allFiles.some((f) => f.path === p));
      if (start) void openDoc(start);
      else page.replaceChildren(emptyState('📚', 'Nothing to read here', 'This project has no editable files yet.'));
    })
    .catch((err: Error) => {
      if (!el.isConnected) return;
      count.textContent = '';
      page.replaceChildren(emptyState('📕', 'Couldn’t load project files', err.message));
    });
  return {
    beforeClose: (proceed) => confirmUnsaved('close', proceed),
    dispose() {
      disposed = true;
      opening++;
      grepSeq++;
      releaseEscape();
      releaseFilterEscape();
      deps.keyboardRoot.removeEventListener('keydown', onKey);
      if (splitPreviewTimer) clearTimeout(splitPreviewTimer);
      if (grepTimer) clearTimeout(grepTimer);
      tree.dispose();
      editor?.destroy();
      editor = null;
    },
  };
}
