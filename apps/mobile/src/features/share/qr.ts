import qrcode from 'qrcode-generator';

/**
 * A QR code as one SVG path (a unit square per dark module), plus its size in modules. Medium error
 * correction so a slightly compressed share image still scans.
 */
export function qrPath(text: string): { d: string; size: number } {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) {
        c++;
        continue;
      }
      // Merge runs of dark modules on a row into one rectangle.
      let run = 1;
      while (c + run < n && qr.isDark(r, c + run)) run++;
      d += `M${c} ${r}h${run}v1h-${run}z`;
      c += run;
    }
  }
  return { d, size: n };
}
