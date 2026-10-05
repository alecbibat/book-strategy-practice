// Hand advisor: pick the dealer's upcard and your exact cards, get the play and the exact odds.
import type { EVResult } from "../engine";
import { advise, describeHand, handValue, type Advice } from "../strategy/advisor";
import { LABEL, upPhrase } from "../strategy/cells";
import { cellTip, rowSummary } from "../strategy/explain";
import type { Action, Rank } from "../strategy/types";
import { engineDecks, RANKS, rankToUp } from "../strategy/types";
import { cardHTML, makeCard, rankText, slotHTML, SUITS, type PlayingCard } from "./cards";
import { $, esc } from "./dom";
import { computeEVs } from "./ev-client";
import { deckLabel, freshAdvisor, saved, save, type Target } from "./store";

const MAX_PLAYER = 11;
const MAX_SEEN = 40;

let history: { target: Target; rank: Rank }[] = [];
let evTimer = 0;
let evSeq = 0;
let onShowCell: (id: string) => void = () => {};

const A = () => saved.advisor;

/** How many cards of each value the shoe holds for the current rules. */
const perRank = (r: Rank) => engineDecks(saved.rules.decks) * (r === 10 ? 16 : 4);

function used(r: Rank): number {
  const a = A();
  return (a.up === r ? 1 : 0) + a.player.filter(x => x === r).length + a.seen.filter(x => x === r).length;
}

/** Stable display cards: suits cycle by position so the felt doesn't reshuffle on every tap. */
function displayCard(r: Rank, i: number, offset: number): PlayingCard {
  return makeCard(r === 1 ? 11 : r, SUITS[(i + offset) % 4], "10");
}

const name = (r: Rank) => (r === 1 ? "ace" : r === 10 ? "ten" : String(r));

function overLimit(): Rank | null {
  for (const r of RANKS) if (used(r) > perRank(r)) return r;
  return null;
}

function canAdd(target: Target, r: Rank): boolean {
  const a = A();
  const free = perRank(r) - used(r) + (target === "dealer" && a.up === r ? 1 : 0);
  if (free <= 0) return false;
  if (target === "player") return a.player.length < MAX_PLAYER && (a.player.length < 2 || handValue(a.player).total < 21);
  if (target === "seen") return a.seen.length < MAX_SEEN;
  return true;
}

export function addCard(r: Rank): void {
  const a = A();
  const t = a.target;
  if (!canAdd(t, r)) return;
  if (t === "dealer") {
    history = history.filter(h => h.target !== "dealer"); // a new upcard replaces the old one
    a.up = r;
    if (a.player.length < 2) a.target = "player";
  } else if (t === "player") a.player.push(r);
  else a.seen.push(r);
  history.push({ target: t, rank: r });
  changed();
}

function removeAt(target: Target, i: number): void {
  const a = A();
  let rank: Rank | null;
  if (target === "dealer") { rank = a.up; a.up = null; }
  else {
    const list = target === "player" ? a.player : a.seen;
    rank = list[i] ?? null;
    list.splice(i, 1);
  }
  const j = history.map(h => h.target === target && h.rank === rank).lastIndexOf(true);
  if (j >= 0) history.splice(j, 1);
  changed();
}

export function undo(): void {
  const a = A();
  const last = history.pop();
  if (last) {
    if (last.target === "dealer") a.up = null;
    else {
      const list = last.target === "player" ? a.player : a.seen;
      const i = list.lastIndexOf(last.rank);
      if (i >= 0) list.splice(i, 1);
    }
  } else if (a.seen.length) a.seen.pop();
  else if (a.player.length) a.player.pop();
  else a.up = null;
  changed();
}

export function clearAll(): void {
  saved.advisor = freshAdvisor();
  history = [];
  changed();
}

export function loadHand(up: Rank, player: Rank[]): void {
  saved.advisor = { ...freshAdvisor(), up, player: [...player], target: "player" };
  history = [];
  changed();
}

function changed(): void {
  save();
  render();
}

