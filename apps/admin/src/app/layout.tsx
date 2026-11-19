import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
// Figtree, the app's typeface: only the weights the type scale uses (as in apps/mobile/src/theme/fonts.ts).
import '@fontsource/figtree/500.css';
import '@fontsource/figtree/600.css';
import '@fontsource/figtree/700.css';
import '@fontsource/figtree/800.css';
import '@fontsource/figtree/900-italic.css';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Loopfield Console', template: '%s · Loopfield Console' },
  description: 'Back office for the Loopfield app.',
  robots: { index: false, follow: false }
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#EEF0F5' },
    { media: '(prefers-color-scheme: dark)', color: '#101114' }
  ]
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = (await cookies()).get('theme')?.value;
  return (
    <html lang="en" data-theme={theme === 'light' || theme === 'dark' ? theme : undefined}>
      <body>{children}</body>
    </html>
  );
}
