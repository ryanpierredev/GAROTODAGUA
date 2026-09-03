import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Cota D’Água — Gestão de garrafões',
  description: 'Controle de estoque, cotistas, pagamentos e créditos da sua cota de água.',
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
  openGraph: {
    title: 'Cota D’Água — Gestão de garrafões',
    description: 'Gestão simples, água em dia.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Cota D’Água' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Cota D’Água — Gestão de garrafões',
    description: 'Gestão simples, água em dia.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body></html>;
}