// ---------- rendering ----------
export function render(): void {
  const a = A();
  renderFelt();
  // Target switch
  $("advTarget").querySelectorAll<HTMLButtonElement>("button[data-target]").forEach(b => {
    const on = b.dataset.target === a.target;
    b.setAttribute("aria-checked", String(on));
    b.tabIndex = on ? 0 : -1;
  });
  // Keypad
  $("keypad").querySelectorAll<HTMLButtonElement>("button[data-rank]").forEach(b => {
    const r = Number(b.dataset.rank) as Rank;
    b.disabled = !canAdd(a.target, r);
    b.setAttribute("aria-pressed", String(a.target === "dealer" && a.up === r));
  });
  $("keypad").dataset.target = a.target;
  $("keypadHint").textContent = a.target === "dealer" ? "Tap the dealer’s upcard." : a.target === "player" ? "Tap each of your cards in order." : "Cards you’ve seen leave the shoe. They only change the exact odds.";
  ($("advUndo") as HTMLButtonElement).disabled = !a.up && !a.player.length && !a.seen.length;
  ($("advClear") as HTMLButtonElement).disabled = !a.up && !a.player.length && !a.seen.length;
  ($("advSplit") as HTMLInputElement).checked = a.afterSplit;
  renderAnswer();
}

function renderFelt(): void {
  const a = A();
  $("advDealer").innerHTML = a.up
    ? cardHTML(displayCard(a.up, 0, 1), 0, { tag: "button", attrs: 'data-remove="dealer" data-i="0"', label: "Dealer upcard: " + name(a.up) + ". Tap to remove." })
    : slotHTML("No dealer upcard yet", 0, 'data-slot="dealer"');
  const playerCards = a.player.map((r, i) =>
    cardHTML(displayCard(r, i, 0), i + 1, { tag: "button", attrs: 'data-remove="player" data-i="' + i + '"', label: "Your card: " + name(r) + ". Tap to remove." }));
  for (let i = a.player.length; i < 2; i++) playerCards.push(slotHTML(i === 0 ? "Your first card" : "Your second card", i + 1, 'data-slot="player"'));
  $("advPlayer").innerHTML = playerCards.join("");
  $("advPlayer").classList.toggle("many", a.player.length > 4);
  const seen = $("advSeen");
  seen.hidden = !a.seen.length;
  $("advSeenCards").innerHTML = a.seen.map((r, i) =>
    '<button type="button" class="chip" data-remove="seen" data-i="' + i + '" aria-label="Remove ' + name(r) + ' from cards seen">' + rankText(r) + "</button>").join("");
  $("advHandName").textContent = a.player.length ? describeHand(a.player, a.afterSplit) : "Your hand";
}

const VERB: Record<Action, string> = { hit: "hit", stand: "stand", double: "double", split: "split", surrender: "surrender" };

function answerHTML(adv: Advice): string {
  const a = A();
  switch (adv.kind) {
    case "need-upcard":
      return '<div class="ans-head"><span class="ans-title">Pick the dealer’s upcard</span></div><p class="ans-sub">Then add your cards. The play updates as you go.</p>';
    case "need-cards":
      return '<div class="ans-head"><span class="ans-title">Add your ' + (adv.have ? "second" : "first") + ' card</span></div><p class="ans-sub">Against ' + upPhrase(rankToUp(a.up!)) + ".</p>";
    case "blackjack":
      return '<div class="ans-head"><span class="tag ans-tag t-stand">Blackjack</span></div><p class="ans-sub">Nothing to decide. It pays 3 to 2' +
        (a.up === 1 ? ". Turn down even money: it’s insurance under another name." : ".") + "</p>";
    case "bust":
      return '<div class="ans-head"><span class="ans-title">Bust</span></div><p class="ans-sub">That’s ' + adv.value.total + ". Undo the last card to go back.</p>";
    case "twenty-one":
      return '<div class="ans-head"><span class="tag ans-tag t-stand">Stand</span><span class="ans-hand">21</span></div><p class="ans-sub">Twenty-one. Nothing left to do.</p>';
    case "play": {
      const chainAlt = adv.chain.length > 1 && adv.chain[0] === adv.action ? adv.chain[1] : null;
      const fallback = chainAlt
        ? (adv.action === "double" ? "If you can’t double, " : adv.action === "surrender" ? "If you can’t surrender, " : "Otherwise, ") + VERB[chainAlt] + "."
        : "";
      const tip = cellTip(adv.cat, adv.row, adv.up, adv.action);
      const summary = rowSummary(adv.cat, adv.row, saved.rules);
      let h = '<div class="ans-head"><span class="tag ans-tag t-' + adv.action + '">' + LABEL[adv.action] + "</span>" +
        '<span class="ans-hand">' + esc(describeHand(a.player, a.afterSplit)) + " vs " + (adv.up === 11 ? "A" : adv.up) + "</span></div>";
      if (fallback) h += '<p class="ans-fallback">' + esc(fallback) + "</p>";
      if (adv.notes.length) h += '<ul class="notes">' + adv.notes.map(n => "<li>" + esc(n) + "</li>").join("") + "</ul>";
      h += '<p class="ans-sub">' + esc(summary) + (tip ? " " + esc(tip) : "") + "</p>";
      if (a.afterSplit && a.player.includes(1) && a.player.length === 2 && !adv.value.pair) {
        h += '<p class="ans-fine">If these are split aces, most casinos deal one card to each and you can’t act.</p>';
      }
      if (adv.chartCellId) h += '<div class="ans-foot"><button type="button" class="text-btn" data-show-cell="' + adv.chartCellId + '">See it on the strategy card</button></div>';
      return h;
    }
  }
}

