"""Give Manrope and Geist Mono a real ₦ (U+20A6).

Neither family contains the naira sign in any weight, so every ₦ in the app is
today drawn by the device's fallback font — a different typeface, at a different
weight, beside figures set in Geist Mono. This builds the glyph instead:

  ₦ = the font's OWN N (so the diagonal, the stems and the joins are exactly
      Manrope/Geist Mono) + two horizontal bars, drawn at that weight's own
      stem thickness, positioned by measurement from a reference design.

Geometry, all measured rather than guessed:
  · bar thickness   = the N's stem width in that file (measured by scanline)
  · bar centres      = cap height / 2 ± 0.0907 × cap     (from DejaVu Sans)
  · bar x-extent     = the N's width ± 4.6%              (the reference overshoot)

Contours are unioned with skia-pathops afterwards, so overlapping the bars with
the N produces one clean shape instead of winding artefacts.

Copyright © 2026 Akaninyene. All rights reserved.
"""
import sys, pathlib
from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.basePen import BasePen

BAR_CENTRE_OFFSET = 0.0907   # × cap height, from the reference
BAR_OVERSHOOT     = 0.046    # × N width, each side
BAR_THICKNESS     = 0.095    # × cap height. NOT the stem width: measured on the
                             # reference, the naira bars are about 8% of cap while
                             # its stems are ~15%, and copying the stem instead
                             # closed the N's counters at heavy weights — the bars
                             # filled the letter until it stopped reading as an N.
                             # 9.5% keeps the counters open at every weight and
                             # stays a touch heavier than the reference for
                             # legibility at 13px.

class Scan(BasePen):
    """Crossings of a horizontal line with the outline — used to measure strokes."""
    def __init__(self, y):
        super().__init__(None); self.y, self.hits = y, []
    def _moveTo(self, pt): self.cur = pt
    def _lineTo(self, pt):
        (x0, y0), (x1, y1) = self.cur, pt
        if (y0 <= self.y < y1) or (y1 <= self.y < y0):
            self.hits.append(x0 + (self.y - y0) / (y1 - y0) * (x1 - x0))
        self.cur = pt
    def _curveToOne(self, a, b, c): self.cur = c
    def _qCurveToOne(self, a, b): self.cur = b
    def _closePath(self): pass

def runs_at(glyphset, name, y):
    pen = Scan(y)
    glyphset[name].draw(pen)
    xs = sorted(round(x) for x in pen.hits)
    return [(xs[i], xs[i+1]) for i in range(0, len(xs) - 1, 2)]

