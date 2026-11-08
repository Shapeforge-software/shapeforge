"""
Builds ShapeForge's built-in fonts (src/core/fonts/*.ts) from the font files in fonts/ (one folder per family, each
with its licence). Run from the shapeforge folder:  python3 tools/build-fonts.py

Each weight becomes letter outlines (quadratic curves flattened to polygons, in font units), advances, kerning
pairs, the font's measurements and, for pixel fonts, the size of its pixel grid. Only the characters people type
are kept: letters that stand on their own (Latin, Greek and Cyrillic in all their forms) and symbols (see RANGES).
"""
import json, math, os, re, sys
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import DecomposingRecordingPen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'fonts')
OUT = os.path.join(ROOT, 'src', 'core', 'fonts')

# Unicode blocks kept, where a font has them: letters that stand on their own (Latin, Greek, Cyrillic, in all their
# extended forms), and symbols. Left out: right-to-left and joined scripts (they need text shaping), combining marks
# (they sit on other letters), and invisible characters.
RANGES = [
    (0x0020, 0x007E), (0x00A0, 0x00FF),  # ASCII, Latin-1
    (0x0100, 0x024F), (0x0250, 0x02AF), (0x02B0, 0x02FF),  # Latin Extended A and B, IPA, spacing modifiers
    (0x0370, 0x03FF), (0x0400, 0x052F),  # Greek, Cyrillic and its supplement
    (0x1E00, 0x1EFF), (0x1F00, 0x1FFF),  # Latin Extended Additional, Greek Extended
    (0x2010, 0x2027), (0x2030, 0x205E),  # punctuation (dashes, quotes, bullets, per mille, ...)
    (0x2070, 0x209F), (0x20A0, 0x20CF),  # super- and subscripts, currency
    (0x2100, 0x214F), (0x2150, 0x218F), (0x2190, 0x21FF), (0x2200, 0x22FF), (0x2300, 0x23FF),  # letterlike, numbers, arrows, maths, technical
    (0x2460, 0x24FF), (0x2500, 0x257F), (0x2580, 0x259F), (0x25A0, 0x25FF),  # circled, box drawing, blocks, shapes
    (0x2600, 0x26FF), (0x2700, 0x27BF), (0x27C0, 0x27EF), (0x27F0, 0x27FF), (0x2900, 0x297F), (0x2B00, 0x2BFF),  # symbols, dingbats, arrows
    (0x2C60, 0x2C7F), (0xA640, 0xA69F), (0xA720, 0xA7FF), (0xAB30, 0xAB6F),  # more Latin and Cyrillic
    (0xFB00, 0xFB06),  # ligatures (ﬁ, ﬂ)
]
CHARS = [c for lo, hi in RANGES for c in range(lo, hi + 1)]
WEIGHT_NAMES = {'Thin': 100, 'ExtraLight': 200, 'Light': 300, 'Regular': 400, 'Medium': 500, 'SemiBold': 600, 'Bold': 700, 'ExtraBold': 800, 'Black': 900}

# Weights kept: Regular, Bold and Black where a family has them (a few clear steps, not every one). Tiny5's
# heavier weights are rounded, enlarged dots that no longer sit on its pixel grid, so only Regular is kept.
KEEP_WEIGHTS = {400, 700, 900}
# Outline precision: points dropped where the outline strays less than this much of the em from a straight line,
# and specks narrower than SPECK of the em left out. A block of 48-block-tall letters is about a 70th of the em, so
# these stay finer than any block. The spray-paint font's texture is far finer than that, so it gets coarser ones.
TOLERANCE = {'Rubik_Spray_Paint': 1 / 150}
SPECK = {'Rubik_Spray_Paint': 1 / 70}
ONLY = {'Tiny5': {400}}