function renderAnswer(): void {
  const a = A();
  const box = $("advAnswer");
  const over = overLimit();
  if (over) {
    box.className = "answer warn";
    box.innerHTML = '<div class="ans-head"><span class="ans-title">Too many ' + name(over) + "s</span></div>" +
      '<p class="ans-sub">A ' + deckLabel(saved.rules).toLowerCase() + " game only has " + perRank(over) + ". Remove some or change the deck count.</p>";
    hideOdds();
    return;
  }
  const adv = advise(a.player, a.up, saved.rules, { afterSplit: a.afterSplit });
  box.className = "answer" + (adv.kind === "play" ? " play a-" + adv.action : "");
  box.innerHTML = answerHTML(adv);
  if (adv.kind === "play") requestOdds(adv);
  else hideOdds();
}

function hideOdds(): void {
  evSeq++;
  clearTimeout(evTimer);
  $("advOdds").hidden = true;
}

const fmtEV = (ev: number) => (ev > 0.0005 ? "+" : ev < -0.0005 ? "−" : "") + Math.abs(ev * 100).toFixed(1) + "%";

function requestOdds(adv: Extract<Advice, { kind: "play" }>): void {
  const a = A();
  const panel = $("advOdds");
  panel.hidden = false;
  panel.setAttribute("aria-busy", "true");
  $("oddsBody").classList.add("stale");
  const id = ++evSeq;
  clearTimeout(evTimer);
  evTimer = window.setTimeout(() => {
    computeEVs({ player: a.player, up: a.up!, rules: saved.rules, seen: a.seen, afterSplit: a.afterSplit, hands: a.afterSplit ? 2 : 1 })
      .then(res => { if (id === evSeq) renderOdds(res, adv); })
      .catch(err => {
        if (id !== evSeq) return;
        panel.removeAttribute("aria-busy");
        $("oddsBody").classList.remove("stale");
        $("oddsBody").innerHTML = '<p class="empty">Couldn’t work out the odds: ' + esc(err instanceof Error ? err.message : String(err)) + "</p>";
      });
  }, 120);
}

