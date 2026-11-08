/**
 * A small Markdown renderer for showing the README inside the app (About > Open the README). It covers what the
 * README uses: # headings (with GitHub's anchor ids), paragraphs, - and 1. lists (nested by indenting), | tables,
 * ``` code blocks, `code`, **bold**, *italic* and [links](...). Everything is escaped: the only markup in the result
 * is what this file writes. Links to #anchors stay in the page, https: and mailto: links open outside, anything else
 * is shown as plain text.
 */

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** GitHub's anchor for a heading: lower case, punctuation dropped, spaces to hyphens. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/`|\*\*|\*/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

function link(text: string, url: string, idPrefix: string): string {
  const u = url.trim();
  if (u.startsWith('#')) return `<a href="#${escape(idPrefix + u.slice(1))}">${text}</a>`;
  if (/^(https:|mailto:)/i.test(u)) return `<a href="${escape(u)}" target="_blank" rel="noreferrer">${text}</a>`;
  return text;
}

/** Inline markup within one block's text. idPrefix goes before #anchor links' ids (see markdownToHtml). */
export function inline(src: string, idPrefix = ''): string {
  // Code spans first, so nothing inside them is read as markup.
  return src
    .split(/(`[^`]+`)/)
    .map((part, n) => {
      if (n % 2 === 1) return `<code>${escape(part.slice(1, -1))}</code>`;
      let s = escape(part);
      s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t: string, u: string) => link(t, u.replace(/&amp;/g, '&'), idPrefix));
      s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, '$1<em>$2</em>');
      return s;
    })
    .join('');
}

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

interface ListNode { ordered: boolean; indent: number; items: { text: string; children: ListNode[] }[] }

function renderList(list: ListNode, idPrefix: string): string {
  const tag = list.ordered ? 'ol' : 'ul';
  const items = list.items.map((it) => `<li>${inline(it.text, idPrefix)}${it.children.map((c) => renderList(c, idPrefix)).join('')}</li>`).join('');
  return `<${tag}>${items}</${tag}>`;
}

/**
 * The whole document as HTML. idPrefix goes before every heading's id and #anchor link (so a page's ids can't clash
 * with the ones around it).
 */
export function markdownToHtml(md: string, idPrefix = ''): string {
  const inl = (s: string) => inline(s, idPrefix);
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const used = new Map<string, number>();
  let i = 0;
  const blank = (s: string | undefined) => s === undefined || s.trim() === '';
  const startsBlock = (s: string) => /^(#{1,6}\s|```|\s*\|)/.test(s) || LIST_ITEM.test(s);

  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) { i++; continue; }

    // ``` code
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escape(body.join('\n'))}</code></pre>`);
      continue;
    }

    // # heading
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = h[1].length;
      let id = slugify(h[2]);
      const n = used.get(id) ?? 0;
      used.set(id, n + 1);
      if (n) id = `${id}-${n}`;
      out.push(`<h${level} id="${escape(idPrefix + id)}">${inl(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // | table |
    if (line.trim().startsWith('|') && TABLE_RULE.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inl(c)}</th>`).join('')}</tr></thead>` +
          `<tbody>${rows.map((r) => `<tr>${head.map((_c, k) => `<td>${inl(r[k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
      );
      continue;
    }

    // - lists and 1. lists, nested by indent; an item's following indented lines join it.
    if (LIST_ITEM.test(line)) {
      const roots: ListNode[] = [];
      const stack: ListNode[] = [];
      while (i < lines.length && !blank(lines[i])) {
        const m = LIST_ITEM.exec(lines[i]);
        if (!m) {
          const top = stack[stack.length - 1];
          const last = top.items[top.items.length - 1];
          last.text += ` ${lines[i].trim()}`;
          i++;
          continue;
        }
        const indent = m[1].length;
        const ordered = /\d/.test(m[2]);
        while (stack.length && stack[stack.length - 1].indent > indent) stack.pop();
        let top = stack[stack.length - 1];
        if (!top || top.indent < indent) {
          const node: ListNode = { ordered, indent, items: [] };
          if (top) top.items[top.items.length - 1].children.push(node);
          else roots.push(node);
          stack.push(node);
          top = node;
        }
        top.items.push({ text: m[3], children: [] });
        i++;
      }
      out.push(roots.map((r) => renderList(r, idPrefix)).join(''));
      continue;
    }

    // A paragraph: lines up to a blank line or the start of another block.
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && !blank(lines[i]) && !startsBlock(lines[i])) para.push(lines[i++].trim());
    out.push(`<p>${inl(para.join(' '))}</p>`);
  }
  return out.join('\n');
}
