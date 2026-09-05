import { Vec2 } from "../geometry/vec";
import { Panel } from "./flattenFace";
import { offsetPolygon, boundingBox } from "./seamAllowance";

export interface PaperSize {
  id: string;
  label: string;
  widthMm: number;
  heightMm: number;
}

export const PAPERS: PaperSize[] = [
  { id: "a4", label: "A4 (210×297 mm)", widthMm: 210, heightMm: 297 },
  { id: "letter", label: "Carta (216×279 mm)", widthMm: 215.9, heightMm: 279.4 },
];

export interface LayoutConfig {
  paper: PaperSize;
  marginMm: number; // printable margin on every side
  gapMm: number; // gap between panels
  seamMm: number; // seam allowance added around each panel
}

export interface PlacedPanel {
  panel: Panel;
  stitch: Vec2[]; // stitch line (true panel) in sheet coordinates, mm
  cut: Vec2[]; // cut line (stitch + seam) in sheet coordinates, mm
  // Translation applied to the panel's local points to reach sheet coords.
  dx: number;
  dy: number;
}

export interface Layout {
  placements: PlacedPanel[];
  sheetWidthMm: number; // = paper width
  sheetHeightMm: number; // total stacked height across all pages
  paper: PaperSize;
  pageCount: number;
}

interface Item {
  panel: Panel;
  stitchLocal: Vec2[];
  cutLocal: Vec2[];
  w: number;
  h: number;
  minX: number;
  minY: number;
}

interface Shelf {
  items: Item[];
  height: number;
}

const translate = (pts: Vec2[], dx: number, dy: number): Vec2[] =>
  pts.map((p) => [p[0] + dx, p[1] + dy]);

// Shelf-pack panels (with seam allowance) into the printable width, then
// paginate downward so that no shelf straddles a page break.
export function layoutPanels(panels: Panel[], cfg: LayoutConfig): Layout {
  const contentW = cfg.paper.widthMm - 2 * cfg.marginMm;
  const contentH = cfg.paper.heightMm - 2 * cfg.marginMm;

  // Build items with seam-expanded outlines.
  const items: Item[] = panels.map((panel) => {
    const cutLocal = offsetPolygon(panel.points, cfg.seamMm);
    const bb = boundingBox(cutLocal);
    return {
      panel,
      stitchLocal: panel.points,
      cutLocal,
      w: bb.maxX - bb.minX,
      h: bb.maxY - bb.minY,
      minX: bb.minX,
      minY: bb.minY,
    };
  });

  // Flow into shelves of width contentW.
  const shelves: Shelf[] = [];
  let shelf: Shelf = { items: [], height: 0 };
  let x = 0;
  for (const it of items) {
    if (shelf.items.length > 0 && x + it.w > contentW) {
      shelves.push(shelf);
      shelf = { items: [], height: 0 };
      x = 0;
    }
    shelf.items.push(it);
    x += it.w + cfg.gapMm;
    shelf.height = Math.max(shelf.height, it.h);
  }
  if (shelf.items.length > 0) shelves.push(shelf);

  // Paginate: place each shelf, pushing to the next page if it would straddle a
  // page boundary.
  const placements: PlacedPanel[] = [];
  let page = 0;
  let yInPage = 0;
  for (const sh of shelves) {
    if (yInPage > 0 && yInPage + sh.height > contentH) {
      page += 1;
      yInPage = 0;
    }
    const absY = page * cfg.paper.heightMm + cfg.marginMm + yInPage;
    let cx = cfg.marginMm;
    for (const it of sh.items) {
      const dx = cx - it.minX;
      const dy = absY - it.minY;
      placements.push({
        panel: it.panel,
        stitch: translate(it.stitchLocal, dx, dy),
        cut: translate(it.cutLocal, dx, dy),
        dx,
        dy,
      });
      cx += it.w + cfg.gapMm;
    }
    yInPage += sh.height + cfg.gapMm;
  }

  const pageCount = page + 1;
  return {
    placements,
    sheetWidthMm: cfg.paper.widthMm,
    sheetHeightMm: pageCount * cfg.paper.heightMm,
    paper: cfg.paper,
    pageCount,
  };
}