# family folder, id, display name, group
FAMILIES = [
    ('Tiny5', 'tiny5', 'Tiny5', 'small'),
    ('Micro_5', 'micro5', 'Micro 5', 'small'),
    ('Silkscreen', 'silkscreen', 'Silkscreen', 'small'),
    ('Press_Start_2P', 'pressStart2p', 'Press Start 2P', 'small'),
    ('Bungee', 'bungee', 'Bungee', 'medium'),
    ('Black_Ops_One', 'blackOpsOne', 'Black Ops One', 'medium'),
    ('Anton', 'anton', 'Anton', 'medium'),
    ('Cinzel', 'cinzel', 'Cinzel', 'fantasy'),
    ('UnifrakturMaguntia', 'unifraktur', 'UnifrakturMaguntia', 'fantasy'),
    ('Pirata_One', 'pirataOne', 'Pirata One', 'fantasy'),
    ('Grenze_Gotisch', 'grenzeGotisch', 'Grenze Gotisch', 'fantasy'),
    ('New_Rocker', 'newRocker', 'New Rocker', 'fantasy'),
    ('Orbitron', 'orbitron', 'Orbitron', 'scifi'),
    ('Audiowide', 'audiowide', 'Audiowide', 'scifi'),
    ('Permanent_Marker', 'permanentMarker', 'Permanent Marker', 'graffiti'),
    ('Sedgwick_Ave_Display', 'sedgwickAve', 'Sedgwick Ave Display', 'graffiti'),
    ('Rubik_Spray_Paint', 'rubikSprayPaint', 'Rubik Spray Paint', 'graffiti'),
]


def weight_files(folder):
    """The family's upright static files by weight (variable and italic files left out)."""
    out = {}
    for base in [os.path.join(SRC, folder, 'static'), os.path.join(SRC, folder)]:
        if not os.path.isdir(base):
            continue
        for f in sorted(os.listdir(base)):
            if not f.lower().endswith('.ttf') or 'Variable' in f or 'Italic' in f:
                continue
            m = re.search(r'-([A-Za-z]+)\.ttf$', f)
            w = WEIGHT_NAMES.get(m.group(1)) if m else None
            if w and w not in out and w in ONLY.get(folder, KEEP_WEIGHTS):
                out[w] = os.path.join(base, f)
    return out


def simplify(poly, tol):
    """A closed polygon with points dropped where the outline strays from a straight line by less than `tol`."""
    if len(poly) < 8:
        return poly
    def dp(pts):
        if len(pts) < 3:
            return pts
        (x0, y0), (x1, y1) = pts[0], pts[-1]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy) or 1e-9
        best, at = -1, 0
        for i in range(1, len(pts) - 1):
            d = abs((pts[i][0] - x0) * dy - (pts[i][1] - y0) * dx) / L
            if d > best:
                best, at = d, i
        if best <= tol:
            return [pts[0], pts[-1]]
        return dp(pts[:at + 1])[:-1] + dp(pts[at:])
    # Split at the point farthest from the first, so both halves are open chains.
    far = max(range(len(poly)), key=lambda i: (poly[i][0] - poly[0][0]) ** 2 + (poly[i][1] - poly[0][1]) ** 2)
    a = dp(poly[:far + 1])
    b = dp(poly[far:] + [poly[0]])
    out = a[:-1] + b[:-1]
    return out if len(out) >= 3 else poly


def flatten(ops, tol):
    """Pen operations to closed polygons; each quadratic piece split finely enough that it strays under `tol`."""
    polys, cur = [], []
    def quad(p0, p1, p2):
        dev = math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]) / 4
        n = max(1, min(24, math.ceil(math.sqrt(dev / tol)))) if dev > 0 else 1
        for i in range(1, n + 1):
            t = i / n
            a, b, c = (1 - t) ** 2, 2 * (1 - t) * t, t * t
            cur.append((a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]))
    def cubic(p0, p1, p2, p3):
        n = 12
        for i in range(1, n + 1):
            t = i / n
            a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
            cur.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    for op, pts in ops:
        if op == 'moveTo':
            if len(cur) > 2: polys.append(cur)
            cur = [pts[0]]
        elif op == 'lineTo':
            cur.append(pts[0])
        elif op == 'qCurveTo':
            # TrueType: implied on-curve points between consecutive off-curve points.
            offs, end = list(pts[:-1]), pts[-1]
            if end is None:  # a contour of only off-curve points (no moveTo): it starts and ends between the last and first
                end = ((offs[0][0] + offs[-1][0]) / 2, (offs[0][1] + offs[-1][1]) / 2)
            if not cur:
                cur = [end]
            start = cur[-1]
            for k, c in enumerate(offs):
                nxt = end if k == len(offs) - 1 else ((c[0] + offs[k + 1][0]) / 2, (c[1] + offs[k + 1][1]) / 2)
                quad(start, c, nxt)
                start = nxt
        elif op == 'curveTo':
            cubic(cur[-1], *pts)
        elif op in ('closePath', 'endPath'):
            if len(cur) > 2: polys.append(cur)
            cur = []
    if len(cur) > 2: polys.append(cur)
    return polys


