-- Etapa 8 (sección 10 y 14): bucket público `exports` con los libros de Excel del pipeline.
-- Lectura pública (las URLs del bucket público); escritura solo con la clave secreta, que no pasa
-- por RLS: no se crea ninguna política de escritura. Tamaño máximo y tipos MIME acotados.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'exports', 'exports', true, 10485760,
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'image/png'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
