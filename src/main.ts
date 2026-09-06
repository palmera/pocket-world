import { KidsBall, KidTool, PaintKind, WorldStyle } from "./scene/KidsBall";
import type { InputMode } from "./scene/pointerRouting";
import "./world.css";

const icons: Record<string,string> = {
  "t-move": '<circle cx="12" cy="12" r="7"/><path d="M5 12h14M12 5c4 4 4 10 0 14-4-4-4-10 0-14"/>',
  "t-draw": '<path d="m5 16-1 4 4-1L20 7l-3-3Z M14 7l3 3"/>',
  "t-paint": '<path d="m5 5 10 10-6 6-8-8 10-10 8 8H4M5 2l6 6M20 13s-3 4-3 6a3 3 0 0 0 6 0c0-2-3-6-3-6Z"/>',
  "t-brush": '<path d="m9 13 8-9 3 3-9 8M10 14c-5-2-3 5-7 5 7 3 10-2 7-5Z"/>',
  "a-random": '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 8h.01M16 16h.01M12 12h.01" stroke-width="3"/>',
  "a-undo": '<path d="M8 5 3 10l5 5M3 10h10a6 6 0 0 1 0 12"/>',
  "a-redo": '<path d="m16 5 5 5-5 5m5-5h-10a6 6 0 0 0 0 12"/>',
  "a-photo": '<path d="M4 7h4l2-3h4l2 3h4v13H4Z"/><circle cx="12" cy="13" r="3"/>',
  "a-clear": '<path d="M12 5v14M5 12h14"/>',
};
for (const [id,paths] of Object.entries(icons)) document.getElementById(id)!.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const caption = document.createElement("div"); caption.id="world-caption"; document.getElementById("ball")!.appendChild(caption);
const hint = document.createElement("div"); hint.id="world-hint"; document.getElementById("app")!.appendChild(hint);

const KEY = "pocket-world.current";
// The preview URL has a separate, tab-scoped save for visual regression checks.
const storage = new URLSearchParams(location.search).has("preview") ? sessionStorage : localStorage;
const ball = new KidsBall(document.getElementById("ball") as HTMLElement);

// Device preference, separate from the planet save and undo history. Available
// on all devices: iPad desktop browsing must not hide the Pencil control.
const inputKey="pocket-world.input-mode";
const inputSwitch=document.createElement("div");
inputSwitch.id="input-mode";
inputSwitch.setAttribute("role","group");
inputSwitch.setAttribute("aria-label","Modo de entrada");
inputSwitch.innerHTML='<button type="button" data-input="hand" aria-pressed="true" title="Dibujar y pintar con el dedo">Mano</button><button type="button" data-input="pen" aria-pressed="false" title="Apple Pencil dibuja y pinta; los dedos solo mueven la cámara">Lápiz</button>';
document.getElementById("app")!.appendChild(inputSwitch);
function selectInputMode(mode:InputMode) {
  ball.setInputMode(mode);
  inputSwitch.querySelectorAll<HTMLButtonElement>("button").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.input===mode)));
  try { storage.setItem(inputKey,mode); } catch { /* private browsing */ }
}
inputSwitch.querySelectorAll<HTMLButtonElement>("button").forEach(button=>button.addEventListener("click",()=>selectInputMode(button.dataset.input as InputMode)));
let savedInput:InputMode="hand";
try { if(storage.getItem(inputKey)==="pen") savedInput="pen"; } catch { /* private browsing */ }
selectInputMode(savedInput);

