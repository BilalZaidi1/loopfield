import { Icon } from '@/components/Icon';
import { FadeUp, Lines } from '@/components/Reveal';
import { copy } from '@/content/en';

/** The scene goes still and soft: only the shapes of land remain, never the path. */
export function Privacy() {
  return (
    <section id="privacy" data-section="privacy" className="relative py-28 md:py-40">
      <div className="relative mx-auto w-full max-w-[1280px] px-5 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-[780px] text-center">
          <p className="t-kicker text-on-primary-soft">{copy.privacy.kicker}</p>
          <Lines lines={copy.privacy.lines} className="t-display mt-4 text-ink" />
          <p className="t-body mx-auto mt-6 max-w-[42ch] text-ink/85">{copy.privacy.lead}</p>
        </div>
        <ul className="mt-14 grid gap-3 sm:grid-cols-2 md:mt-20 lg:grid-cols-3">
          {copy.privacy.cards.map((c, i) => (
            <FadeUp key={c.title} as="li" delay={(i % 3) * 90}>
              <div className="h-full rounded-[24px] bg-surface/80 p-6 ring-1 ring-white/[0.08] backdrop-blur-xl transition-transform duration-300 hover:-translate-y-0.5 sm:p-7">
                <span className="grid size-11 place-items-center rounded-full bg-primary-soft text-on-primary-soft">
                  <Icon name={c.icon} size={20} />
                </span>
                <h3 className="t-headline mt-5 text-ink">{c.title}</h3>
                <p className="mt-2 text-[16px] leading-6 text-muted">{c.body}</p>
              </div>
            </FadeUp>
          ))}
        </ul>
      </div>
    </section>
  );
}
