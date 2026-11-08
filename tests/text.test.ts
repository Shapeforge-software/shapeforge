import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseProject, serializeProject } from '../src/core/project';
import { createShape } from '../src/core/scene';
import { cleanParams, defaultParams } from '../src/core/shapes';
import { FONTS, glyphFor, layoutText, pixelSteps, textOf, textParams, weightOf } from '../src/core/text';
import type { Shape, Vec3 } from '../src/core/types';
import { shapeCells } from '../src/core/voxelize';
import { unkey } from '../src/core/voxelize-keys';

const fontIndex = (id: string) => FONTS.findIndex((f) => f.id === id);
const text = (words: string, params: Record<string, number> = {}, position?: Vec3): Shape => {
  const s = createShape('text');
  return { ...s, position: position ?? s.position, params: cleanParams('text', { ...s.params, ...params, ...textParams(words) }) };
};
const blocks = (s: Shape) => [...shapeCells(s)].map(unkey);

test('every built-in font has the capitals and digits, and its licence named', () => {
  assert.equal(FONTS.length, 17);
  for (const f of FONTS) {
    assert.ok(/Open Font License|Apache/.test(f.licence), f.name);
    for (const w of f.weights) {
      for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') assert.ok(w.glyphs[String(ch.charCodeAt(0))], `${f.name} ${w.weight} has ${ch}`);
    }
  }
});

test('the four pixel fonts sit on their pixel grids; the letter height steps by whole pixels', () => {
  const pixel = FONTS.filter((f) => f.weights.every((w) => w.grid > 0)).map((f) => f.id).sort();
  assert.deepEqual(pixel, ['micro5', 'pressStart2p', 'silkscreen', 'tiny5']);
  const w = FONTS[fontIndex('pressStart2p')].weights[0];
  const { capPixels } = pixelSteps(w, 7);
  assert.equal(layoutText({ font: fontIndex('pressStart2p'), size: 7, ...textParams('H') }).capBlocks, capPixels);
  // Twice the pixels: every font pixel is 2 by 2 blocks, so four times the blocks.
  const one = blocks(text('HELLO 42', { font: fontIndex('pressStart2p'), size: capPixels }));
  const two = blocks(text('HELLO 42', { font: fontIndex('pressStart2p'), size: 2 * capPixels }));
  assert.equal(two.length, 4 * one.length);
});

test('the weight starts at the heaviest a font has; one it hasn\'t got becomes the nearest', () => {
  const used = (q: Record<string, number>) => weightOf(cleanParams('text', q)).weight;
  assert.equal(used({ font: fontIndex('cinzel') }), 900);
  assert.equal(used({ font: fontIndex('silkscreen') }), 700);
  assert.equal(used({ font: fontIndex('bungee') }), 400);
  assert.equal(used({ font: fontIndex('cinzel'), weight: 500 }), 400);
  // The weight asked for is kept, so a font with only Regular doesn't stop the next one being Black.
  assert.equal(defaultParams('text').weight, 900);
  assert.equal(used({ ...cleanParams('text', { font: fontIndex('bungee') }), font: fontIndex('orbitron') }), 900);
  // Heavier letters use more blocks.
  const light = blocks(text('Embervale', { font: fontIndex('cinzel'), size: 16, weight: 400 }));
  const black = blocks(text('Embervale', { font: fontIndex('cinzel'), size: 16, weight: 900 }));
  assert.ok(black.length > light.length * 1.2, `${black.length} vs ${light.length}`);
});

test('several lines stack down, lined up left, middle or right', () => {
  const one = layoutText(cleanParams('text', { ...textParams('INN'), font: fontIndex('bungee'), size: 10 }));
  const two = layoutText(cleanParams('text', { ...textParams('INN\nAND FORGE'), font: fontIndex('bungee'), size: 10 }));
  assert.ok(two.height > one.height * 1.8, 'two lines, about twice as tall');
  assert.ok(two.width > one.width, 'as wide as the longer line');
  // The short line's left edge, for each alignment.
  const leftOf = (align: number) => {
    const l = layoutText(cleanParams('text', { ...textParams('INN\nAND FORGE'), font: fontIndex('bungee'), size: 10, align }));
    const top = Math.max(...l.glyphs.map((g) => g.y1));
    return Math.min(...l.glyphs.filter((g) => g.y1 > top - 1).map((g) => g.x0));
  };
  assert.ok(leftOf(0) < leftOf(1) && leftOf(1) < leftOf(2), `${leftOf(0)} < ${leftOf(1)} < ${leftOf(2)}`);
});

