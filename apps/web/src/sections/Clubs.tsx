'use client';

import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Lines } from '@/components/Reveal';
import { useStory } from '@/components/useStory';
import { copy } from '@/content/en';
import { beats } from '@/story/world';

const card = copy.clubs.card;

/** A club card in the app's style: cover, hex logo, standings and the club chat. Invented club and runners. */
function ClubCard({ shown }: { shown: boolean }) {
  return (
    <div
      className={`w-full max-w-[360px] overflow-hidden rounded-[24px] bg-surface/95 shadow-[var(--lf-shadow-floating)] ring-1 ring-white/10 backdrop-blur-md transition-[opacity,translate,scale] duration-[var(--dur-sheet)] ease-[var(--ease-sheet)] ${
        shown ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
      }`}
    >
      <div className="relative h-16 bg-[linear-gradient(120deg,#0A74E0_0%,#13263B_70%)] md:h-20">
        <svg aria-hidden className="absolute inset-0 h-full w-full opacity-25" preserveAspectRatio="xMidYMid slice" viewBox="0 0 120 40">
          <defs>
            <pattern id="club-hex" width="10.39" height="18" patternUnits="userSpaceOnUse">
              <path d="M5.2 0 10.39 3v6L5.2 12 0 9V3zM5.2 12v6" fill="none" stroke="#fff" strokeWidth="0.6" />
            </pattern>
          </defs>
          <rect width="120" height="40" fill="url(#club-hex)" />
        </svg>
      </div>
      <div className="relative px-4 pb-4">
        <svg aria-hidden width="56" height="56" viewBox="0 0 24 24" className="absolute -top-8 left-4 drop-shadow-[0_6px_14px_rgba(0,0,0,0.45)]">
          <path d="M12 1.6l9 5.2v10.4l-9 5.2-9-5.2V6.8z" fill="#5AB4FF" stroke="#1C1D22" strokeWidth="1.4" />
          <text x="12" y="15.2" textAnchor="middle" fontSize="7.4" fontWeight="900" fontStyle="italic" fill="#121318">
            NO
          </text>
        </svg>
        <div className="min-w-0 pl-[68px] pt-2.5">
          <p className="t-headline truncate text-ink">{card.name}</p>
          <p className="t-caption text-muted">{card.meta}</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-orange-soft px-3 py-2.5">
            <p className="font-display text-[26px] font-black italic leading-none text-orange-text">{card.standing}</p>
            <p className="t-caption mt-1 text-muted">{card.standingLabel}</p>
          </div>
          <div className="rounded-2xl bg-primary-soft px-3 py-2.5">
            <p className="font-display text-[26px] font-black italic leading-none text-on-primary-soft tabular">{card.cells}</p>
            <p className="t-caption mt-1 text-muted">{card.cellsLabel}</p>
          </div>
        </div>
        <ul className="mt-3 hidden gap-2 md:grid">
          {card.chat.map((m, i) => (
            <li key={m.who} className={`flex items-end gap-2 ${i % 2 ? 'flex-row-reverse' : ''}`}>
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-alt text-[12px] font-extrabold text-ink">{m.who[0]}</span>
              <span className={`t-caption rounded-2xl px-3 py-2 ${i % 2 ? 'rounded-br-md bg-primary-fill text-white' : 'rounded-bl-md bg-surface-alt text-ink'}`}>
                <span className="block text-[11px] font-bold opacity-70">{m.who}</span>
                {m.text}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Five club mates run side by side and their loops tile into one club shape. */
export function Clubs() {
  const [shown, setShown] = useState(false);
  useStory((T) => {
    const s = T >= beats.clubs.claim + 0.02 && T < 5.98;
    if (s !== shown) setShown(s);
  });

  return (
    <section id="clubs" data-section="clubs" className="relative h-[220vh]">
      <div className="sticky top-0 flex h-[100svh] items-end overflow-hidden pb-24 md:items-center md:pb-0">
        <div aria-hidden className="scrim-left absolute inset-y-0 left-0 hidden w-[70%] md:block" />
        <div aria-hidden className="scrim-bottom absolute inset-x-0 bottom-0 h-[80%] md:hidden" />

        <div aria-hidden className="absolute inset-x-5 top-20 z-10 flex justify-center max-md:[@media(max-height:780px)]:hidden sm:inset-x-8 md:inset-x-auto md:bottom-[9%] md:right-[5%] md:top-auto lg:right-[7%]">
          <ClubCard shown={shown} />
        </div>

        <div className="relative mx-auto w-full max-w-[1280px] px-5 sm:px-8 lg:px-12">
          <p className="t-kicker text-blue-text">{copy.clubs.kicker}</p>
          <Lines lines={copy.clubs.lines} className="t-display mt-4 max-w-[9em] text-ink" />
          <p className="t-body mt-6 max-w-[38ch] text-muted">{copy.clubs.body}</p>
          <p className="t-label mt-5 flex max-w-[40ch] items-center gap-2.5 text-ink">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-orange-soft text-orange-text">
              <Icon name="calendar" size={16} />
            </span>
            {copy.clubs.season}
          </p>
          <ul className="mt-7 flex flex-wrap gap-2" aria-label="Rankings">
            {copy.clubs.scopes.map((s) => (
              <li
                key={s}
                className={`t-label rounded-full px-3.5 py-2 ${s === 'Club' ? 'bg-ink text-block-ink' : 'bg-white/[0.06] text-muted ring-1 ring-inset ring-white/10'}`}
              >
                {s}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
