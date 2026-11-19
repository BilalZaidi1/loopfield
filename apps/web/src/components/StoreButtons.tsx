'use client';

import { site, type StoreState } from '@/config/site';
import { copy } from '@/content/en';
import { track } from '@/lib/analytics';
import { getHref, waitlistOnly, type StorePlatform } from '@/lib/stores';
import { PillLink } from './Pill';

type LiveState = Exclude<StoreState, 'waitlist'>;

const labels: Record<StorePlatform, Record<LiveState, string>> = {
  ios: { preorder: 'Pre-order for iPhone', live: 'Download for iPhone' },
  android: { preorder: 'Pre-register on Android', live: 'Get it for Android' }
};

/** Official artwork goes in public/badges (see the README there); file names per store and state. */
const badges: Record<StorePlatform, Record<LiveState, { src: string; alt: string }>> = {
  ios: {
    preorder: { src: '/badges/app-store-preorder.svg', alt: 'Pre-order on the App Store' },
    live: { src: '/badges/app-store.svg', alt: 'Download on the App Store' }
  },
  android: {
    preorder: { src: '/badges/google-play-preregister.svg', alt: 'Pre-register on Google Play' },
    live: { src: '/badges/google-play.svg', alt: 'Get it on Google Play' }
  }
};

/**
 * Store buttons for one placement. App Store first (Apple's rule when other badges sit beside it); each phone sees
 * only its own store. Official badges are never animated or restyled; until their files are in place the buttons
 * are Loopfield's own pills, which carry no Apple or Google marks. Every click goes through /get.
 */
export function StoreButtons({ placement, className, onBlock = false }: { placement: string; className?: string; onBlock?: boolean }) {
  if (waitlistOnly()) {
    return (
      <div className={className}>
        <PillLink
          href="#download"
          variant={onBlock ? 'light' : 'primary'}
          onClick={() => track('store_click', { platform: 'waitlist', placement, state: 'waitlist' })}
        >
          {copy.joinWaitlist}
        </PillLink>
      </div>
    );
  }

  const platforms: StorePlatform[] = ['ios', 'android'];
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className ?? ''}`}>
      {platforms.map((p) => {
        const state = p === 'ios' ? site.ios.state : site.android.state;
        if (state === 'waitlist') return null;
        const href = getHref(placement, p);
        const onClick = () => track('store_click', { platform: p, placement, state });
        if (site.officialBadges) {
          const b = badges[p][state];
          return (
            <a key={p} data-store={p} href={href} onClick={onClick} className="-m-3 inline-block p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- official artwork, shown exactly as supplied */}
              <img src={b.src} alt={b.alt} className="h-12 w-auto" height={48} />
            </a>
          );
        }
        const variant = onBlock ? (p === 'ios' ? 'light' : 'ink') : p === 'ios' ? 'primary' : 'ghost';
        return (
          <PillLink key={p} data-store={p} href={href} onClick={onClick} variant={variant}>
            {labels[p][state]}
          </PillLink>
        );
      })}
    </div>
  );
}
