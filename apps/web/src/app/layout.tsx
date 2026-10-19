import type { Metadata, Viewport } from 'next';
import { Gowun_Batang, Instrument_Sans } from 'next/font/google';
import type { ReactNode } from 'react';

import './globals.css';

// Titles in a Korean serif, like the 간 mark; everything else in a quiet grotesque. The serif comes
// in ~90 unicode-range slices (Hangul): not preloaded, so a page fetches only the slices it shows.
const display = Gowun_Batang({ weight: ['400', '700'], subsets: ['latin'], variable: '--font-display', display: 'swap', preload: false });
const ui = Instrument_Sans({ subsets: ['latin'], variable: '--font-ui', display: 'swap' });

export const metadata: Metadata = {
  title: 'Kanso',
  description: 'A quiet manga reader.',
  appleWebApp: { capable: true, title: 'Kanso', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  themeColor: '#0e0e10',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable}`}>
      <body>{children}</body>
    </html>
  );
}
