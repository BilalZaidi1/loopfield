/**
 * The change signal for on-device health views: they refresh after a sync, a clear, or new readings from a
 * heart-rate strap (R3). Kept apart from the sync code so the recorder can use it without loading the health
 * platform adapters.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;

export function onHealthChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function healthVersion(): number {
  return version;
}
export function notifyHealthChanged(): void {
  version++;
  for (const l of listeners) l();
}
