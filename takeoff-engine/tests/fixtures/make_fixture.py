"""Generate a tiny synthetic plan PDF used by the end-to-end tests.

Drawn with PyMuPDF so it carries NATIVE text (with exact coordinates) and
NATIVE vector paths — exercising the real ingestion path. Layout, at
1/8" = 1'-0" (ft_per_pt = 8/72):

  - a 40' × 30' slab outline (40 ft → 360 pt, 30 ft → 270 pt)
  - a 20' × 15' room inside it labelled "OFFICE 101"
  - a scale note, a slab-thickness callout, and a title block
"""

from __future__ import annotations

from pathlib import Path

import fitz

PAGE_W, PAGE_H = 792, 612  # landscape letter, points
FT_PER_PT = 8 / 72.0       # 1/8" = 1'-0"
PT_PER_FT = 1 / FT_PER_PT  # 9 pt per ft

SLAB_ORIGIN = (72, 72)     # 1" margin
SLAB_FT = (40, 30)
ROOM_ORIGIN_FT = (5, 5)    # offset within the slab
ROOM_FT = (20, 15)


def slab_rect_pt() -> fitz.Rect:
    x0, y0 = SLAB_ORIGIN
    return fitz.Rect(x0, y0, x0 + SLAB_FT[0] * PT_PER_FT, y0 + SLAB_FT[1] * PT_PER_FT)


def room_rect_pt() -> fitz.Rect:
    x0 = SLAB_ORIGIN[0] + ROOM_ORIGIN_FT[0] * PT_PER_FT
    y0 = SLAB_ORIGIN[1] + ROOM_ORIGIN_FT[1] * PT_PER_FT
    return fitz.Rect(x0, y0, x0 + ROOM_FT[0] * PT_PER_FT, y0 + ROOM_FT[1] * PT_PER_FT)


def make_fixture(out_path: Path) -> Path:
    doc = fitz.open()
    page = doc.new_page(width=PAGE_W, height=PAGE_H)

    slab = slab_rect_pt()
    room = room_rect_pt()
    page.draw_rect(slab, color=(0, 0, 0), width=2.0)
    page.draw_rect(room, color=(0, 0, 0), width=1.2)

    page.insert_text(fitz.Point(room.x0 + 20, room.y0 + 40), "OFFICE", fontsize=10)
    page.insert_text(fitz.Point(room.x0 + 20, room.y0 + 54), "101", fontsize=10)
    page.insert_text(fitz.Point(72, 560), 'SCALE: 1/8" = 1\'-0"', fontsize=10)
    page.insert_text(fitz.Point(300, 560), '4" CONC. SLAB', fontsize=10)
    page.insert_text(fitz.Point(72, 40), "FOUNDATION PLAN", fontsize=14)
    # title block, bottom-right
    page.draw_rect(fitz.Rect(660, 520, 780, 600), color=(0, 0, 0), width=1.0)
    page.insert_text(fitz.Point(668, 585), "S-101", fontsize=12)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(out_path)
    doc.close()
    return out_path


if __name__ == "__main__":
    import sys

    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("fixture_plan.pdf")
    print(make_fixture(out))