def kerning(font, names):
    """Pair kerning (GPOS pair adjustment and the old kern table) between the kept glyphs, as {left: {right: dx}}."""
    out = {}
    wanted = set(names.values())
    def add(a, b, v):
        if v and a in wanted and b in wanted:
            out.setdefault(a, {})[b] = out.get(a, {}).get(b, 0) + v
    if 'GPOS' in font:
        gpos = font['GPOS'].table
        feats = [fr.Feature for fr in gpos.FeatureList.FeatureRecord if fr.FeatureTag == 'kern'] if gpos.FeatureList else []
        lookups = sorted({i for f in feats for i in f.LookupListIndex})
        for li in lookups:
            lk = gpos.LookupList.Lookup[li]
            subs = lk.SubTable
            if lk.LookupType == 9:
                subs = [s.ExtSubTable for s in subs]
            for st in subs:
                if getattr(st, 'LookupType', 2) != 2 and lk.LookupType != 2 and lk.LookupType != 9:
                    continue
                if not hasattr(st, 'Format'):
                    continue
                cov = st.Coverage.glyphs
                if st.Format == 1:
                    for i, first in enumerate(cov):
                        for pvr in st.PairSet[i].PairValueRecord:
                            v = getattr(pvr.Value1, 'XAdvance', 0) if pvr.Value1 else 0
                            add(first, pvr.SecondGlyph, v)
                elif st.Format == 2:
                    c1 = st.ClassDef1.classDefs if st.ClassDef1 else {}
                    c2 = st.ClassDef2.classDefs if st.ClassDef2 else {}
                    for first in cov:
                        if first not in wanted: continue
                        rec = st.Class1Record[c1.get(first, 0)]
                        for second in wanted:
                            v = rec.Class2Record[c2.get(second, 0)].Value1
                            v = getattr(v, 'XAdvance', 0) if v else 0
                            if first not in out or second not in out[first]:
                                add(first, second, v)
    if 'kern' in font and not out:
        for t in font['kern'].kernTables:
            for (a, b), v in t.kernTable.items():
                add(a, b, v)
    return out


def pixel_grid(font, glyphset, names, upm):
    """A pixel font's grid (pixels to the em): the coarsest grid that nearly every point of its letters and digits
    sits on (a few points a hair off it, as in Silkscreen's inside corners, are snapped onto it)."""
    pts = []
    for ch in 'ABEHMWXZ0123456789abegmwxz':
        g = names.get(ord(ch))
        if not g: continue
        pen = DecomposingRecordingPen(glyphset)
        glyphset[g].draw(pen)
        for _, ps in pen.value:
            pts += [p for p in ps if p is not None]
    if not pts: return 0
    vals = [v for p in pts for v in p]
    for n in range(4, 41):
        px = upm / n
        near = sum(1 for v in vals if abs(v / px - round(v / px)) * px <= px * 0.06)
        if near >= 0.97 * len(vals):
            return n
    return 0


def outline(gs, g, upm, grid, tol, tol_em, speck_em):
    """A glyph as polygons of whole font units: curves flattened, simplified (or, in a pixel font, snapped to its
    grid), specks dropped."""
    pen = DecomposingRecordingPen(gs)
    gs[g].draw(pen)
    polys = flatten(pen.value, tol)
    if grid:  # pixel fonts: every corner exactly on the grid
        px = upm / grid
        polys = [[(round(round(x / px) * px), round(round(y / px) * px)) for x, y in poly] for poly in polys]
    else:
        polys = [simplify(poly, upm * tol_em) for poly in polys]
    # Drop repeated points (grid snapping leaves some), and specks far smaller than a block even in very
    # big text (a spray-paint font's dots): under a 120th of the em across.
    def dedupe(poly):
        out = [pt for k, pt in enumerate(poly) if pt != poly[k - 1]]
        return out if len(out) >= 3 else []
    def area(poly):
        return abs(sum(poly[k - 1][0] * pt[1] - pt[0] * poly[k - 1][1] for k, pt in enumerate(poly))) / 2
    polys = [q for q in (dedupe(poly) for poly in polys) if q and area(q) >= (upm * speck_em) ** 2]
    flat = [[int(round(v)) for pt in poly for v in pt] for poly in polys]
    return flat


