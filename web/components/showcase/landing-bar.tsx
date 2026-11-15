import Link from 'next/link';

import { ThemeToggle } from '@/components/header/theme-toggle';
import { SYSTEM_LOGO_SRC, SYSTEM_NAME } from '@/config/brand';

/** Barra mínima de la portada y el selector: la marca del sistema (vuelve a la portada) y el tema. */
export function LandingBar({ action }: { action?: React.ReactNode }) {
  return (
    <div className="show-bar">
      <Link href="/" className="show-bar__brand focus-ring">
        {SYSTEM_LOGO_SRC ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo local en SVG
          <img src={SYSTEM_LOGO_SRC} alt="" width={32} height={32} />
        ) : null}
        <span>{SYSTEM_NAME}</span>
      </Link>
      <div className="show-bar__end">
        {action}
        <ThemeToggle />
      </div>
    </div>
  );
}
