import { FinalStage } from '@/components/FinalStage';
import { QrCode } from '@/components/QrCode';
import { Lines } from '@/components/Reveal';
import { StoreButtons } from '@/components/StoreButtons';
import { WaitlistForm } from '@/components/WaitlistForm';
import { requirementsLine } from '@/config/site';
import { copy } from '@/content/en';
import { waitlistOnly } from '@/lib/stores';

/** The camera pulls back over a city-wide patchwork at first light; one violet patch pulses: that's you. */
export function FinalCall() {
  const waitlist = waitlistOnly();
  return (
    <section id="download" data-section="final" className="relative h-[260vh]">
      <div className="sticky top-0 h-[100svh] overflow-hidden pb-6 pt-20 sm:pb-8">
        <FinalStage
          headline={
            <Lines
              lines={copy.final.lines}
              className="font-display text-[clamp(42px,6.6vw,108px)] font-black uppercase italic leading-[0.92] tracking-[-0.035em] text-white [@media(max-height:760px)]:text-[clamp(38px,5.4vw,84px)]"
            />
          }
        >
          <p className="t-body mt-6 max-w-[34ch] text-white/90 sm:text-[20px] sm:leading-[30px]">{waitlist ? copy.final.waitlistBody : copy.final.body}</p>
          {waitlist ? (
            <div className="mt-8 flex w-full justify-center text-left">
              <WaitlistForm source="final" />
            </div>
          ) : (
            <div className="mt-9 flex flex-wrap items-center justify-center gap-x-7 gap-y-4">
              <StoreButtons placement="final" onBlock className="justify-center" />
              <QrCode caption={copy.hero.scan} placement="final" onBlock />
            </div>
          )}
          <p className="t-caption mt-7 text-white/75">{requirementsLine}</p>
        </FinalStage>
      </div>
    </section>
  );
}
