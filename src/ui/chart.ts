// The strategy card: every square for the current rules, or the player's results on each square.
import { CELL_BY_ID, cellPlay, cellTitle, LABEL, rowLabel, SECTIONS, SHORT } from "../strategy/cells";
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

function legendHTML(rules: Rules, results: boolean): string {
  if (results) {
    return '<span><i class="h-good">H</i>Solid</span><span><i class="h-mid">H</i>Recovering</span>' +
      '<span><i class="h-bad">H</i>Missed last time</span><span><i class="h-none">H</i>Not drilled</span>';
  }
  let s = '<span><i class="a-hit">H</i>Hit</span><span><i class="a-stand">S</i>Stand</span>' +
    '<span><i class="a-double">D</i>Double, else hit</span><span><i class="a-double">Ds</i>Double, else stand</span>' +
    '<span><i class="a-split">P</i>Split</span>';
  if (rules.surrender) s += '<span><i class="a-surrender">R</i>Surrender</span>';
  return s;
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
  let html = '<thead><tr><th class="row" scope="col"><span class="sr">Your hand</span></th>' +
    UPCARDS.map(u => '<th scope="col">' + (u === 11 ? "A" : u) + "</th>").join("") + "</tr></thead>";
  for (const sec of SECTIONS) {
    html += '<tbody><tr class="sec"><th colspan="11" scope="rowgroup">' + sec.title + "</th></tr>";
    for (const r of sec.rows) {
      html += '<tr><th class="row" scope="row">' + rowLabel(sec.cat, r) + "</th>";
      for (const u of UPCARDS) {
        const id = sec.cat + ":" + r + ":" + u;
        const c = cellText(rules, sec.cat, r, u);
        let cls = results ? "h-" + heat(id) : c.cls;
        if (id === chartState.selected) cls += " sel";
        const label = cellTitle(CELL_BY_ID[id]) + ": " + LABEL[cellPlay(sec.cat, r, u, rules).action];
        html += '<td class="' + cls + '" data-cell="' + id + '" tabindex="-1" aria-label="' + esc(label) + '">' + c.text + "</td>";
      }
      html += "</tr>";
    }
    html += "</tbody>";
  }
  host.table.innerHTML = html;
  host.table.classList.toggle("results", results);
  host.legend.innerHTML = legendHTML(rules, results);
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
  else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(td.dataset.cell!); return; }
  else return;
  e.preventDefault();
  if (target && target.dataset.cell) {
    td.tabIndex = -1;
    target.tabIndex = 0;
    target.focus();
    select(target.dataset.cell);
  }
}
