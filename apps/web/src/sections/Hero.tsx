import { Icon } from '@/components/Icon';
import { QrCode } from '@/components/QrCode';
import { HeroLines } from '@/components/Reveal';
import { StoreButtons } from '@/components/StoreButtons';
import { copy } from '@/content/en';
import { waitlistOnly } from '@/lib/stores';

/** The welcome screen's chips, in the welcome screen's colours. */
const chipTones = [
  { icon: 'hexagon', cls: 'bg-primary-soft text-on-primary-soft' },
  { icon: 'trophy', cls: 'bg-orange-soft text-orange-text' },
  { icon: 'clubs', cls: 'bg-green-soft text-green-text' },
  { icon: 'lock', cls: 'bg-blue-soft text-blue-text' }
] as const;

export function Hero() {
  const waitlist = waitlistOnly();
  return (
    <section id="top" data-section="hero" className="relative flex min-h-[100svh] items-end overflow-hidden pb-10 pt-28 md:items-center md:pb-20">
      <div aria-hidden className="scrim-left absolute inset-y-0 left-0 hidden w-[68%] md:block" />
      <div aria-hidden className="scrim-bottom absolute inset-x-0 bottom-0 h-[78%] md:hidden" />
      <div className="relative mx-auto w-full max-w-[1280px] px-5 sm:px-8 lg:px-12">
        <p className="t-kicker text-primary">{copy.hero.kicker}</p>
        <HeroLines lines={copy.hero.lines} className="t-hero mt-5 max-w-[8.8em] text-ink" />
        <p className="t-body mt-6 max-w-[44ch] text-muted">{copy.hero.body}</p>
        <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4">
          <StoreButtons placement="hero" />
          <QrCode caption={copy.hero.scan} placement="hero" />
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
          <a href="#how" className="press t-label inline-flex items-center gap-2 rounded-md text-ink">
            {copy.hero.secondary}
            <Icon name="arrow-right" size={18} strokeWidth={2.4} className="text-primary" />
          </a>
          <span className="t-caption text-subtle">{waitlist ? copy.hero.waitlistNote : copy.hero.note}</span>
        </div>
        <ul className="mt-10 hidden flex-wrap gap-2 md:flex" aria-label="What Loopfield does">
          {copy.hero.chips.map((chip, i) => (
            <li key={chip} className={`t-label inline-flex items-center gap-2 rounded-full px-3.5 py-2 ${chipTones[i]!.cls}`}>
              <Icon name={chipTones[i]!.icon} size={16} />
              {chip}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
