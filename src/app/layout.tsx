import type { Metadata } from 'next';
import './globals.css';
import { THEME_BOOT } from '@/components/theme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Guardrail Pricing',
  description: 'Guardrail pricing calculator and per-user quote dashboard',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
