import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { inline, markdownToHtml, slugify } from '../src/core/markdown';

test('headings get GitHub anchor ids', () => {
  assert.equal(slugify('Run it (Windows)'), 'run-it-windows');
  assert.equal(slugify('2D shapes'), '2d-shapes');
  assert.equal(markdownToHtml('## Where it lands in game'), '<h2 id="where-it-lands-in-game">Where it lands in game</h2>');
  assert.match(markdownToHtml('# A\n\n# A'), /id="a".*id="a-1"/s);
});

test('inline markup: code, bold, italic, links; everything else escaped', () => {
  assert.equal(inline('**Save** a `.shapeforge` file'), '<strong>Save</strong> a <code>.shapeforge</code> file');
  assert.equal(inline('an *imported layer* here'), 'an <em>imported layer</em> here');
  assert.equal(inline('`a **b** <c>`'), '<code>a **b** &lt;c&gt;</code>');
  assert.equal(inline('2 * 3 * 4'), '2 * 3 * 4');
  assert.equal(inline('see [Roofs](#roofs)'), 'see <a href="#roofs">Roofs</a>');
  assert.equal(inline('[Node](https://nodejs.org)'), '<a href="https://nodejs.org" target="_blank" rel="noreferrer">Node</a>');
  assert.equal(inline('[x](javascript:void)'), 'x');
  assert.equal(inline('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('a prefix goes on every id and #anchor link', () => {
  assert.equal(markdownToHtml('## Scale\n\nSee [Scale](#scale).', 'readme-'), '<h2 id="readme-scale">Scale</h2>\n<p>See <a href="#readme-scale">Scale</a>.</p>');
});

test('lists, nested lists and continued items', () => {
  assert.equal(markdownToHtml('- a\n- b\n  - c\n  - d\n- e'), '<ul><li>a</li><li>b<ul><li>c</li><li>d</li></ul></li><li>e</li></ul>');
  assert.equal(markdownToHtml('1. one\n2. two\n   more'), '<ol><li>one</li><li>two more</li></ol>');
});

test('tables, code blocks and paragraphs', () => {
  assert.equal(
    markdownToHtml('| A | B |\n| --- | --- |\n| 1 | **2** |'),
    '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td><strong>2</strong></td></tr></tbody></table>',
  );
  assert.equal(markdownToHtml('```text\n <a> **b**\n```'), '<pre><code> &lt;a&gt; **b**</code></pre>');
  assert.equal(markdownToHtml('one\ntwo\n\nthree'), '<p>one two</p>\n<p>three</p>');
});

test('the README renders, and every link inside it lands on a heading', () => {
  const html = markdownToHtml(readFileSync(join(__dirname, '..', 'README.md'), 'utf8'));
  const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(anchors.length >= 3);
  for (const a of anchors) assert.ok(ids.has(a), `#${a} goes nowhere`);
  assert.ok(html.includes('<table>'));
  assert.ok(html.startsWith('<h1 id="shapeforge">ShapeForge</h1>\n<pre><code>'));
});
