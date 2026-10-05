// Asks the EV engine for exact odds: in a Web Worker when the page allows one, otherwise inline.
import type { EVQuery, EVResult } from "../engine";
import EvWorker from "./ev-worker?worker&inline";

type Reply = { id: number; result?: EVResult; error?: string };

let worker: Worker | null = null;
let workerFailed = false;
let seq = 0;
const pending = new Map<number, { resolve: (r: EVResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker || workerFailed) return worker;
  try {
    worker = new EvWorker();
    worker.onmessage = (e: MessageEvent<Reply>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.result) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error || "Calculation failed"));
    };
    worker.onerror = () => {
      // The page's security policy can block workers; fall back to computing inline.
      workerFailed = true;
      worker?.terminate();
      worker = null;
      const queued = [...pending.entries()];
      pending.clear();
      queued.forEach(([, p]) => p.reject(new Error("worker-unavailable")));
    };
  } catch {
    workerFailed = true;
    worker = null;
  }
  return worker;
}

async function inline(query: EVQuery): Promise<EVResult> {
  const { handEVs } = await import("../engine");
  return handEVs(query);
}

export function computeEVs(query: EVQuery): Promise<EVResult> {
  const w = getWorker();
  if (!w) return inline(query);
  const id = ++seq;
  return new Promise<EVResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, query: JSON.parse(JSON.stringify(query)) });
  }).catch(err => {
    if (err instanceof Error && err.message === "worker-unavailable") return inline(query);
    throw err;
  });
}
