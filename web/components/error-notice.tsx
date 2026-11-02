import { articleUrl, ERRORS, type ErrorCode } from '@/lib/errors';

/** Aviso de error con su código estable y el enlace al artículo de soporte (16.6). */
export function ErrorNotice({ code }: { code: ErrorCode }) {
  const { message, hint } = ERRORS[code];
  return (
    <div role="alert" className="under-construction">
      <p className="font-bold">
        {code}: {message}
      </p>
      <p className="text-muted">
        {hint}{' '}
        <a href={articleUrl(code)} className="focus-ring underline">
          Qué significa este código
        </a>
      </p>
    </div>
  );
}
