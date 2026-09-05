import { Vec2 } from "../geometry/vec";
import { Layout, PlacedPanel } from "../unfold/layout";

export interface ExportMeta {
  patternLabel: string;
  circumferenceMm: number;
  calibration: number;
  seamMm: number;
  panelCount: number;
  planarityWarning?: string; // optional note when faces were non-planar
}

const f = (n: number) => n.toFixed(2);
const ptsStr = (pts: Vec2[]) => pts.map((p) => `${f(p[0])},${f(p[1])}`).join(" ");

const centroidOf = (pts: Vec2[]): Vec2 => [
  pts.reduce((s, p) => s + p[0], 0) / pts.length,
  pts.reduce((s, p) => s + p[1], 0) / pts.length,
];

// Render one panel as SVG, with coordinates already shifted into page-local space.
function renderPanel(pl: PlacedPanel, oy: number): string {
  const shift = (pts: Vec2[]): Vec2[] => pts.map((p) => [p[0], p[1] - oy]);
  const cut = shift(pl.cut);
  const stitch = shift(pl.stitch);
  const c = centroidOf(stitch);

  const parts: string[] = [];
  // Cut line (solid) and stitch line (dashed).
  parts.push(`<polygon points="${ptsStr(cut)}" fill="#fafafa" stroke="#111" stroke-width="0.3"/>`);
  parts.push(`<polygon points="${ptsStr(stitch)}" fill="none" stroke="#0a84ff" stroke-width="0.25" stroke-dasharray="2.5,1.5"/>`);

  // Panel id + kind at centroid.
  parts.push(
    `<text x="${f(c[0])}" y="${f(c[1] - 1)}" font-size="6" text-anchor="middle" font-weight="700" fill="#111">#${pl.panel.index}</text>`,
  );
  parts.push(
    `<text x="${f(c[0])}" y="${f(c[1] + 5)}" font-size="3" text-anchor="middle" fill="#555">${pl.panel.kindLabel}</text>`,
  );

  // Edge-match labels: the same number appears on the matching edge of the
  // neighbouring panel, so you know which seams sew together.
  for (const e of pl.panel.edges) {
    const a: Vec2 = [e.a[0] + pl.dx, e.a[1] + pl.dy - oy];
    const b: Vec2 = [e.b[0] + pl.dx, e.b[1] + pl.dy - oy];
    const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    // Nudge the label toward the panel centre so it sits inside the edge.
    const toC: Vec2 = [c[0] - mid[0], c[1] - mid[1]];
    const l = Math.hypot(toC[0], toC[1]) || 1;
    const lx = mid[0] + (toC[0] / l) * 4;
    const ly = mid[1] + (toC[1] / l) * 4;
    parts.push(
      `<text x="${f(lx)}" y="${f(ly + 1)}" font-size="2.6" text-anchor="middle" fill="#0a84ff">${e.matchId}·${f(e.lengthMm)}</text>`,
    );
  }
  return parts.join("\n");
}

// Corner crop marks for reassembling tiled pages.
function cropMarks(w: number, h: number, m: number): string {
  const L = 6;
  const mark = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="#999" stroke-width="0.2"/>`;
  return [
    mark(m, m, m + L, m),
    mark(m, m, m, m + L),
    mark(w - m, m, w - m - L, m),
    mark(w - m, m, w - m, m + L),
    mark(m, h - m, m + L, h - m),
    mark(m, h - m, m, h - m - L),
    mark(w - m, h - m, w - m - L, h - m),
    mark(w - m, h - m, w - m, h - m - L),
  ].join("\n");
}

function svgOpen(w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">`;
}

