export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error("Missing #" + id);
  return el as T;
};

export const esc = (s: unknown): string =>
  String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[ch]!);

export const reduceMotion = (): boolean =>
  !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

export const now = (): number => (window.performance && performance.now ? performance.now() : Date.now());

export const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

/** True while the user is typing into a form field, so single-key shortcuts should stay out of the way. */
export function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  return el.tagName === "INPUT" && !/^(checkbox|radio|button|submit|reset|range|color|file|image)$/i.test((el as HTMLInputElement).type);
}
