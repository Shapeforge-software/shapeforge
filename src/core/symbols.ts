import { glyphFor, type FontWeight } from './text';

/**
 * The Text shape's symbol picker: everything beyond plain letters and digits that a text in a given font can show,
 * from the font itself or borrowed from the symbol fonts (see glyphFor in text.ts), in groups people know them by,
 * under a few headings. A group shows only when something in it can be built.
 */
export interface SymbolGroup { name: string; heading: string; ranges: [number, number][] }

export const SYMBOL_GROUPS: SymbolGroup[] = [
  { heading: 'Letters', name: 'Accented letters', ranges: [[0x00c0, 0x00ff], [0x0100, 0x024f], [0x1e00, 0x1eff], [0x2c60, 0x2c7f], [0xa720, 0xa7ff], [0xab30, 0xab6f], [0x0250, 0x02af]] },
  { heading: 'Letters', name: 'Greek', ranges: [[0x0370, 0x03ff], [0x1f00, 0x1fff]] },
  { heading: 'Letters', name: 'Cyrillic', ranges: [[0x0400, 0x052f], [0xa640, 0xa69f]] },
  { heading: 'Letters', name: 'Runes', ranges: [[0x16a0, 0x16ff]] },
  { heading: 'Letters', name: 'Glagolitic', ranges: [[0x2c00, 0x2c5f], [0x1e000, 0x1e02f]] },
  { heading: 'Letters', name: 'Fancy letters (maths)', ranges: [[0x1d400, 0x1d7ff]] },
  { heading: 'Signs', name: 'Punctuation', ranges: [[0x00a1, 0x00bf], [0x02b0, 0x02ff], [0x2010, 0x205e], [0xfb00, 0xfb06]] },
  { heading: 'Signs', name: 'Numbers and money', ranges: [[0x2070, 0x209f], [0x20a0, 0x20cf], [0x2150, 0x218f]] },
  { heading: 'Signs', name: 'Circled and boxed', ranges: [[0x2460, 0x24ff], [0x2776, 0x2793], [0x1f100, 0x1f1ff]] },
  { heading: 'Signs', name: 'Letterlike', ranges: [[0x2100, 0x214f]] },
  { heading: 'Signs', name: 'Arrows', ranges: [[0x2190, 0x21ff], [0x27f0, 0x27ff], [0x2900, 0x297f], [0x2b00, 0x2b4f], [0x1f800, 0x1f8ff]] },
  { heading: 'Signs', name: 'Maths', ranges: [[0x2200, 0x22ff], [0x27c0, 0x27ef], [0x2980, 0x29ff], [0x2a00, 0x2aff]] },
  { heading: 'Signs', name: 'Technical', ranges: [[0x2300, 0x23ff]] },
  { heading: 'Signs', name: 'Lines and blocks', ranges: [[0x2500, 0x259f], [0x1fb00, 0x1fbff]] },
  { heading: 'Signs', name: 'Shapes', ranges: [[0x25a0, 0x25ff], [0x2b50, 0x2bff], [0x1f780, 0x1f7ff]] },
  { heading: 'Signs', name: 'Braille', ranges: [[0x2800, 0x28ff]] },
  { heading: 'Symbols', name: 'Symbols', ranges: [[0x2600, 0x26ff]] },
  { heading: 'Symbols', name: 'Dingbats and ornaments', ranges: [[0x2700, 0x2775], [0x2794, 0x27bf], [0x1f650, 0x1f67f]] },
  { heading: 'Symbols', name: 'Chess', ranges: [[0x2654, 0x265f], [0x1fa00, 0x1fa6f]] },
  { heading: 'Symbols', name: 'Playing cards', ranges: [[0x2660, 0x2667], [0x1f0a0, 0x1f0ff]] },
  { heading: 'Symbols', name: 'Dominoes', ranges: [[0x1f030, 0x1f09f]] },
  { heading: 'Symbols', name: 'Mahjong', ranges: [[0x1f000, 0x1f02f]] },
  { heading: 'Symbols', name: 'Alchemy', ranges: [[0x1f700, 0x1f77f]] },
  { heading: 'Symbols', name: 'Music', ranges: [[0x2669, 0x266f], [0x1d100, 0x1d1ff], [0x1d000, 0x1d0ff]] },
  { heading: 'Pictures', name: 'Nature and things', ranges: [[0x1f300, 0x1f5ff]] },
  { heading: 'Pictures', name: 'Faces and people', ranges: [[0x1f600, 0x1f64f]] },
  { heading: 'Pictures', name: 'Travel and places', ranges: [[0x1f680, 0x1f6ff]] },
  { heading: 'Pictures', name: 'More pictures', ranges: [[0x1f900, 0x1f9ff], [0x1fa70, 0x1faff]] },
  { heading: 'Ancient', name: 'Egyptian hieroglyphs', ranges: [[0x13000, 0x1342f]] },
  { heading: 'Ancient', name: 'Anatolian hieroglyphs', ranges: [[0x14400, 0x1467f]] },
  { heading: 'Ancient', name: 'Linear B', ranges: [[0x10000, 0x100ff], [0x10100, 0x1013f]] },
  { heading: 'Ancient', name: 'Ancient signs', ranges: [[0x10190, 0x101cf], [0x101d0, 0x101ff]] },
];

export interface PickerSymbol {
  ch: string;
  /** The measurements of the font it's drawn from. */
  from: FontWeight;
  /** The symbol font it's borrowed from, if not the letter font. */
  font?: string;
}

/** The groups with something buildable in this font (its own, or borrowed), each with its symbols in code order. */
export function symbolsIn(weight: FontWeight): { name: string; heading: string; symbols: PickerSymbol[] }[] {
  const out: { name: string; heading: string; symbols: PickerSymbol[] }[] = [];
  for (const g of SYMBOL_GROUPS) {
    const symbols: PickerSymbol[] = [];
    for (const [lo, hi] of g.ranges) {
      for (let c = lo; c <= hi; c++) {
        const found = glyphFor(weight, c);
        if (found?.g[1].length) symbols.push({ ch: String.fromCodePoint(c), from: found.from, font: found.font?.name });
      }
    }
    if (symbols.length) out.push({ name: g.name, heading: g.heading, symbols });
  }
  return out;
}