// Page 0: cover with parameters and a real-size calibration square + ruler.
function coverPage(layout: Layout, meta: ExportMeta): string {
  const { widthMm: W, heightMm: H } = layout.paper;
  const m = 14;
  const cal = 40; // calibration square side in mm
  const lines: string[] = [];
  lines.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`);
  lines.push(cropMarks(W, H, m));
  lines.push(`<text x="${m}" y="${m + 8}" font-size="7" font-weight="700" fill="#111">Ball Panel Studio — patrón de paneles</text>`);
  const info = [
    `Patrón: ${meta.patternLabel}`,
    `Paneles: ${meta.panelCount}`,
    `Circunferencia: ${meta.circumferenceMm} mm   ·   Calibración: ${meta.calibration}`,
    `Margen de costura: ${meta.seamMm} mm`,
  ];
  info.forEach((t, i) =>
    lines.push(`<text x="${m}" y="${m + 18 + i * 6}" font-size="3.6" fill="#333">${escapeXml(t)}</text>`),
  );

  // Calibration block.
  const cy = m + 56;
  lines.push(`<text x="${m}" y="${cy - 2}" font-size="4" font-weight="700" fill="#c00">VERIFICÁ LA ESCALA antes de cortar:</text>`);
  lines.push(`<rect x="${m}" y="${cy + 2}" width="${cal}" height="${cal}" fill="none" stroke="#111" stroke-width="0.3"/>`);
  lines.push(`<text x="${m + cal / 2}" y="${cy + 2 + cal / 2 + 1.5}" font-size="3.5" text-anchor="middle" fill="#111">${cal} mm</text>`);
  // 100 mm ruler with 10 mm ticks.
  const ry = cy + cal + 14;
  lines.push(`<line x1="${m}" y1="${ry}" x2="${m + 100}" y2="${ry}" stroke="#111" stroke-width="0.3"/>`);
  for (let i = 0; i <= 10; i++) {
    const x = m + i * 10;
    lines.push(`<line x1="${x}" y1="${ry}" x2="${x}" y2="${ry - (i % 5 === 0 ? 4 : 2.5)}" stroke="#111" stroke-width="0.3"/>`);
  }
  lines.push(`<text x="${m}" y="${ry + 6}" font-size="3.2" fill="#333">Esta línea debe medir 100 mm y el cuadro 40 mm. Imprimí al 100% (sin "ajustar a página").</text>`);

  if (meta.planarityWarning) {
    lines.push(`<text x="${m}" y="${ry + 16}" font-size="3.2" fill="#a60">${escapeXml(meta.planarityWarning)}</text>`);
  }
  lines.push(`<text x="${m}" y="${H - m}" font-size="3" fill="#888">La línea azul punteada es la costura; el borde negro incluye el margen. Los números en cada borde indican qué costuras se unen (mismo número) y su largo en mm.</text>`);

  return `<div class="page">${svgOpen(W, H)}\n${lines.join("\n")}\n</svg></div>`;
}

function panelPage(layout: Layout, pageIndex: number): string {
  const { widthMm: W, heightMm: H } = layout.paper;
  const m = 10;
  const oy = pageIndex * H; // this page's vertical offset into the stacked sheet
  const onPage = layout.placements.filter((pl) => {
    const minY = Math.min(...pl.cut.map((p) => p[1]));
    return Math.floor(minY / H) === pageIndex;
  });
  const body = onPage.map((pl) => renderPanel(pl, oy)).join("\n");
  const header = `<text x="${m}" y="${m - 2}" font-size="3" fill="#aaa">Página de paneles ${pageIndex + 1} / ${layout.pageCount}</text>`;
  return `<div class="page">${svgOpen(W, H)}\n<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>\n${cropMarks(W, H, m)}\n${header}\n${body}\n</svg></div>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
}

// Full printable HTML document: cover page + one page per panel sheet.
export function buildPrintHtml(layout: Layout, meta: ExportMeta): string {
  const pages = [coverPage(layout, meta)];
  for (let i = 0; i < layout.pageCount; i++) pages.push(panelPage(layout, i));
  const { widthMm: W, heightMm: H } = layout.paper;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Patrón — ${escapeXml(meta.patternLabel)}</title>
<style>
  @page { size: ${W}mm ${H}mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #ddd; }
  .page { width: ${W}mm; height: ${H}mm; background: #fff; page-break-after: always; overflow: hidden; }
  .page:last-child { page-break-after: auto; }
  @media screen { body { padding: 16px; } .page { margin: 0 auto 16px; box-shadow: 0 1px 8px rgba(0,0,0,.25); } }
</style></head><body>${pages.join("")}</body></html>`;
}

// Single stacked SVG (all pages in one tall canvas) for a plain .svg download.
// Placements are already in absolute stacked coordinates, so render with oy=0.
export function buildStackedSvg(layout: Layout, meta: ExportMeta): string {
  const body = layout.placements.map((pl) => renderPanel(pl, 0)).join("\n");
  const W = layout.sheetWidthMm;
  const H = layout.sheetHeightMm;
  return `${svgOpen(W, H)}\n<rect width="${W}" height="${H}" fill="#fff"/>\n<text x="6" y="8" font-size="4">${escapeXml(meta.patternLabel)} · ${meta.panelCount} paneles · circ ${meta.circumferenceMm}mm · costura ${meta.seamMm}mm</text>\n${body}\n</svg>`;
}
