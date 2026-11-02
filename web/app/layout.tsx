import type { Metadata } from 'next';
import { Montserrat, Noto_Sans } from 'next/font/google';
import { cookies } from 'next/headers';
import Link from 'next/link';

import { SystemMark, TeamMark } from '@/components/header/brand-marks';
import { SiteHeader } from '@/components/header/site-header';
import { MotionProvider } from '@/components/motion-provider';
import { ReportDataLink } from '@/components/report-data-link';
import { THEME_COOKIE } from '@/lib/theme';
import { SITE_DESCRIPTION, SYSTEM_NAME } from '@/config/brand';

import './globals.css';

// next/font descarga las fuentes en el build y las sirve desde el propio sitio:
// no hay requests a Google desde el navegador del visitante (privacidad y CSP 'self').
const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-montserrat',
  display: 'swap',
});

// Respaldo solo para letras griegas (Θ del nombre, α, β y λ de las métricas).
const greek = Noto_Sans({
  subsets: ['greek'],
  weight: ['400', '700', '800'],
  variable: '--font-greek',
  display: 'swap',
});

// Render dinámico en todas las páginas: lo exige el nonce de la CSP, que cambia en cada
// request. Los datos igual se cachean 6 horas (ver lib/supabase/server.ts).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: SYSTEM_NAME, template: `%s · ${SYSTEM_NAME}` },
  description: SITE_DESCRIPTION,
  robots: { index: true, follow: true },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Tema elegido con el botón del header; sin cookie, manda la preferencia del sistema.
  const saved = (await cookies()).get(THEME_COOKIE)?.value;
  const theme = saved === 'dark' || saved === 'light' ? saved : undefined;
  return (
    <html lang="es-AR" className={`${montserrat.variable} ${greek.variable}`} data-theme={theme}>
      <body className="antialiased">
        <a href="#contenido" className="skip-link">
          Saltar al contenido
        </a>
        <MotionProvider>
          <SiteHeader teamMark={<TeamMark />} systemMark={<SystemMark />} />
          <main id="contenido" className="page" tabIndex={-1}>
            {children}
          </main>
        </MotionProvider>
        <footer className="page pt-0 pb-10 text-sm text-muted">
          Proyecto de portfolio sin fines comerciales. Datos de partidos: Promiedos (estadísticas de Opta). Las
          interfaces se publican por etapas.{' '}
          <Link href="/privacidad" className="focus-ring underline">
            Privacidad
          </Link>{' '}
          ·{' '}
          <Link href="/estado" className="focus-ring underline">
            Estado
          </Link>{' '}
          ·{' '}
          <Link href="/api-docs" className="focus-ring underline">
            API
          </Link>{' '}
          · <ReportDataLink />
        </footer>
      </body>
    </html>
  );
}
