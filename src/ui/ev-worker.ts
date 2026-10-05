// Runs the EV engine off the main thread so the advisor stays responsive.
import { handEVs, type EVQuery } from "../engine";

self.onmessage = (e: MessageEvent<{ id: number; query: EVQuery }>) => {
  const { id, query } = e.data;
  try {
    (self as unknown as Worker).postMessage({ id, result: handEVs(query) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
