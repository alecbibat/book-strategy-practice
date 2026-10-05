// The strategy card: every square for the current rules, or the player's results on each square.
import { CELL_BY_ID, cellPlay, cellTitle, handName, LABEL, rowLabel, SECTIONS, SHORT } from "../strategy/cells";
import { explainCell } from "../strategy/explain";
import { chartSummary, strategyCode } from "../strategy/tables";
import type { Rules } from "../strategy/types";
import { UPCARDS } from "../strategy/types";
import { esc } from "./dom";
import { saved } from "./store";

export type ChartView = "plays" | "results";

export interface ChartHost {
  table: HTMLTableElement;
  legend: HTMLElement;
  detail: HTMLElement;
  foot: HTMLElement;
  summary: HTMLElement;
  viewSeg: HTMLElement;
}

export const chartState = { view: "plays" as ChartView, selected: null as string | null };

export function heat(id: string): "none" | "bad" | "mid" | "good" {
  const s = saved.cells[id];
  if (!s || !s.n) return "none";
  if (s.b === 0) return "bad";
  if (s.m > 0 && s.b < 2) return "mid";
  return "good";
}

const HEAT_TEXT = { none: "not drilled", bad: "missed last time", mid: "recovering", good: "solid" } as const;

function legendHTML(rules: Rules, results: boolean, hasDs: boolean): string {
  if (results) {
    return '<span><i class="h-good" aria-hidden="true">H</i>Solid</span><span><i class="h-mid" aria-hidden="true">H</i>Recovering</span>' +
      '<span><i class="h-bad" aria-hidden="true">H</i>Missed last time</span><span><i class="h-none" aria-hidden="true">H</i>Not drilled</span>';
  }
  let s = '<span><i class="a-hit" aria-hidden="true">H</i>Hit</span><span><i class="a-stand" aria-hidden="true">S</i>Stand</span>' +
    '<span><i class="a-double" aria-hidden="true">D</i>Double, else hit</span>' +
    (hasDs ? '<span><i class="a-double" aria-hidden="true">Ds</i>Double, else stand</span>' : "") +
    '<span><i class="a-split" aria-hidden="true">P</i>Split</span>';
  if (rules.surrender) s += '<span><i class="a-surrender" aria-hidden="true">R</i>Surrender</span>';
  return s;
}

/** What a screen reader hears for a square: "Hard 16 vs 10: surrender", "Soft 18 vs 4: double, else stand". */
function squareLabel(rules: Rules, cat: "hard" | "soft" | "pair", row: number, up: (typeof UPCARDS)[number], results: boolean): string {
  const id = cat + ":" + row + ":" + up;
  const where = (cat === "soft" ? handName(cat, row) + " (A," + row + ")" : handName(cat, row)) + " vs " + (up === 11 ? "ace" : up);
  if (results) {
    const s = saved.cells[id];
    return where + ": " + HEAT_TEXT[heat(id)] + (s ? ", " + s.c + " of " + s.n + " right" : "");
  }
  const { code, action } = cellPlay(cat, row, up, rules);
  const play = action === "double" ? (code === "Ds" ? "double, else stand" : "double, else hit") : LABEL[action].toLowerCase();
  return where + ": " + play;
}

/** Letters shown in a square. "Ds" keeps the double-else-stand distinction the classic card makes. */
function cellText(rules: Rules, cat: "hard" | "soft" | "pair", row: number, up: (typeof UPCARDS)[number]): { cls: string; text: string; code: string } {
  const { code, action } = cellPlay(cat, row, up, rules);
  const text = action === "double" && code === "Ds" ? "Ds" : SHORT[action];
  return { cls: "a-" + action, text, code };
}

/** Footnote covering the totals the card leaves off, checked against the tables. */
function offChartNote(rules: Rules): string {
  const allUps = (cat: "hard" | "soft", rows: number[], code: string) =>
    rows.every(r => UPCARDS.every(u => strategyCode(cat, r, u, rules) === code));
  const parts: string[] = [];
  parts.push(allUps("hard", [4, 5, 6, 7], "H") ? "Hard 7 or less: always hit." : "Hard 7 or less: see the advisor.");
  parts.push(allUps("hard", [18, 19, 20, 21], "S") ? "Hard 18 or more: always stand." : "Hard 18 or more: see the advisor.");
  return parts.join(" ") + " With three or more cards, play the total; you can’t double or surrender.";
}

