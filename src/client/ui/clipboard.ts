import { h } from './dom';

export type Os = 'mac' | 'linux' | 'windows';

export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Not a secure context: fall back to a hidden textarea.
    const ta = h('textarea.clipboard-proxy', { 'aria-hidden': 'true' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function copyButton(label: string, text: () => string, cls = '') {
  const btn = h('button.btn', { type: 'button', class: cls }, label);
  btn.addEventListener('click', async () => {
    btn.textContent = (await copy(text())) ? '✓ Copied' : 'Copy failed';
    setTimeout(() => (btn.textContent = label), 1600);
  });
  return btn;
}
