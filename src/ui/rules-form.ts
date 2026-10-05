// Segmented controls for the table rules. Several copies can be on the page (the Rules sheet and the
// strategy card); they all read from and write to the same saved rules.
import type { Rules } from "../strategy/types";
import { esc } from "./dom";
import { saved, setRules } from "./store";

interface Option { v: string; label: string }
interface Field { key: keyof Rules; name: string; sub?: string; options: Option[] }

const FIELDS: Field[] = [
  { key: "decks", name: "Decks", sub: "Shoe games use the 4–8 deck chart", options: [{ v: "1", label: "1" }, { v: "2", label: "2" }, { v: "4-8", label: "4–8" }] },
  { key: "h17", name: "Dealer on soft 17", sub: "Printed on the felt", options: [{ v: "0", label: "Stands" }, { v: "1", label: "Hits" }] },
  { key: "das", name: "Double after split", options: [{ v: "1", label: "Allowed" }, { v: "0", label: "Not allowed" }] },
  { key: "surrender", name: "Surrender", sub: "Late surrender, after the dealer checks for blackjack", options: [{ v: "1", label: "Offered" }, { v: "0", label: "Not offered" }] },
  { key: "double", name: "Double down on", options: [{ v: "any", label: "Any 2 cards" }, { v: "9-11", label: "9–11" }, { v: "10-11", label: "10–11" }] }
];

const valueOf = (key: keyof Rules): string => {
  const v = saved.rules[key];
  return typeof v === "boolean" ? (v ? "1" : "0") : String(v);
};

export function rulesFormHTML(prefix: string): string {
  return FIELDS.map(f => {
    const nameId = prefix + "-" + f.key;
    return '<div class="set-row"><div><div class="set-name" id="' + nameId + '">' + esc(f.name) + "</div>" +
      (f.sub ? '<div class="set-sub">' + esc(f.sub) + "</div>" : "") + "</div>" +
      '<div class="seg" role="group" aria-labelledby="' + nameId + '" data-rule="' + f.key + '">' +
      f.options.map(o => '<button type="button" data-v="' + o.v + '" aria-pressed="false">' + esc(o.label) + "</button>").join("") +
      "</div></div>";
  }).join("");
}

export function syncRulesForms(): void {
  document.querySelectorAll<HTMLElement>(".seg[data-rule]").forEach(seg => {
    const cur = valueOf(seg.dataset.rule as keyof Rules);
    seg.querySelectorAll<HTMLButtonElement>("button[data-v]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === cur)));
  });
}

/** Mount a rules form into `host` and keep it in sync. */
export function mountRulesForm(host: HTMLElement, prefix: string): void {
  host.innerHTML = rulesFormHTML(prefix);
  host.addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".seg[data-rule] button[data-v]");
    if (!b) return;
    const key = (b.parentElement as HTMLElement).dataset.rule as keyof Rules;
    const v = b.dataset.v!;
    if (valueOf(key) === v) return;
    const patch: Partial<Rules> =
      key === "decks" ? { decks: v as Rules["decks"] } :
      key === "double" ? { double: v as Rules["double"] } :
      { [key]: v === "1" };
    setRules(patch);
  });
  syncRulesForms();
}
