import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-500.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/barlow/latin-700.css";
import "@fontsource/barlow-condensed/latin-500.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/bodoni-moda/latin-700.css";
import "@fontsource/bodoni-moda/latin-800.css";
import "./styles/app.css";

import { CELL_BY_ID } from "./strategy/cells";
import type { Rank } from "./strategy/types";
import { upToRank } from "./strategy/types";
import * as advisor from "./ui/advisor";
import { chartKeydown, chartState, renderChart, renderDetail, type ChartHost, type ChartView } from "./ui/chart";
import { $, isTyping, reduceMotion } from "./ui/dom";
import * as drill from "./ui/drill";
import { mountRulesForm, syncRulesForms } from "./ui/rules-form";
import { deckLabel, load, onRulesChange, rulesShort, save, saved, storageOK, type Tab, type Theme } from "./ui/store";

load();

// ---------- theme ----------
function applyTheme(): void {
  const root = document.documentElement;
  if (saved.theme === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = saved.theme;
  $("themeSeg").querySelectorAll<HTMLButtonElement>("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === saved.theme)));
}

// ---------- tabs ----------
const TABS: { tab: Tab; btn: string; view: string }[] = [
  { tab: "drill", btn: "tabDrill", view: "viewDrill" },
  { tab: "advisor", btn: "tabAdvisor", view: "viewAdvisor" }
];
function showTab(tab: Tab, focus = false): void {
  saved.tab = tab;
  save();
  for (const t of TABS) {
    const on = t.tab === tab;
    const b = $(t.btn);
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
    $(t.view).hidden = !on;
    if (on && focus) b.focus();
  }
  if (tab !== "drill") {
    clearTimeout(drill.drill.timer); // don't deal while the drill is hidden
    drill.drill.timer = 0;
  } else if (drill.drill.answered && drill.drill.verdict?.ok && saved.auto) {
    drill.next(); // a right answer was waiting to move on
  }
}
$("tabDrill").parentElement!.addEventListener("click", e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
  const t = TABS.find(x => b && x.btn === b.id);
  if (t) showTab(t.tab);
});
$("tabDrill").parentElement!.addEventListener("keydown", e => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
  e.preventDefault();
  const i = TABS.findIndex(t => t.tab === saved.tab);
  const n = e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
  showTab(TABS[n].tab, true);
});

// ---------- dialogs ----------
const cardDialog = $<HTMLDialogElement>("cardDialog");
const rulesDialog = $<HTMLDialogElement>("rulesDialog");
const chartHost: ChartHost = {
  table: $<HTMLTableElement>("chart"), legend: $("legend"), detail: $("detail"),
  foot: $("chartFoot"), summary: $("cardSummary"), viewSeg: $("chartView")
};

function openDialog(d: HTMLDialogElement): void {
  if (d.open) return;
  for (const other of [cardDialog, rulesDialog]) if (other !== d && other.open) other.close();
  clearTimeout(drill.drill.timer); // don't deal behind an open sheet
  drill.drill.timer = 0;
  d.showModal();
}
function openCard(selectId?: string): void {
  if (selectId && CELL_BY_ID[selectId]) chartState.selected = selectId;
  renderChart(chartHost);
  openDialog(cardDialog);
  const sel = chartState.selected && chartHost.table.querySelector<HTMLElement>('td[data-cell="' + chartState.selected + '"]');
  if (sel) sel.scrollIntoView({ block: "center", inline: "center" });
}
for (const d of [cardDialog, rulesDialog]) {
  d.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    if (t === d || t.closest("[data-close]")) d.close(); // backdrop or close button
  });
  d.addEventListener("close", () => {
    if (saved.tab === "drill" && drill.drill.answered && saved.auto && drill.drill.verdict?.ok) drill.next();
  });
}
$("cardBtn").addEventListener("click", () => openCard());
$("rulesBtn").addEventListener("click", () => { renderProgress(); openDialog(rulesDialog); });
$("rulesToCard").addEventListener("click", () => openCard());

chartHost.viewSeg.addEventListener("click", e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-view]");
  if (!b) return;
  chartState.view = b.dataset.view as ChartView;
  renderChart(chartHost);
});
function selectCell(id: string): void {
  chartHost.table.querySelector("td.sel")?.classList.remove("sel");
  chartHost.table.querySelector('td[data-cell="' + id + '"]')?.classList.add("sel");
  chartState.selected = id;
  renderDetail(chartHost);
}
chartHost.table.addEventListener("click", e => {
  const td = (e.target as HTMLElement).closest<HTMLElement>("td[data-cell]");
  if (td) selectCell(td.dataset.cell!);
});
chartHost.table.addEventListener("keydown", e => chartKeydown(chartHost, e, selectCell));

