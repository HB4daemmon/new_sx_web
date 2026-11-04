type Attrs = Record<string, unknown> | null;
type Child = Node | string | number | null | undefined | false | Child[];

/** Minimal hyperscript: h('div.cls#id', {onclick, style, data-x}, ...children). */
export function h<K extends keyof HTMLElementTagNameMap>(spec: K | string, attrs: Attrs = null, ...children: Child[]): HTMLElement {
  const [, tag = 'div', rest = ''] = /^([a-z0-9-]*)(.*)$/i.exec(spec) ?? [];
  const el = document.createElement(tag || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) ?? []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value as EventListener);
      else if (key === 'style' && typeof value === 'object') {
        for (const [prop, v] of Object.entries(value as Record<string, string>)) {
          if (prop.startsWith('--')) el.style.setProperty(prop, v);
          else (el.style as unknown as Record<string, string>)[prop] = v;
        }
      }
      else if (key === 'class') el.className += ` ${value}`;
      else if (key === 'html') el.innerHTML = String(value);
      else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T | null;
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)] as T[];

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  const r = Math.round(n);
  if (Math.abs(r) >= 1e8) return `${(r / 1e8).toFixed(2)}亿`;
  if (Math.abs(r) >= 1e5) return `${(r / 1e4).toFixed(1)}万`;
  return r.toLocaleString('en-US');
}
export const fmt1 = (n: number) => (n >= 100 || Math.abs(n - Math.round(n)) < 0.05 ? fmt(n) : n.toFixed(1));
