// Cookie del equipo elegido en el selector (/elegir): la leen todas las interfaces y el header.
// Sin cookie, o con un valor que no es un id de club, se muestra Boca.
export const TEAM_COOKIE = 'equipo';
export const BOCA_UID = 'arg-boca-juniors';
export const CLUB_UID_RE = /^[a-z]{3}-[a-z0-9-]{1,80}$/;
