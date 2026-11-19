import Link from 'next/link';
import { LoopMark, Wordmark } from '@/components/LoopMark';
import { MotionToggle } from '@/components/MotionToggle';
import { requirementsLine, site } from '@/config/site';
import { copy } from '@/content/en';
import { getHref, storeState, type StorePlatform } from '@/lib/stores';

/** Text links to the stores (through /get, no third set of badges), the store-required pages and the legal lines. */
export function Footer({ onHome = false }: { onHome?: boolean }) {
  const stores = (['ios', 'android'] as StorePlatform[]).filter((p) => storeState(p) !== 'waitlist');
  return (
    <footer className="relative border-t border-white/[0.06] bg-bg">
      <div className="mx-auto w-full max-w-[1280px] px-5 pb-32 pt-14 sm:px-8 md:py-16 lg:px-12">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div>
            <a href={onHome ? '#top' : '/'} className="inline-flex items-center gap-2.5 rounded-md" aria-label={onHome ? 'Loopfield, back to top' : 'Loopfield home'}>
              <LoopMark size={34} />
              <Wordmark className="text-[26px] leading-none text-ink" />
            </a>
            <p className="t-kicker mt-4 text-muted">{copy.footer.tagline}</p>
          </div>
          <div className="grid grid-cols-2 gap-x-12 gap-y-8 sm:gap-x-20">
            <nav aria-label="Get the app">
              <p className="t-kicker text-subtle">App</p>
              <ul className="mt-4 grid gap-3">
                {stores.length === 0 ? (
                  <li>
                    <a href={onHome ? '#download' : '/#download'} className="t-label text-ink hover:text-primary">
                      {copy.joinWaitlist}
                    </a>
                  </li>
                ) : (
                  stores.map((p) => (
                    <li key={p}>
                      <a href={getHref('footer', p)} className="t-label text-ink hover:text-primary">
                        {p === 'ios' ? copy.footer.iphone : copy.footer.android}
                      </a>
                    </li>
                  ))
                )}
                <li>
                  <a href={`mailto:${site.supportEmail}`} className="t-label text-muted hover:text-ink">
                    {site.supportEmail}
                  </a>
                </li>
              </ul>
            </nav>
            <nav aria-label="Legal and support">
              <p className="t-kicker text-subtle">Loopfield</p>
              <ul className="mt-4 grid gap-3">
                {copy.footer.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="t-label text-muted hover:text-ink">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>
        <div className="mt-12 flex flex-col gap-6 border-t border-white/[0.06] pt-8 md:flex-row md:items-end md:justify-between">
          <div className="t-caption grid max-w-[70ch] gap-1.5 text-subtle">
            <p>
              © {new Date().getFullYear()} {site.publisher}. {requirementsLine}.
            </p>
            <p>{copy.footer.apple}</p>
            <p>{copy.footer.google}</p>
          </div>
          <MotionToggle />
        </div>
      </div>
    </footer>
  );
}
