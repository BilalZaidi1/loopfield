import Link from 'next/link';
import type { ReactNode } from 'react';
import { LoopMark, Wordmark } from '@/components/LoopMark';
import { PillLink } from '@/components/Pill';
import { copy } from '@/content/en';
import { getHref, waitlistOnly } from '@/lib/stores';
import { Footer } from '@/sections/Footer';

/** The store-required pages share a plain frame: the site's type and colours, no 3D, no smooth scroll. */
export default function PagesLayout({ children }: { children: ReactNode }) {
  const waitlist = waitlistOnly();
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary-fill focus:px-5 focus:py-3 focus:text-white"
      >
        {copy.skip}
      </a>
      <header className="border-b border-white/[0.06]">
        <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between gap-6 px-5 sm:px-8 lg:px-12">
          <Link href="/" className="flex items-center gap-2.5 rounded-md" aria-label="Loopfield home">
            <LoopMark size={30} />
            <Wordmark className="text-[22px] leading-none" />
          </Link>
          <PillLink href={waitlist ? '/#download' : getHref('pages')} size="md">
            {waitlist ? copy.joinWaitlist : copy.getApp}
          </PillLink>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-[760px] px-5 pb-24 pt-16 sm:px-8 md:pt-24">
        {children}
      </main>
      <Footer />
    </>
  );
}
