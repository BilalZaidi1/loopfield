import { FinalStage } from '@/components/FinalStage';
import { QrCode } from '@/components/QrCode';
import { Lines } from '@/components/Reveal';
import { StoreButtons } from '@/components/StoreButtons';
import { WaitlistForm } from '@/components/WaitlistForm';
import { requirementsLine } from '@/config/site';
import { copy } from '@/content/en';
import { waitlistOnly } from '@/lib/stores';
import { finalCall } from '@/story/world';

/** The camera pulls back over a city-wide patchwork at first light; one violet patch pulses: that's you. */
export function FinalCall() {
  const waitlist = waitlistOnly();
  return (
    <section data-section="final" className="relative" style={{ height: `${finalCall.heightVh}vh` }}>
      {/* Links to #download land here, with the form showing. Lenis lands 64px above an anchor and a plain jump lands on
          it, so the extra 32px puts both inside the open, pinned stretch. Placed before the stage, so Tab goes to the form. */}
      <span id="download" aria-hidden="true" className="pointer-events-none absolute left-0 h-px w-px" style={{ top: `calc(${finalCall.landVh}vh + 32px)` }} />
      <div className="sticky top-0 h-[100svh] overflow-hidden pb-6 pt-20 sm:pb-8">
        <FinalStage
          headline={
            <Lines
              lines={copy.final.lines}
              className="font-display text-[clamp(38px,min(6.6vw,12svh),108px)] font-black uppercase italic leading-[0.92] tracking-[-0.035em] text-white"
            />
          }
        >
          <p className="t-body mt-4 max-w-[34ch] text-white/90 sm:mt-5 sm:text-[20px] sm:leading-[30px] [@media(max-height:640px)]:mt-3">{waitlist ? copy.final.waitlistBody : copy.final.body}</p>
          {waitlist ? (
            <div className="mt-6 flex w-full justify-center text-left md:mt-8 [@media(max-height:640px)]:mt-4">
              <WaitlistForm placement="final" />
            </div>
          ) : (
            <div className="mt-7 flex flex-wrap items-center justify-center gap-x-7 gap-y-4 md:mt-9 [@media(max-height:640px)]:mt-5">
              <StoreButtons placement="final" onBlock className="justify-center" />
              <QrCode caption={copy.hero.scan} placement="final" onBlock />
            </div>
          )}
          <p className="t-caption mt-5 text-white/75 md:mt-6 [@media(max-height:640px)]:mt-3">{requirementsLine}</p>
        </FinalStage>
      </div>
    </section>
  );
}
