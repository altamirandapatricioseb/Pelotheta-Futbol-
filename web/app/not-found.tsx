import Link from 'next/link';

import { ErrorNotice } from '@/components/error-notice';

export default function NotFound() {
  return (
    <div className="grid gap-4">
      <h1 className="page-title">Página no encontrada</h1>
      <ErrorNotice code="PEL-NF-404" />
      <Link href="/" className="focus-ring font-semibold text-link hover:underline">
        Volver al inicio
      </Link>
    </div>
  );
}
