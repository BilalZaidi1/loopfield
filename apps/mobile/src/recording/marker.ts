/** Which marker the run map showed for the runner: analytics says only "picture" or "dot". */
let markerKind: 'picture' | 'dot' = 'dot';

export function noteMarker(kind: 'picture' | 'dot'): void {
  markerKind = kind;
}

export function markerShown(): 'picture' | 'dot' {
  return markerKind;
}