test('moved by half a meter, a pixel font builds the same blocks, moved by one', () => {
  const p = { font: fontIndex('tiny5'), size: 5 };
  const a = blocks(text('Forge 7', p, [0, 3, 0]));
  const b = blocks(text('Forge 7', p, [0.5, 3, 0.5]));
  const key = (c: number[]) => c.join(',');
  assert.deepEqual(new Set(b.map(key)), new Set(a.map(([i, j, k]) => key([i + 1, j, k + 1]))));
});

test('characters a font hasn\'t got are left out; an empty text builds nothing', () => {
  assert.ok(blocks(text('A☃B', { font: fontIndex('pressStart2p') })).length > 0);
  assert.equal(blocks(text('   ')).length, 0);
  assert.equal(textOf(cleanParams('text', {})), 'Embervale');
});

test('a project keeps the words, line breaks and font', () => {
  const s = text('Smithy\nOpen late', { font: fontIndex('unifraktur'), size: 14 });
  const back = parseProject(serializeProject({ name: 't', shapes: [s] })).shapes[0];
  assert.equal(textOf(back.params), 'Smithy\nOpen late');
  assert.equal(back.params.font, fontIndex('unifraktur'));
  assert.equal(blocks(back).length, blocks(s).length);
});

test('justified: every line but the last reaches both edges, the extra between words; the last stays left', () => {
  const words = 'THE EMBER\nHALL OF KINGS\nOPEN';
  for (const id of ['bungee', 'pressStart2p']) {
    const l = layoutText(cleanParams('text', { ...textParams(words), font: fontIndex(id), size: 10, align: 3 }));
    // Letters grouped into lines, top first; each line's left and right edge.
    const lineOf = (g: { y0: number; y1: number }) => l.glyphs.filter((h) => Math.abs((h.y0 + h.y1) / 2 - (g.y0 + g.y1) / 2) < 3);
    const byLine = new Map<number, typeof l.glyphs>();
    for (const g of l.glyphs) {
      const key = Math.round(Math.max(...lineOf(g).map((h) => h.y1)));
      byLine.set(key, [...(byLine.get(key) ?? []), g]);
    }
    const lines = [...byLine.entries()].sort((a, b) => b[0] - a[0]).map(([, gs]) => ({ left: Math.min(...gs.map((g) => g.x0)), right: Math.max(...gs.map((g) => g.x1)) }));
    assert.equal(lines.length, 3, `${id}: three lines`);
    const left = Math.min(...lines.map((r) => r.left)), right = Math.max(...lines.map((r) => r.right));
    for (const r of lines) assert.ok(Math.abs(r.left - left) < 1.01, `${id}: lines start at the left`);
    assert.ok(Math.abs(lines[0].right - right) < 1.01, `${id}: first line reaches the right edge`);
    assert.ok(Math.abs(lines[1].right - right) < 1.01, `${id}: middle line reaches the right edge`);
    assert.ok(lines[2].right < right - 5, `${id}: last line stays short, on the left`);
    if (id === 'pressStart2p') for (const g of l.glyphs) assert.ok(Math.abs(g.x0 - Math.round(g.x0)) < 1e-6, 'pixel letters on whole blocks');
  }
});

test('wider character sets: Greek, Cyrillic and symbols build where a font has them; a symbol past U+FFFF is one character', () => {
  const ps2p = fontIndex('pressStart2p');
  for (const s of ['ΩΔΣ', 'ЖЯШ', '→★']) assert.ok(blocks(text(s, { font: fontIndex('tiny5') })).length > 0, s);
  assert.ok(blocks(text('ΔΣ', { font: ps2p })).length > 0);
  // Two code units, one character: kept whole through storage, and laid out as one (borrowed from Noto Emoji).
  const dragon = '\u{1F409}';
  assert.equal(textOf(cleanParams('text', textParams(`A${dragon}B`))), `A${dragon}B`);
  const withDragon = layoutText(cleanParams('text', { ...textParams(`A${dragon}B`), font: ps2p, size: 8 }));
  const without = layoutText(cleanParams('text', { ...textParams('AB'), font: ps2p, size: 8 }));
  assert.equal(withDragon.glyphs.length, without.glyphs.length + 1);
});

