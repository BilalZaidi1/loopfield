import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Loopfield Console', template: '%s · Loopfield Console' },
  description: 'Back office for the Loopfield app.',
  robots: { index: false, follow: false }
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F5F7F4' },
    { media: '(prefers-color-scheme: dark)', color: '#0E1A14' }
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
