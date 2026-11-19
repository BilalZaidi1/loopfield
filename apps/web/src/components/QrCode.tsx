import QRCode from 'qrcode';
import { site } from '@/config/site';
import { waitlistOnly } from '@/lib/stores';

/** Desktop only: a code that opens /get on a phone, which sends it to the right store. Rendered at build time. */
export async function QrCode({ caption, placement, onBlock = false }: { caption: string; placement: string; onBlock?: boolean }) {
  if (waitlistOnly()) return null;
  const svg = await QRCode.toString(`${site.url}/get?c=${encodeURIComponent(`qr-${placement}`)}`, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    color: { dark: '#121318ff', light: '#ffffffff' }
  });
  return (
    <figure className="desktop-only hidden items-center gap-3 lg:flex">
      <div className="size-[88px] rounded-[14px] bg-white p-1 [&>svg]:block [&>svg]:size-full" role="img" aria-label="QR code to get the app" dangerouslySetInnerHTML={{ __html: svg }} />
      <figcaption className={`t-caption max-w-[8.5rem] ${onBlock ? 'text-white/80' : 'text-muted'}`}>{caption}</figcaption>
    </figure>
  );
}
