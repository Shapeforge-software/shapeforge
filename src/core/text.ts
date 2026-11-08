import { FONTS } from './fonts';
import { SYMBOL_FONTS } from './symbolfonts';
import { VOXEL_SIZE } from './types';

/**
 * Block text: words laid out in one of the built-in fonts (src/core/fonts, made from the font files in fonts/ by
 * tools/build-fonts.py) and built as a 2D shape, so it lies or stands, flat or cylinderized, filled or hollow like
 * the others (see shapes2d.ts).
 *
 * Letters are measured in blocks: Letter height is the height of a capital. A pixel font's own pixels are kept a
 * whole number of blocks (its letter height steps by its capital height in pixels), and its letters are placed on
 * whole blocks, so it builds exactly as drawn. The text's box is an even number of blocks each way, so, sitting on
 * the usual 0.5 m positions, every letter lands on the block grid the same way wherever it is moved.
 */

export interface FontWeight {
  weight: number;
  upm: number;
  /** Capital height, in font units. */
  cap: number;
  ascent: number;
  descent: number;
  lineGap: number;
  /** A pixel font's pixels to the em (0 for other fonts). */
  grid: number;
  /** By character code: advance, and the outline as polygons of x, y pairs (font units, y up). */
  glyphs: Record<string, [number, number[][]]>;
  /** Kerning between character codes: kern[left][right], font units. */
  kern: Record<string, Record<string, number>>;
}

export interface FontData {
  id: string;
  name: string;
  group: 'small' | 'medium' | 'fantasy' | 'scifi' | 'graffiti';
  licence: string;
  weights: FontWeight[];
}

export { FONTS, SYMBOL_FONTS };

/** A symbol font (src/core/symbolfonts): borrowed from for characters a letter font hasn't got. */
export interface SymbolFont {
  id: string;
  name: string;
  licence: string;
  weight: FontWeight;
}

export type Glyph2D = [number, number[][]];

/** Latin, Greek and Cyrillic letters: what a letter font has or hasn't got (not borrowed; see glyphFor). */
const OWN_LETTER = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u;

const span = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
/** Central and Eastern European letters (Latin Extended-A, less three old forms) and Romanian's ș and ț. */
const EXTENDED_EUROPEAN = [...span(0x100, 0x17f).filter((c) => ![0x138, 0x149, 0x17f].includes(c)), 0x218, 0x219, 0x21a, 0x21b];
const GREEK = [...span(0x391, 0x3a1), ...span(0x3a3, 0x3a9), ...span(0x3b1, 0x3c9)];
const CYRILLIC = span(0x410, 0x44f);

export interface FontLanguages {
  /** Accented letters: every European language that uses Latin letters, most of them, or Western European only. */
  european: 'all' | 'most' | 'western';
  /** Extended European letters it lacks (ł, č, ş, ...), when not all. */
  missing: string[];
  greek: boolean;
  cyrillic: boolean;
}

/** Which languages' letters a font has (its first weight). */
export function fontLanguages(f: FontData): FontLanguages {
  const w = f.weights[0];
  const has = (c: number) => !!w.glyphs[String(c)]?.[1].length;
  const lacking = EXTENDED_EUROPEAN.filter((c) => !has(c));
  const share = 1 - lacking.length / EXTENDED_EUROPEAN.length;
  return {
    european: share >= 0.95 ? 'all' : share >= 0.7 ? 'most' : 'western',
    missing: lacking.map((c) => String.fromCodePoint(c)),
    greek: GREEK.every(has),
    cyrillic: CYRILLIC.every(has),
  };
}

/** A short note for the font menu: "all European accents, Greek, Cyrillic". */
export function languagesLabel(f: FontData): string {
  const l = fontLanguages(f);
  const accents = { all: 'all European accents', most: 'most European accents', western: 'Western European accents only' }[l.european];
  return [accents, ...(l.greek ? ['Greek'] : []), ...(l.cyrillic ? ['Cyrillic'] : [])].join(', ');
}

/**
 * Where a character's outline comes from: the letter font itself, or else the first symbol font that has it (in
 * SYMBOL_FONTS order). `from` is the font it comes from (its weight's measurements); `font` names a symbol font.
 */
export function glyphFor(w: FontWeight, code: number): { g: Glyph2D; from: FontWeight; font?: SymbolFont } | null {
  const own = w.glyphs[String(code)];
  if (own) return { g: own, from: w };
  // Letters of the font's own alphabets are never borrowed: a ł in another font's style would stand out in a word.
  if (OWN_LETTER.test(String.fromCodePoint(code))) return null;
  for (const s of SYMBOL_FONTS) {
    const g = s.weight.glyphs[String(code)];
    if (g) return { g, from: s.weight, font: s };
  }
  return null;
}