function renderOdds(res: EVResult, adv: Extract<Advice, { kind: "play" }>): void {
  const a = A();
  const rows = (["stand", "hit", "double", "split", "surrender"] as Action[])
    .map(act => ({ act, ev: res[act] }))
    .filter((x): x is { act: Action; ev: number } => typeof x.ev === "number" && Number.isFinite(x.ev))
    .sort((x, y) => y.ev - x.ev);
  const best = rows[0];
  const scale = Math.max(1, ...rows.map(r => Math.abs(r.ev)));
  const body = $("oddsBody");
  body.innerHTML =
    '<table class="odds"><thead><tr><th scope="col">Play</th><th scope="col">Expected result</th><th scope="col"><span class="sr">Comparison</span></th></tr></thead><tbody>' +
    rows.map(r => {
      const marks = (r.act === adv.action ? '<span class="mark">Chart</span>' : "") + (r === best && best.act !== adv.action ? '<span class="mark best">Best</span>' : "");
      const w = Math.min(50, (Math.abs(r.ev) / scale) * 50);
      return '<tr' + (r.act === adv.action ? ' class="is-chart"' : "") + '><th scope="row"><span class="tag t-' + r.act + '">' + LABEL[r.act] + "</span>" + marks + "</th>" +
        '<td class="ev">' + fmtEV(r.ev) + "</td>" +
        '<td class="bar-cell" aria-hidden="true"><span class="bar ' + (r.ev >= 0 ? "pos" : "neg") + '" style="--w:' + w.toFixed(1) + '%"></span></td></tr>';
    }).join("") + "</tbody></table>";
  let note = "";
  if (best && best.act !== adv.action) {
    const chart = rows.find(r => r.act === adv.action);
    const gap = chart ? best.ev - chart.ev : 0;
    note = '<p class="cd-note">With these exact cards, ' + LABEL[best.act].toLowerCase() + " does a little better than the chart play, by " +
      (gap * 100).toFixed(gap < 0.001 ? 2 : 1) + "% of your bet. The card goes by totals, so it can’t capture every combination" +
      (a.seen.length ? " or the cards you’ve seen" : "") + ".</p>";
  }
  body.insertAdjacentHTML("beforeend", note +
    '<p class="fine">Average win or loss per unit bet with these cards out of a ' + engineDeckText() + ", after the dealer has checked for blackjack. Doubling and splitting include the extra bets.</p>");
  body.classList.remove("stale");
  $("advOdds").removeAttribute("aria-busy");
}

const engineDeckText = () => (saved.rules.decks === "1" ? "single deck" : saved.rules.decks === "2" ? "double deck" : "6-deck shoe");

/** Keyboard: A, 2-9, 0/T for ten add a card; Backspace undoes. Returns true when the key was used. */
export function advisorKey(e: KeyboardEvent): boolean {
  const k = (e.key || "").toLowerCase();
  const map: Record<string, Rank> = { a: 1, "1": 1, "0": 10, t: 10, j: 10, q: 10, k: 10 };
  for (let i = 2; i <= 9; i++) map[String(i)] = i as Rank;
  if (map[k]) { e.preventDefault(); addCard(map[k]); return true; }
  if (k === "backspace") { e.preventDefault(); undo(); return true; }
  return false;
}

export function onRules(): void { render(); }

export function initAdvisor(opts: { showCell: (id: string) => void }): void {
  onShowCell = opts.showCell;
  $("keypad").innerHTML = RANKS.map(r =>
    '<button type="button" class="key" data-rank="' + r + '" aria-label="' + (r === 1 ? "Ace" : r === 10 ? "Ten, jack, queen or king" : String(r)) + '">' +
    '<span class="key-main">' + rankText(r) + "</span>" + (r === 10 ? '<span class="key-sub">J Q K</span>' : "") + "</button>").join("");
  $("keypad").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-rank]");
    if (b && !b.disabled) addCard(Number(b.dataset.rank) as Rank);
  });
  $("advTarget").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-target]");
    if (!b) return;
    A().target = b.dataset.target as Target;
    changed();
  });
  $("advTarget").addEventListener("keydown", e => {
    const order: Target[] = ["dealer", "player", "seen"];
    const i = order.indexOf(A().target);
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    A().target = order[(i + d + order.length) % order.length];
    changed();
    $("advTarget").querySelector<HTMLButtonElement>('button[aria-checked="true"]')?.focus();
  });
  const feltClick = (e: Event) => {
    const t = e.target as HTMLElement;
    const rm = t.closest<HTMLElement>("[data-remove]");
    if (rm) { removeAt(rm.dataset.remove as Target, Number(rm.dataset.i)); return; }
    const slot = t.closest<HTMLElement>("[data-slot]");
    if (slot) { A().target = slot.dataset.slot as Target; changed(); }
  };
  $("advFelt").addEventListener("click", feltClick);
  $("advUndo").addEventListener("click", undo);
  $("advClear").addEventListener("click", clearAll);
  $("advSplit").addEventListener("change", e => { A().afterSplit = (e.target as HTMLInputElement).checked; changed(); });
  $("advAnswer").addEventListener("click", e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-show-cell]");
    if (b) onShowCell(b.dataset.showCell!);
  });
  render();
}
