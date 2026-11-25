import Head from 'expo-router/head';

/** Keeps a page out of search engines (live links show where someone is; they are for the people sent them). */
export function NoIndex() {
  return (
    <Head>
      <meta name="robots" content="noindex, nofollow, noarchive" />
      <meta name="referrer" content="no-referrer" />
    </Head>
  );
}
