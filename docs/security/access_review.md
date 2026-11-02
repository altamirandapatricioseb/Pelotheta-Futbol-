# Revisión de accesos

Trimestral. Próxima: febrero de 2027.

## 2-nov-2026

| Cuenta o clave | Quién accede | Dónde vive | Última rotación |
|---|---|---|---|
| GitHub (repositorio y Actions) | Dueño | — | — |
| Vercel | Dueño | — | — |
| Supabase (panel) | Dueño | — | — |
| Clave secreta de Supabase | Pipeline | GitHub Secrets, `.env` local | Sin rotar (R01, decisión del dueño) |
| Clave publicable de Supabase | Web, keepalive, test de RLS | Vercel, GitHub Secrets | No requiere (pública) |
| Token de GitHub del botón Actualizar | Web | Vercel (fine-grained, solo Actions de este repositorio) | Al crearlo |
| StrikerAPI, Bzzoiro, API-Football | Pipeline | GitHub Secrets, `.env` local | Sin rotar (R01) |
| `powerbi_reader` | Power BI del dueño | Contraseña fuera del repositorio | Sin login hasta que el dueño la active |

Pendiente del dueño: confirmar 2FA (passkey o TOTP) en GitHub, Vercel y Supabase y guardar los
códigos de recuperación fuera de línea.