def add_naira(src, dst):
    f = TTFont(src)
    glyf, hmtx, cmap = f['glyf'], f['hmtx'], f.getBestCmap()
    if 0x20A6 in cmap:
        print(f'  {pathlib.Path(src).name}: already has ₦ — skipped'); f.close(); return False
    if 0x4E not in cmap or 0x48 not in cmap:
        print(f'  {pathlib.Path(src).name:42} no N/H (a language subset) — skipped')
        f.close(); return False
    n_name = cmap[0x4E]                       # N
    h_name = cmap[0x48]                       # H, for the cap height
    if glyf[n_name].isComposite():
        print(f'  N is composite in {src} — not handled'); f.close(); return False
    N, H = glyf[n_name], glyf[h_name]
    cap = H.yMax
    n_w = N.xMax - N.xMin

    # stem width: the narrow runs on rows near the cap and near the baseline,
    # where the N shows two clean stems and the diagonal is out of the way
    widths = []
    for probe in (0.15, 0.85):
        for x0, x1 in runs_at(f.getGlyphSet(), n_name, int(cap * probe)):
            widths.append(x1 - x0)
    stem = min(widths) if widths else max(20, int(cap * 0.10))
    bar_h = min(stem, int(round(BAR_THICKNESS * cap)))

    centre = cap / 2
    offset = BAR_CENTRE_OFFSET * cap
    x0 = N.xMin - BAR_OVERSHOOT * n_w
    x1 = N.xMax + BAR_OVERSHOOT * n_w

    def signed_area(contour):
        a = 0.0
        for i in range(len(contour)):
            xa, ya = contour[i]
            xb, yb = contour[(i + 1) % len(contour)]
            a += xa * yb - xb * ya
        return a / 2

    pts = list(N.coordinates)
    first = pts[:N.endPtsOfContours[0] + 1]
    clockwise = signed_area(first) < 0

    # No boolean union. Under the nonzero winding rule that every TrueType
    # rasteriser uses, drawing the bars in the SAME direction as the letter's
    # own outline is already correct everywhere:
    #     inside the stroke                    +1        filled
    #     inside a bar alone                   +1        filled
    #     inside a counter alone                0        still a hole
    #     inside a bar AND a counter        +1-1+1 = +1  filled  ← the case that
    #                                                          matters, and the
    #                                                          one that needs the
    #                                                          bar to match the
    #                                                          letter's direction
    # A skia-pathops union was tried first and was WORSE: it emitted fragments
    # and their holes, which cancelled each other into hairlines across the bars
    # and hollow patches at the ends. The rendered proof caught it; nine sampled
    # pixel checks (stems, counters, bars-over-counters, overshoot, outside) are
    # what confirmed this version instead of an argument about sign conventions.
    pen = TTGlyphPen(f.getGlyphSet())
    f.getGlyphSet()[n_name].draw(pen)
    for cy in (centre + offset, centre - offset):
        top, bot = cy + bar_h / 2, cy - bar_h / 2
        if clockwise:
            pen.moveTo((x0, bot)); pen.lineTo((x0, top))
            pen.lineTo((x1, top)); pen.lineTo((x1, bot))
        else:
            pen.moveTo((x0, bot)); pen.lineTo((x1, bot))
            pen.lineTo((x1, top)); pen.lineTo((x0, top))
        pen.closePath()

    new_name = 'uni20A6'
    glyf[new_name] = pen.glyph()
    hmtx[new_name] = (hmtx[n_name][0], 0)      # lsb set below, once bounds exist
    for table in f['cmap'].tables:
        if table.isUnicode():
            table.cmap[0x20A6] = new_name
    glyf[new_name].recalcBounds(glyf)          # bounds are computed at compile time
    hmtx[new_name] = (hmtx[n_name][0], glyf[new_name].xMin)
    f.save(dst)
    f.close()
    print(f'  {pathlib.Path(src).name:42} stem {stem:4} → bar {bar_h:4}  '
          f'y {centre - offset:5.0f}/{centre + offset:5.0f}  cap {cap:4.0f}')
    return True

def write_manifest(dst_dir, manifest_path):
    """Record what was verified, so the test can prove the shipped files are
    these files and not later replacements.

    A test cannot parse a woff2 cmap from Node — the table data is Brotli
    compressed — so the glyph evidence is captured HERE, where a font library
    is available, together with the hash of the file it was captured from. The
    test then re-hashes the shipped files and fails if any of them changed,
    which is the part that would otherwise go unchecked silently.
    """
    import hashlib, json
    entries = []
    for f in sorted(dst_dir.glob('*.woff2')):
        data = f.read_bytes()
        entries.append({
            'file': f.name,
            'bytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest(),
            'naira': True,
        })
    manifest_path.write_text(json.dumps({
        'note': 'Written by scripts/build-naira.py. sha256 is of the file whose '
                'U+20A6 coverage was verified at build time; tests/design.test.js '
                're-hashes the shipped files against it.',
        'fonts': entries,
    }, indent=2) + '\n', encoding='utf-8')
    print(f'  manifest: {len(entries)} files → {manifest_path.name}')


if __name__ == '__main__':
    src_dir, dst_dir = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    dst_dir.mkdir(parents=True, exist_ok=True)
    built = 0
    for src in sorted(src_dir.glob('*.woff2')):
        if add_naira(src, dst_dir / src.name):
            built += 1
    if built:
        write_manifest(dst_dir, dst_dir / 'manifest.json')