def build(folder, fid, name, group):
    tol_em = TOLERANCE.get(folder, 1 / 300)
    speck_em = SPECK.get(folder, 1 / 120)
    files = weight_files(folder)
    if not files:
        sys.exit(f'No font files for {folder}')
    weights = []
    for w, path in sorted(files.items()):
        font = TTFont(path)
        upm = font['head'].unitsPerEm
        cmap = font.getBestCmap()
        names = {c: cmap[c] for c in CHARS if c in cmap}
        gs = font.getGlyphSet()
        hmtx = font['hmtx'].metrics
        os2 = font['OS/2'] if 'OS/2' in font else None
        hhea = font['hhea']
        grid = pixel_grid(font, gs, names, upm)
        tol = upm / 400
        glyphs = {}
        for c, g in names.items():
            glyphs[c] = [hmtx[g][0], outline(gs, g, upm, grid, tol, tol_em, speck_em)]
        # Cap height: the font's own, or the top of H.
        cap = getattr(os2, 'sCapHeight', 0) if os2 else 0
        if not cap and ord('H') in glyphs:
            ys = [v for poly in glyphs[ord('H')][1] for v in poly[1::2]]
            cap = max(ys) if ys else upm * 0.7
        kern = kerning(font, names)
        rev = {g: c for c, g in names.items()}
        kpairs = {}
        # Kerning between plain keyboard characters only (accented letters space by their advance).
        for a, row in kern.items():
            for b, v in row.items():
                if a in rev and b in rev and v and rev[a] < 127 and rev[b] < 127:
                    kpairs.setdefault(rev[a], {})[rev[b]] = v
        weights.append({
            'weight': w, 'upm': upm, 'cap': cap,
            'ascent': hhea.ascent, 'descent': hhea.descent, 'lineGap': hhea.lineGap,
            'grid': grid, 'glyphs': glyphs, 'kern': kpairs,
        })
    lic_name = 'OFL.txt' if os.path.exists(os.path.join(SRC, folder, 'OFL.txt')) else 'LICENSE.txt'
    licence = 'SIL Open Font License 1.1' if lic_name == 'OFL.txt' else 'Apache License 2.0'
    data = {'id': fid, 'name': name, 'group': group, 'licence': licence, 'weights': weights}
    body = json.dumps(data, separators=(',', ':'))
    with open(os.path.join(OUT, f'{fid}.ts'), 'w') as f:
        f.write(f'// {name}: built from fonts/{folder} by tools/build-fonts.py ({licence}, fonts/{folder}/{lic_name}). Do not edit.\n')
        f.write("import type { FontData } from '../text';\n")
        # A JSON string, parsed at load: much quicker for the engine than the same data written as code.
        f.write(f'const font: FontData = JSON.parse({json.dumps(body)});\nexport default font;\n')
    return fid, name, group, [w['weight'] for w in weights], [w['grid'] for w in weights], len(body)


# Symbol fonts: borrowed from, in this order, for any character the chosen letter font hasn't got (see text.ts).
# folder, file, id, display name. Heavier weights where a family has them (they hold up better as blocks).
SYMBOL_FAMILIES = [
    ('Noto_Sans_Symbols_2', 'NotoSansSymbols2-Regular.ttf', 'notoSymbols2', 'Noto Sans Symbols 2'),
    ('Noto_Sans_Symbols', 'NotoSansSymbols-Bold.ttf', 'notoSymbols', 'Noto Sans Symbols'),
    ('Noto_Sans_Math', 'NotoSansMath-Regular.ttf', 'notoMath', 'Noto Sans Math'),
    ('Noto_Music', 'NotoMusic-Regular.ttf', 'notoMusic', 'Noto Music'),
    ('Noto_Sans_Runic', 'NotoSansRunic-Regular.ttf', 'notoRunic', 'Noto Sans Runic'),
    ('Noto_Sans_Glagolitic', 'NotoSansGlagolitic-Regular.ttf', 'notoGlagolitic', 'Noto Sans Glagolitic'),
    ('Noto_Sans_Linear_B', 'NotoSansLinearB-Regular.ttf', 'notoLinearB', 'Noto Sans Linear B'),
    ('Noto_Sans_Egyptian_Hieroglyphs', 'NotoSansEgyptianHieroglyphs-Regular.ttf', 'notoEgyptian', 'Noto Sans Egyptian Hieroglyphs'),
    ('Noto_Sans_Anatolian_Hieroglyphs', 'NotoSansAnatolianHieroglyphs-Regular.ttf', 'notoAnatolian', 'Noto Sans Anatolian Hieroglyphs'),
    ('Noto_Emoji', 'NotoEmoji-Bold.ttf', 'notoEmoji', 'Noto Emoji'),
]
SYMBOL_OUT = os.path.join(ROOT, 'src', 'core', 'symbolfonts')
# Not kept from symbol fonts: plain ASCII, combining marks, invisible and format characters, variation selectors,
# private use, tags, skin-tone modifiers.
SKIP = [(0x0000, 0x009F), (0x0300, 0x036F), (0x1AB0, 0x1AFF), (0x1DC0, 0x1DFF), (0x200B, 0x200F), (0x2028, 0x202F),
        (0x2060, 0x206F), (0x20D0, 0x20FF), (0xFE00, 0xFE0F), (0xFE20, 0xFE2F), (0xE000, 0xF8FF), (0x13430, 0x1345F),
        (0x1F3FB, 0x1F3FF), (0xE0000, 0xE0FFF), (0xF0000, 0x10FFFF)]