// Restore the last planet, or begin with a blank sphere.
function savedWorld(): unknown | null {
  try {
    const raw = storage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

const countEl = document.getElementById("count") as HTMLElement;
ball.setChangeHandler(() => {
  const n = ball.panelCount();
  countEl.textContent = n ? `${n} places` : "draw a place";
  try { storage.setItem(KEY, JSON.stringify(ball.getSaveData())); } catch { /* ignore */ }
});
const saved = savedWorld();
const restored = ball.loadSaveData(saved);
if (!restored) ball.setGraph({ verts: [], edges: [] }, false);

// ---- tools ----
const toolBtns: Record<KidTool, HTMLElement> = {
  move: document.getElementById("t-move") as HTMLElement,
  draw: document.getElementById("t-draw") as HTMLElement,
  paint: document.getElementById("t-paint") as HTMLElement,
  brush: document.getElementById("t-brush") as HTMLElement,
};
let activeTool: KidTool = "move";
function selectTool(t: KidTool) {
  activeTool = t;
  ball.setTool(t);
  (Object.keys(toolBtns) as KidTool[]).forEach((k) => toolBtns[k].classList.toggle("on", k === t));
  (Object.keys(toolBtns) as KidTool[]).forEach((k) => toolBtns[k].setAttribute("aria-pressed", String(k === t)));
  document.getElementById("brush-options")!.hidden=t!=="brush";
  hint.textContent = t === "move" ? "Drag to turn · Pinch to discover" : t === "draw" ? "Acercá los extremos para cerrar · Espacio + arrastrar: cámara" : t==="brush" ? "Pintá una franja · Espacio + arrastrar: cámara" : "Balde · Tocá una región · Espacio + arrastrar: cámara";
}
document.getElementById("brush-width")!.addEventListener("input",event=>{
  const width=Number((event.target as HTMLInputElement).value);ball.setBrushWidth(width);
  document.getElementById("brush-size")!.textContent=`${width} px`;
});
const processing=document.createElement("div");processing.id="processing";processing.setAttribute("role","status");document.getElementById("app")!.appendChild(processing);
document.getElementById("ball")!.addEventListener("world-processing",event=>{processing.textContent=(event as CustomEvent<string>).detail;});
(Object.keys(toolBtns) as KidTool[]).forEach((t) => toolBtns[t].addEventListener("click", () => selectTool(t)));

const PAINT_SETS: Record<WorldStyle, { icon: string; label: string; color: string; paint: PaintKind }[]> = {
  blank: [
    { icon: "●", label: "Charcoal", color: "#45525b", paint: "charcoal" }, { icon: "●", label: "Sky", color: "#9ad6f2", paint: "sky" },
    { icon: "●", label: "Sun", color: "#f7d05c", paint: "sun" }, { icon: "●", label: "Rose", color: "#f49db5", paint: "rose" }, { icon: "●", label: "Mint", color: "#91d6b4", paint: "mint" },
  ],
  doodle: [
    { icon: "🖍", label: "Red crayon", color: "#ef5a4c", paint: "red-crayon" }, { icon: "🖍", label: "Blue crayon", color: "#3979d3", paint: "blue-crayon" },
    { icon: "🖍", label: "Yellow crayon", color: "#f3c747", paint: "yellow-crayon" }, { icon: "🖍", label: "Purple crayon", color: "#9b70c9", paint: "purple-crayon" }, { icon: "🖍", label: "Green crayon", color: "#68ae67", paint: "green-crayon" },
  ],
  jelly: [
    { icon: "●", label: "Strawberry jelly", color: "#f15c87", paint: "strawberry" }, { icon: "●", label: "Blueberry jelly", color: "#4f9eea", paint: "blueberry" },
    { icon: "●", label: "Lemon jelly", color: "#f7d548", paint: "lemon" }, { icon: "●", label: "Grape jelly", color: "#9b65d0", paint: "grape" }, { icon: "●", label: "Lime jelly", color: "#8dce5f", paint: "lime" },
  ],
  tiny: [
    { icon: "🌿", label: "Meadow", color: "#77bb57", paint: "meadow" }, { icon: "💧", label: "Water", color: "#3a9fe7", paint: "water" },
    { icon: "🐚", label: "Sand", color: "#f4c95d", paint: "sand" }, { icon: "🔥", label: "Lava", color: "#ed704d", paint: "lava" }, { icon: "🪨", label: "Stone", color: "#8a8194", paint: "stone" },
  ],
};

const LIFE_PREVIEWS: Record<PaintKind, string> = {
  charcoal: "✦", sky: "☁️", sun: "☀️", rose: "✿", mint: "❋",
  "red-crayon": "✎", "blue-crayon": "✎", "yellow-crayon": "✎", "purple-crayon": "✎", "green-crayon": "✎",
  strawberry: "🍓", blueberry: "🫐", lemon: "🍋", grape: "🍇", lime: "🍈",
  meadow: "🐑", water: "🐟", sand: "🦀", lava: "🌋", stone: "🦎",
};

const worldToolCopy: Record<WorldStyle, { draw: string; paint: string }> = {
  blank: { draw: "Draw", paint: "Color" },
  doodle: { draw: "Crayon", paint: "Ink" },
  jelly: { draw: "Squeeze", paint: "Flavor" },
  tiny: { draw: "Borders", paint: "Land" },
};
const paintBtns = document.querySelectorAll<HTMLButtonElement>("[data-paint-slot]");
function applyWorldUi(style: WorldStyle) {
  const names = { tiny:"A little living planet", jelly:"A handful of happiness", doodle:"Your imagination, in orbit", blank:"A world of possibilities" };
  caption.innerHTML = `${style === "tiny" ? "The living collection" : style === "jelly" ? "The candy collection" : "The creative collection"}<strong>${names[style]}</strong>`;
  const tools = worldToolCopy[style];
  document.getElementById("draw-label")!.textContent = tools.draw;
  document.getElementById("paint-label")!.textContent = "Balde";
  const set = PAINT_SETS[style];
  paintBtns.forEach((btn, i) => {
    const tool = set[i];
    btn.textContent = tool.icon;
    btn.title = tool.label;
    btn.setAttribute("aria-label", tool.label);
    btn.dataset.paint = tool.paint;
    btn.dataset.preview = LIFE_PREVIEWS[tool.paint];
    btn.style.background = tool.color;
    btn.classList.toggle("selected", i === 0);
  });
  ball.setPaint(set[0].paint);
  const randomWrap = document.getElementById("random-wrap")!;
  randomWrap.classList.toggle("hidden", style !== "jelly" && style !== "tiny");
  document.getElementById("a-empty")!.hidden=style !== "tiny";
}
paintBtns.forEach((btn) => btn.addEventListener("click", () => {
  ball.setPaint(btn.dataset.paint as PaintKind);
  selectTool(activeTool === "draw" || activeTool === "brush" ? activeTool : "paint");
  paintBtns.forEach((item) => item.classList.toggle("selected", item === btn));
}));

const styleBtns = document.querySelectorAll<HTMLButtonElement>("[data-style]");
styleBtns.forEach((btn) => btn.addEventListener("click", () => {
  const style = btn.dataset.style as WorldStyle;
  ball.newWorld(style);
  applyWorldUi(style);
  selectTool(style === "blank" || style === "doodle" ? "draw" : "move");
  styleBtns.forEach((item) => item.classList.toggle("selected", item === btn));
  document.getElementById("world-picker")!.classList.add("hidden");
}));

// ---- actions ----
const emptyDialog=document.getElementById("empty-confirm") as HTMLDialogElement;
document.getElementById("a-empty")!.addEventListener("click",()=>{
  if(ball.getWorldStyle() !== "tiny") return;
  emptyDialog.returnValue="cancel";
  emptyDialog.showModal();
});
emptyDialog.addEventListener("close",()=>{
  if(emptyDialog.returnValue !== "clear" || ball.getWorldStyle() !== "tiny") return;
  ball.clearTinyWorld();
  selectTool("draw");
});
document.getElementById("a-undo")!.addEventListener("click", () => ball.undo());
document.getElementById("a-redo")!.addEventListener("click", () => ball.redo());
document.getElementById("a-random")!.addEventListener("click", () => ball.randomWorld());
document.getElementById("a-clear")!.addEventListener("click", () => {
  document.getElementById("world-picker")!.classList.remove("hidden");
});
document.getElementById("a-photo")!.addEventListener("click", () => {
  const url = ball.snapshot();
  const a = document.createElement("a");
  a.href = url;
  a.download = "mi-pelota.png";
  a.click();
});

if (restored) document.getElementById("world-picker")!.classList.add("hidden");
applyWorldUi(ball.getWorldStyle());
selectTool("move");
