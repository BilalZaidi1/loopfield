'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Lines } from '@/components/Reveal';
import { copy } from '@/content/en';
import { track } from '@/lib/analytics';

type Item = (typeof copy.faq.items)[number];

function Answer({ item }: { item: Item }) {
  if (!('link' in item)) return <>{item.a}</>;
  const [before, after] = item.a.split(item.link.text);
  return (
    <>
      {before}
      <Link href={item.link.href} className="font-semibold text-ink underline decoration-primary decoration-2 underline-offset-4">
        {item.link.text}
      </Link>
      {after}
    </>
  );
}

/** An accordion that opens on the app's sheet spring. */
export function Faq() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section id="faq" data-section="faq" className="relative py-28 md:py-36">
      <div className="relative mx-auto grid w-full max-w-[1280px] gap-10 px-5 sm:px-8 md:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] md:gap-16 lg:px-12">
        <div>
          <p className="t-kicker text-primary">{copy.faq.kicker}</p>
          <Lines lines={[copy.faq.title]} className="mt-4 font-display text-[clamp(40px,4.6vw,72px)] font-black uppercase italic leading-[0.94] tracking-[-0.03em] text-ink" />
        </div>
        <ul className="border-y border-white/[0.08]">
          {copy.faq.items.map((item) => {
            const isOpen = open === item.id;
            return (
              <li key={item.id} className="border-b border-white/[0.08] last:border-b-0">
                <h3>
                  <button
                    type="button"
                    id={`faq-q-${item.id}`}
                    aria-expanded={isOpen}
                    aria-controls={`faq-a-${item.id}`}
                    onClick={() => {
                      setOpen(isOpen ? null : item.id);
                      if (!isOpen) track('faq_open', { question: item.id });
                    }}
                    className="group flex min-h-16 w-full items-center justify-between gap-6 rounded-md py-5 text-left"
                  >
                    <span className="t-headline text-ink">{item.q}</span>
                    <span
                      className={`grid size-9 shrink-0 place-items-center rounded-full transition-[background-color,rotate] duration-[var(--dur-sheet)] ease-[var(--ease-sheet)] ${
                        isOpen ? 'rotate-45 bg-primary-fill text-white' : 'bg-white/[0.06] text-ink group-hover:bg-white/[0.1]'
                      }`}
                    >
                      <Icon name="plus" size={18} strokeWidth={2.4} />
                    </span>
                  </button>
                </h3>
                <div
                  id={`faq-a-${item.id}`}
                  role="region"
                  aria-labelledby={`faq-q-${item.id}`}
                  inert={!isOpen}
                  className="grid transition-[grid-template-rows] duration-[var(--dur-sheet)] ease-[var(--ease-sheet)]"
                  style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
                >
                  <div className="overflow-hidden">
                    <p className="t-body max-w-[60ch] pb-6 pr-12 text-muted">
                      <Answer item={item} />
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