export const FONT_GROUPS: Record<FontData['group'], string> = {
  small: 'Small and readable (pixel)', medium: 'Block letters', fantasy: 'Medieval and fantasy', scifi: 'Sci-fi and modern', graffiti: 'Graffiti',
};

export const WEIGHT_NAMES: Record<number, string> = { 100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' };

/** Longest text kept. */
export const MAX_TEXT = 400;
export const DEFAULT_TEXT = 'Embervale';

type P = Record<string, number>;

/** The font picked (by its place in FONTS). */
export const fontOf = (p: P): FontData => FONTS[Math.max(0, Math.min(FONTS.length - 1, Math.round(p.font ?? 0)))];

/** The weight of the picked font nearest the one asked for (the heaviest it has, by default). */
export function weightOf(p: P): FontWeight {
  const ws = fontOf(p).weights;
  const want = p.weight ?? 900;
  return ws.reduce((best, w) => (Math.abs(w.weight - want) < Math.abs(best.weight - want) || (Math.abs(w.weight - want) === Math.abs(best.weight - want) && w.weight > best.weight) ? w : best), ws[0]);
}

/** The text, kept in the settings as character codes (c0, c1, ... and textLen), since settings are numbers. */
export function textOf(p: P): string {
  if (p.textLen === undefined) return DEFAULT_TEXT;
  const n = Math.max(0, Math.min(MAX_TEXT, Math.round(p.textLen)));
  let s = '';
  for (let i = 0; i < n; i++) { const c = Math.round(p[`c${i}`] ?? 32); if (c > 0 && c < 0x10000) s += String.fromCharCode(c); }
  return s;
}

/** The settings that hold a text. */
export function textParams(text: string): P {
  const t = text.slice(0, MAX_TEXT);
  const out: P = { textLen: t.length };
  for (let i = 0; i < t.length; i++) out[`c${i}`] = t.charCodeAt(i);
  return out;
}

/** Text settings cleaned: the text kept (the default when there is none), nothing past its length. */
export function cleanTextParams(raw: P): P {
  return textParams(raw.textLen === undefined ? DEFAULT_TEXT : textOf(raw));
}

/** How a pixel font's letter height comes out: blocks per font pixel, and the capital height in pixels. */
export function pixelSteps(w: FontWeight, height: number): { unit: number; capPixels: number } {
  const capPixels = Math.max(1, Math.round((w.cap * w.grid) / w.upm));
  return { unit: Math.max(1, Math.round(height / capPixels)), capPixels };
}

interface Glyph { x0: number; x1: number; y0: number; y1: number; polys: Float64Array[] }
export interface TextLayout {
  /** Glyph outlines in blocks, the box's middle at 0 (v up: the top of the text toward +v). */
  glyphs: Glyph[];
  /** The box in blocks: width and height (even numbers). */
  width: number;
  height: number;
  /** Capital height as built, in blocks. */
  capBlocks: number;
}

const memo = new Map<string, TextLayout>();

/** The text laid out in blocks (memoised). */
export function layoutText(p: P): TextLayout {
  const text = textOf(p);
  const key = JSON.stringify([text, p.font, p.weight, p.size, p.spacing, p.lineSpacing, p.align]);
  const hit = memo.get(key);
  if (hit) return hit;
  const w = weightOf(p);
  const size = Math.max(2, Math.round(p.size ?? 10));
  const pixel = w.grid > 0;
  // Blocks per font unit.
  let scale: number, capBlocks: number;
  if (pixel) {
    const { unit, capPixels } = pixelSteps(w, size);
    scale = (unit * w.grid) / w.upm;
    capBlocks = unit * capPixels;
  } else {
    scale = size / w.cap;
    capBlocks = size;
  }
  // A pixel font moves in whole font pixels (whole blocks); others anywhere.
  const step = pixel ? w.upm / w.grid : 0;
  const snap = (units: number) => (step ? Math.round(units / step) * step : units);
  const spacing = Math.round(p.spacing ?? 0);
  const lineBlocks = Math.max(1, Math.round((w.ascent - w.descent + w.lineGap) * scale)) + Math.round(p.lineSpacing ?? 0);
  const align = Math.round(p.align ?? 1);
  const lines = text.split('\n');
  const glyphs: Glyph[] = [];
  const space = w.glyphs['32']?.[0] ?? w.upm / 3;
  // Each line's width (to the end of its last character, trailing spaces left out) and its gaps between words.
  const widths: number[] = [];
  const gaps: number[] = [];
  const placed: { line: number; x: number; g: Glyph2D; gap: number; k: number }[] = [];
  lines.forEach((line, li) => {
    // Whole characters (a symbol past U+FFFF is two code units).
    const chars = Array.from(line.replace(/\s+$/, ''));
    let x = 0, gap = 0;
    for (let k = 0; k < chars.length; k++) {
      const code = chars[k].codePointAt(0)!;
      // A run of spaces between words is one gap (spaces at the start of a line aren't).
      if (code === 32 && k > 0 && chars[k - 1] !== ' ' && chars.slice(0, k).some((c) => /\S/.test(c))) gap++;
      const found = glyphFor(w, code);
      // A symbol borrowed from a symbol font is drawn at the same em size as the letters, on the same baseline;
      // in a pixel font it moves the next letter on by whole blocks, so they stay on the pixel grid.
      const own = !found || found.from === w;
      const k2 = own ? scale : scale * (w.upm / found.from.upm);
      if (found && found.g[1].length) placed.push({ line: li, x, g: found.g, gap, k: k2 });
      const next = chars[k + 1]?.codePointAt(0);
      if (own) {
        const adv = found ? found.g[0] : space;
        const kern = next === undefined ? 0 : (w.kern[String(code)]?.[String(next)] ?? 0);
        x += snap(adv + kern) * scale;
      } else {
        const adv = found.g[0] * k2;
        x += pixel ? Math.max(1, Math.round(adv)) : adv;
      }
      if (k < chars.length - 1) x += spacing;
    }
    widths.push(x);
    gaps.push(gap);
  });
  const widest = Math.max(0, ...widths);
  const last = lines.length - 1;
  for (const { line, x, g, gap, k } of placed) {
    // Justified: every line but the last stretched to the widest, the extra shared between its word gaps (whole
    // blocks for a pixel font); a last line, or a line of one word, stays on the left.
    const extra = widest - widths[line];
    const shift = align === 3 ? (line < last && gaps[line] ? (pixel ? Math.round((extra * gap) / gaps[line]) : (extra * gap) / gaps[line]) : 0)
      : align === 0 ? 0 : align === 2 ? extra : extra / 2;
    const ox = pixel ? Math.round(x + shift) : x + shift;
    const oy = -line * lineBlocks;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const polys = g[1].map((poly) => {
      const out = new Float64Array(poly.length);
      for (let i = 0; i < poly.length; i += 2) {
        const bx = ox + poly[i] * k, by = oy + poly[i + 1] * k;
        out[i] = bx; out[i + 1] = by;
        x0 = Math.min(x0, bx); x1 = Math.max(x1, bx); y0 = Math.min(y0, by); y1 = Math.max(y1, by);
      }
      return out;
    });
    glyphs.push({ x0, x1, y0, y1, polys });
  }
  let layout: TextLayout;
  if (!glyphs.length) layout = { glyphs: [], width: 2, height: 2, capBlocks };
  else {
    // The box on whole blocks, an even number each way, and everything moved so its middle is at 0.
    let bx0 = Math.floor(Math.min(...glyphs.map((g) => g.x0)) + 1e-9), bx1 = Math.ceil(Math.max(...glyphs.map((g) => g.x1)) - 1e-9);
    let by0 = Math.floor(Math.min(...glyphs.map((g) => g.y0)) + 1e-9), by1 = Math.ceil(Math.max(...glyphs.map((g) => g.y1)) - 1e-9);
    if ((bx1 - bx0) % 2) bx1++;
    if ((by1 - by0) % 2) by0--;
    const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
    for (const g of glyphs) {
      g.x0 -= cx; g.x1 -= cx; g.y0 -= cy; g.y1 -= cy;
      for (const poly of g.polys) for (let i = 0; i < poly.length; i += 2) { poly[i] -= cx; poly[i + 1] -= cy; }
    }
    layout = { glyphs, width: Math.max(2, bx1 - bx0), height: Math.max(2, by1 - by0), capBlocks };
  }
  if (memo.size > 64) memo.clear();
  memo.set(key, layout);
  return layout;
}

/** Whether a point (in blocks, from the middle of the box, v up) is inside a letter: non-zero winding. */
export function insideText(layout: TextLayout, u: number, v: number): boolean {
  for (const g of layout.glyphs) {
    if (u < g.x0 || u > g.x1 || v < g.y0 || v > g.y1) continue;
    let wind = 0;
    for (const poly of g.polys) {
      const n = poly.length;
      for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
        const ya = poly[j + 1], yb = poly[i + 1];
        if (ya <= v) { if (yb > v && cross(poly[j], ya, poly[i], yb, u, v) > 0) wind++; }
        else if (yb <= v && cross(poly[j], ya, poly[i], yb, u, v) < 0) wind--;
      }
    }
    if (wind !== 0) return true;
  }
  return false;
}

const cross = (xa: number, ya: number, xb: number, yb: number, x: number, y: number) => (xb - xa) * (y - ya) - (x - xa) * (yb - ya);

/** The text's half sizes in meters, along its own u (across) and v (up). */
export function textHalf(p: P): [number, number] {
  const l = layoutText(p);
  return [(l.width / 2) * VOXEL_SIZE, (l.height / 2) * VOXEL_SIZE];
}
