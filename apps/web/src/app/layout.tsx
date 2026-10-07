import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
