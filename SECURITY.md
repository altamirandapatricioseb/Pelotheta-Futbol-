# Política de seguridad

Pelotheta Θ es un sitio público de solo lectura, sin cuentas de usuario. Si encontrás una
vulnerabilidad, gracias por avisar de forma responsable.

## Cómo reportar

- Abrí un aviso privado en
  [Security → Report a vulnerability](https://github.com/altamirandapatricioseb/Pelotheta-Futbol-/security/advisories/new).
- No abras un issue público ni publiques el detalle hasta que esté corregido.
- Incluí la URL o el archivo, los pasos para reproducirlo y el impacto que ves.

Respuesta inicial en 7 días como máximo. Si el hallazgo se confirma, se corrige y se da crédito a
quien lo reportó (si quiere).

## Alcance

Dentro: `https://pelotheta-futbol.vercel.app`, este repositorio y sus workflows.

Fuera: Vercel, Supabase y GitHub como plataformas (reportalos a ellos), las fuentes de datos de
terceros, ataques de denegación de servicio, ingeniería social y escaneos automáticos masivos.

## Pruebas permitidas

Escaneo pasivo y pruebas manuales que no degraden el servicio ni modifiquen datos. El sitio no
acepta escritura del público: si lográs escribir en la base o en el bucket `exports`, eso es
exactamente lo que queremos saber.

Más detalle del modelo de seguridad en [`docs/security/`](docs/security/).