export function renderChart(host: ChartHost): void {
  const rules = saved.rules;
  const results = chartState.view === "results";
  let hasDs = false;
  let html = '<caption class="sr">Basic strategy: your hand down the side, the dealer’s upcard across the top</caption>' +
    '<thead><tr><th class="row" scope="col"><span class="sr">Your hand</span></th>' +
    UPCARDS.map(u => '<th scope="col">' + (u === 11 ? "A" : u) + "</th>").join("") + "</tr></thead>";
  for (const sec of SECTIONS) {
    html += '<tbody><tr class="sec"><th colspan="11" scope="rowgroup">' + sec.title + "</th></tr>";
    for (const r of sec.rows) {
      html += '<tr><th class="row" scope="row">' + rowLabel(sec.cat, r) + "</th>";
      for (const u of UPCARDS) {
        const id = sec.cat + ":" + r + ":" + u;
        const c = cellText(rules, sec.cat, r, u);
        if (c.text === "Ds") hasDs = true;
        let cls = results ? "h-" + heat(id) : c.cls;
        const sel = id === chartState.selected;
        if (sel) cls += " sel";
        html += '<td class="' + cls + '" data-cell="' + id + '" tabindex="-1"' + (sel ? ' aria-current="true"' : "") +
          ' aria-label="' + esc(squareLabel(rules, sec.cat, r, u, results)) + '">' + c.text + "</td>";
      }
      html += "</tr>";
    }
    html += "</tbody>";
  }
  host.table.innerHTML = html;
  host.table.classList.toggle("results", results);
  host.legend.innerHTML = legendHTML(rules, results, hasDs);
  host.foot.textContent = offChartNote(rules);
  host.summary.textContent = chartSummary(rules);
  host.viewSeg.querySelectorAll<HTMLButtonElement>("button[data-view]").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.view === chartState.view)));
  // Roving focus: one square is tabbable, arrows move between squares.
  const focusable = (chartState.selected && host.table.querySelector<HTMLElement>('td[data-cell="' + chartState.selected + '"]')) ||
    host.table.querySelector<HTMLElement>("td[data-cell]");
  if (focusable) focusable.tabIndex = 0;
  renderDetail(host);
}

export function renderDetail(host: ChartHost): void {
  const id = chartState.selected;
  const c = id ? CELL_BY_ID[id] : null;
  if (!c) {
    host.detail.innerHTML = "<p>Tap any square to see the rule behind it.</p>";
    return;
  }
  const rules = saved.rules;
  const ex = explainCell(c.cat, c.row, c.up, rules);
  const s = saved.cells[id!];
  host.detail.innerHTML =
    '<div class="d-head"><strong>' + esc(cellTitle(c)) + '</strong><span class="tag t-' + ex.action + '">' + LABEL[ex.action] + "</span></div>" +
    "<p>" + esc(ex.summary) + (ex.tip ? " " + esc(ex.tip) : "") + "</p>" +
    (ex.notes.length ? '<ul class="notes">' + ex.notes.map(n => "<li>" + esc(n) + "</li>").join("") + "</ul>" : "") +
    '<div class="d-foot"><span>' + (s ? s.c + " of " + s.n + " right" : "Not drilled yet") + "</span>" +
    '<span class="d-actions"><button type="button" class="text-btn" data-advise="' + id + '">Open in advisor</button>' +
    '<button type="button" class="text-btn" data-drill="' + id + '">Drill this hand</button></span></div>';
}

/** Show `id` as the selected square and make it the table's one Tab stop. */
export function markSelected(host: ChartHost, id: string): void {
  host.table.querySelectorAll<HTMLElement>("td.sel").forEach(td => { td.classList.remove("sel"); td.removeAttribute("aria-current"); });
  host.table.querySelectorAll<HTMLElement>('td[tabindex="0"]').forEach(td => { td.tabIndex = -1; });
  const td = host.table.querySelector<HTMLElement>('td[data-cell="' + id + '"]');
  if (td) {
    td.classList.add("sel");
    td.setAttribute("aria-current", "true");
    td.tabIndex = 0;
  }
  chartState.selected = id;
}

/** Arrow-key movement between squares. */
export function chartKeydown(host: ChartHost, e: KeyboardEvent, select: (id: string) => void): void {
  const td = (e.target as HTMLElement).closest<HTMLTableCellElement>("td[data-cell]");
  if (!td) return;
  const tr = td.parentElement as HTMLTableRowElement;
  const col = td.cellIndex;
  const rows = [...host.table.querySelectorAll<HTMLTableRowElement>("tbody tr")].filter(r => r.querySelector("td[data-cell]"));
  const ri = rows.indexOf(tr);
  let target: HTMLElement | null = null;
  if (e.key === "ArrowRight") target = tr.cells[col + 1] as HTMLElement | undefined ?? null;
  else if (e.key === "ArrowLeft") target = col > 1 ? (tr.cells[col - 1] as HTMLElement) : null;
  else if (e.key === "ArrowDown") target = rows[ri + 1]?.cells[col] as HTMLElement | undefined ?? null;
  else if (e.key === "ArrowUp") target = rows[ri - 1]?.cells[col] as HTMLElement | undefined ?? null;
  else if (e.key === "Home") target = tr.cells[1] as HTMLElement;
  else if (e.key === "End") target = tr.cells[tr.cells.length - 1] as HTMLElement;
  else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(td.dataset.cell!); return; }
  else return;
  e.preventDefault();
  if (target && target.dataset.cell) {
    select(target.dataset.cell);
    target.focus();
  }
}
