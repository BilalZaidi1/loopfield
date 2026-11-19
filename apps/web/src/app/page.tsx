import { Analytics } from '@/components/Analytics';
import { Header } from '@/components/Header';
import { SmoothScroll } from '@/components/SmoothScroll';
import { Stage } from '@/components/Stage';
import { StickyGetApp } from '@/components/StickyGetApp';
import { StoryDriver } from '@/components/StoryDriver';
import { site } from '@/config/site';
import { copy } from '@/content/en';
import { storeLink } from '@/lib/stores';
import { AppTour } from '@/sections/AppTour';
import { Clubs } from '@/sections/Clubs';
import { Faq } from '@/sections/Faq';
import { FinalCall } from '@/sections/FinalCall';
import { Footer } from '@/sections/Footer';
import { Hero } from '@/sections/Hero';
import { HowItWorks } from '@/sections/HowItWorks';
import { Privacy } from '@/sections/Privacy';
import { Progress } from '@/sections/Progress';
import { Rivals } from '@/sections/Rivals';
import { RouteTitles } from '@/sections/RouteTitles';
import { YourTurn } from '@/sections/YourTurn';
import { buildField, FIELD_RADIUS } from '@/story/world';

/** Structured data for the app, with no rating until real ratings exist. */
function appJsonLd() {
  const downloads = [storeLink('ios', 'jsonld'), storeLink('android', 'jsonld')].filter((u): u is string => Boolean(u));
  return {
    '@context': 'https://schema.org',
    '@type': 'MobileApplication',
    name: site.name,
    description: copy.meta.description,
    url: site.url,
    applicationCategory: 'SportsApplication',
    operatingSystem: `iOS ${site.ios.minOs} or later, Android ${site.android.minOs} or later`,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: { '@type': 'Organization', name: site.publisher },
    ...(downloads.length ? { downloadUrl: downloads } : {})
  };
}

export default function Home() {
  // The same deterministic field the 3D draws, so the page quotes the numbers the scene shows.
  const { stats } = buildField(FIELD_RADIUS.small);
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary-fill focus:px-5 focus:py-3 focus:text-white"
      >
        {copy.skip}
      </a>
      <Stage />
      <Header />
      <main id="main" className="relative z-10">
        <Hero />
        <HowItWorks cells={stats.loopA} />
        <YourTurn />
        <Rivals lost={stats.lost} reclaimed={stats.reclaimed} />
        <RouteTitles />
        <Clubs />
        <Progress />
        <Privacy />
        <AppTour />
        <FinalCall />
        <Faq />
      </main>
      <div className="relative z-10">
        <Footer onHome />
      </div>
      <StickyGetApp />
      <StoryDriver />
      <SmoothScroll />
      <Analytics />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(appJsonLd()).replace(/</g, '\\u003c') }} />
    </>
  );
}