$("printBtn").addEventListener("click", () => {
  const root = document.documentElement;
  root.classList.add("print-card");
  const done = () => { root.classList.remove("print-card"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  window.print();
  setTimeout(done, 1000);
});

/** Two cards that land on a chart square, for the advisor. */
function ranksFor(id: string): { up: Rank; player: Rank[] } | null {
  const c = CELL_BY_ID[id];
  if (!c) return null;
  const up = upToRank(c.up);
  if (c.cat === "pair") return { up, player: c.row === 11 ? [1, 1] : [c.row as Rank, c.row as Rank] };
  if (c.cat === "soft") return { up, player: [1, c.row as Rank] };
  const low = c.row <= 11 ? 2 : c.row - 10; // e.g. 2+6 for hard 8, 6+10 for hard 16
  return { up, player: [low as Rank, (c.row - low) as Rank] };
}

// Shared buttons: "Drill this hand" and "Open in advisor" can appear in the card and in the misses list.
document.addEventListener("click", e => {
  const t = e.target as HTMLElement;
  const d = t.closest<HTMLElement>("[data-drill]");
  if (d && CELL_BY_ID[d.dataset.drill!]) {
    if (cardDialog.open) cardDialog.close();
    showTab("drill");
    drill.drillCell(d.dataset.drill!);
    $("felt").scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "center" });
    return;
  }
  const a = t.closest<HTMLElement>("[data-advise]");
  if (a) {
    const r = ranksFor(a.dataset.advise!);
    if (!r) return;
    if (cardDialog.open) cardDialog.close();
    advisor.loadHand(r.up, r.player);
    showTab("advisor");
  }
});

// ---------- rules ----------
mountRulesForm($("rulesForm"), "rf");
mountRulesForm($("cardRulesForm"), "cf");
function renderRules(): void {
  const r = saved.rules;
  $("rulesText").textContent = rulesShort(r);
  $("cardRulesShort").textContent = deckLabel(r) + " · " + rulesShort(r);
  $("eyebrow").textContent = "Blackjack · " + deckLabel(r);
  document.querySelectorAll(".arc-rule").forEach(n => { n.textContent = r.h17 ? "DEALER MUST HIT SOFT 17" : "DEALER MUST STAND ON ALL 17s"; });
  syncRulesForms();
}
onRulesChange(() => {
  renderRules();
  drill.onRules();
  advisor.onRules();
  if (cardDialog.open) renderChart(chartHost);
});

// ---------- drill prefs, theme, progress ----------
function renderAuto(): void {
  $("autoSeg").querySelectorAll<HTMLButtonElement>("button").forEach(b => b.setAttribute("aria-pressed", String((b.dataset.v === "1") === saved.auto)));
}
$("autoSeg").addEventListener("click", e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-v]");
  if (!b) return;
  saved.auto = b.dataset.v === "1";
  save();
  renderAuto();
});
$("themeSeg").addEventListener("click", e => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-v]");
  if (!b) return;
  saved.theme = b.dataset.v as Theme;
  save();
  applyTheme();
});
function renderProgress(): void {
  const n = Object.values(saved.cells).reduce((s, c) => s + c.n, 0);
  $("progressSub").textContent = n ? n + (n === 1 ? " hand" : " hands") + " drilled" + (storageOK ? ", saved in this browser" : "") : "Nothing drilled yet";
}
let resetTimer = 0;
const resetBtn = $("resetBtn");
resetBtn.addEventListener("click", () => {
  if (resetBtn.dataset.armed === "1") {
    clearTimeout(resetTimer);
    resetBtn.dataset.armed = "";
    resetBtn.textContent = "Reset progress";
    drill.resetProgress();
    renderProgress();
  } else {
    resetBtn.dataset.armed = "1";
    resetBtn.textContent = "Tap again to erase";
    resetTimer = window.setTimeout(() => { resetBtn.dataset.armed = ""; resetBtn.textContent = "Reset progress"; }, 4000);
  }
});

// ---------- keyboard ----------
document.addEventListener("pointerdown", () => { drill.drill.keyboard = false; }, true);
document.addEventListener("keydown", e => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  if (cardDialog.open || rulesDialog.open || isTyping(e.target)) return;
  const k = (e.key || "").toLowerCase();
  if (k === "c") { e.preventDefault(); openCard(); return; }
  if (saved.tab === "drill") drill.drillKey(e);
  else advisor.advisorKey(e);
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && drill.drill.hand && !drill.drill.answered) drill.drill.hand.t0 = performance.now();
});

// ---------- start ----------
applyTheme();
renderRules();
renderAuto();
$("syncNote").textContent = storageOK ? "Progress and settings are saved in this browser." : "Progress isn’t saved in this view.";
drill.initDrill({
  openAdvisor: (up, player) => { advisor.loadHand(up, player); showTab("advisor"); },
  changed: () => { if (cardDialog.open) renderChart(chartHost); }
});
advisor.initAdvisor({ showCell: id => openCard(id) });
showTab(saved.tab);

if ("serviceWorker" in navigator && import.meta.env.PROD && import.meta.env.MODE !== "single" && location.protocol === "https:") {
  window.addEventListener("load", () => { navigator.serviceWorker.register("./sw.js").catch(() => { /* offline support is optional */ }); });
}