def build_symbol(folder, file, fid, name):
    path = os.path.join(SRC, folder, file)
    font = TTFont(path)
    upm = font['head'].unitsPerEm
    cmap = font.getBestCmap()
    names = {c: g for c, g in cmap.items() if not any(lo <= c <= hi for lo, hi in SKIP)}
    gs = font.getGlyphSet()
    hmtx = font['hmtx'].metrics
    os2 = font['OS/2'] if 'OS/2' in font else None
    hhea = font['hhea']
    glyphs = {}
    for c, g in names.items():
        polys = outline(gs, g, upm, 0, upm / 400, 1 / 250, 1 / 120)
        if polys:
            glyphs[c] = [hmtx[g][0], polys]
    cap = getattr(os2, 'sCapHeight', 0) if os2 else 0
    weight = {'weight': 400, 'upm': upm, 'cap': cap or round(upm * 0.714), 'ascent': hhea.ascent, 'descent': hhea.descent,
              'lineGap': hhea.lineGap, 'grid': 0, 'glyphs': glyphs, 'kern': {}}
    data = {'id': fid, 'name': name, 'licence': 'SIL Open Font License 1.1', 'weight': weight}
    body = json.dumps(data, separators=(',', ':'))
    with open(os.path.join(SYMBOL_OUT, f'{fid}.ts'), 'w') as f:
        f.write(f'// {name}: built from fonts/{folder}/{file} by tools/build-fonts.py (SIL Open Font License 1.1, fonts/{folder}/OFL.txt). Do not edit.\n')
        f.write("import type { SymbolFont } from '../text';\n")
        f.write(f'const font: SymbolFont = JSON.parse({json.dumps(body)});\nexport default font;\n')
    return fid, name, len(glyphs), len(body)


def main():
    os.makedirs(OUT, exist_ok=True)
    built = [build(*f) for f in FAMILIES]
    with open(os.path.join(OUT, 'index.ts'), 'w') as f:
        f.write('// The built-in fonts, in menu order: built by tools/build-fonts.py. Do not edit.\n')
        f.write("import type { FontData } from '../text';\n")
        for fid, *_ in built:
            f.write(f"import {fid} from './{fid}';\n")
        f.write('export const FONTS: FontData[] = [' + ', '.join(b[0] for b in built) + '];\n')
    for fid, name, group, ws, grids, size in built:
        print(f'{name:22s} {group:8s} weights {ws} grid {grids} {size / 1024:.0f} KB')
    os.makedirs(SYMBOL_OUT, exist_ok=True)
    symbols = [build_symbol(*f) for f in SYMBOL_FAMILIES]
    with open(os.path.join(SYMBOL_OUT, 'index.ts'), 'w') as f:
        f.write('// The symbol fonts, in the order they are borrowed from: built by tools/build-fonts.py. Do not edit.\n')
        f.write("import type { SymbolFont } from '../text';\n")
        for fid, *_ in symbols:
            f.write(f"import {fid} from './{fid}';\n")
        f.write('export const SYMBOL_FONTS: SymbolFont[] = [' + ', '.join(b[0] for b in symbols) + '];\n')
    for fid, name, count, size in symbols:
        print(f'{name:32s} {count:5d} symbols {size / 1024:.0f} KB')


if __name__ == '__main__':
    main()