test('symbols a letter font hasn\'t got are borrowed from the symbol fonts, at the letters\' size, on their baseline', () => {
  const cinzel = FONTS[fontIndex('cinzel')].weights[0];
  for (const [ch, from] of [['\u2694', 'Noto Sans Symbols'], ['\u265E', 'Noto Sans Symbols 2'], ['\u16A0', 'Noto Sans Runic'], ['\u{13080}', 'Noto Sans Egyptian Hieroglyphs'], ['\u{1F409}', 'Noto Emoji'], ['\u{1D11E}', 'Noto Music'], ['\u{1F701}', 'Noto Sans Symbols']] as const) {
    const found = glyphFor(cinzel, ch.codePointAt(0)!);
    assert.equal(found?.font?.name, from, ch);
  }
  // A letter the font has is its own.
  assert.equal(glyphFor(cinzel, 65)?.font, undefined);
  // "⚔ HALL ⚔": the swords about as tall as the capitals, sitting on the same line.
  const l = layoutText(cleanParams('text', { ...textParams('\u2694HALL\u2694'), font: fontIndex('cinzel'), size: 20 }));
  assert.equal(l.glyphs.length, 6);
  const sword = l.glyphs[0], h = l.glyphs[1];
  assert.ok(sword.y1 - sword.y0 > 0.6 * (h.y1 - h.y0) && sword.y1 - sword.y0 < 1.8 * (h.y1 - h.y0), `${sword.y1 - sword.y0} vs ${h.y1 - h.y0}`);
  assert.ok(Math.abs(sword.y0 - h.y0) < 0.4 * (h.y1 - h.y0));
  // In a pixel font, a borrowed symbol moves the next letter on by whole blocks.
  const p = layoutText(cleanParams('text', { ...textParams('A\u2694B'), font: fontIndex('pressStart2p'), size: 8 }));
  for (const g of [p.glyphs[0], p.glyphs[2]]) assert.ok(Math.abs(g.x0 - Math.round(g.x0)) < 1e-6);
});

test('the symbol picker groups a font\'s characters beyond letters and digits', async () => {
  const { symbolsIn } = await import('../src/core/symbols');
  const tiny = symbolsIn(FONTS[fontIndex('tiny5')].weights[0]);
  const names = tiny.map((g) => g.name);
  for (const n of ['Accented letters', 'Greek', 'Cyrillic', 'Arrows', 'Shapes', 'Symbols']) assert.ok(names.includes(n), n);
  assert.ok(tiny.every((g) => g.symbols.every((s) => !/[A-Za-z0-9]/.test(s.ch))));
  for (const n of ['Runes', 'Chess', 'Playing cards', 'Alchemy', 'Music', 'Egyptian hieroglyphs', 'Nature and things']) assert.ok(names.includes(n), n);
});

test('the font menu says which languages\' letters each font has; missing letters are left out, not borrowed', async () => {
  const { fontLanguages, languagesLabel } = await import('../src/core/text');
  const f = (id: string) => FONTS[fontIndex(id)];
  assert.equal(languagesLabel(f('tiny5')), 'all European accents, Greek, Cyrillic');
  assert.equal(languagesLabel(f('anton')), 'all European accents');
  assert.equal(fontLanguages(f('cinzel')).european, 'most');
  assert.equal(fontLanguages(f('silkscreen')).european, 'western');
  assert.ok(fontLanguages(f('silkscreen')).missing.includes('ł'));
  assert.equal(glyphFor(f('silkscreen').weights[0], 'ł'.codePointAt(0)!), null);
  assert.ok(glyphFor(f('silkscreen').weights[0], 0x2694)?.font, 'symbols still borrowed');
  assert.ok(cleanParams('text', {}) && /\(all European accents\)/.test(String((await import('../src/core/shapes')).SHAPES.text.params.find((p) => p.key === 'font')!.choices![fontIndex('anton')].label)));
});
