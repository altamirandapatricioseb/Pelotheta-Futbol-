import type { Metadata } from 'next';

import { ERRORS, type ErrorCode } from '@/lib/errors';

export const metadata: Metadata = {
  description: 'Qué significa cada código de error de Pelotheta Θ y qué hacer.',
};

/** Base de conocimiento pública (16.6): cada código de error, sus causas y qué hacer. */
export default function Page() {
  return (
    <div className="grid max-w-[70ch] gap-6">
      <h1 className="page-title">
        <span className="title-trace">Soporte</span>
      </h1>
      <p>
        Cada error del sitio muestra un código estable. Acá está qué significa, por qué pasa y qué hacer. El estado en
        vivo del sistema está en{' '}
        <a href="/estado" className="focus-ring font-semibold text-link underline">
          /estado
        </a>
        .
      </p>
      {(Object.keys(ERRORS) as ErrorCode[]).map((code) => {
        const e = ERRORS[code];
        return (
          <section key={code} id={code} className="grid scroll-mt-24 gap-2">
            <h2 className="text-xl font-bold">
              <code>{code}</code> · {e.title}
            </h2>
            <p className="text-muted">{e.hint}</p>
            <h3 className="font-bold">Causas habituales</h3>
            <ul className="list-disc space-y-1 pl-5">
              {e.causes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <h3 className="font-bold">Qué hacer</h3>
            <ul className="list-disc space-y-1 pl-5">
              {e.fix.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
