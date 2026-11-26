/** Wording for heart-rate straps (R3). */

/** A strap's name as shown on this phone: the name it advertises, or a plain description. */
export function strapName(name: string | null | undefined): string {
  return name?.trim() || 'Heart-rate strap';
}

/** How strong a strap's signal is, from its RSSI, in words. */
export function signalWords(rssi: number): string {
  return rssi >= -60 ? 'Strong signal' : rssi >= -80 ? 'Good signal' : 'Weak signal';
}

/** The battery line for a paired strap. */
export function batteryWords(battery: number | null, checked: string | null): string {
  return battery != null && checked ? `Battery ${battery}% · checked ${checked}` : 'Battery level not reported';
}
