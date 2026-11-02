// Rutas que solo piden los escáneres automáticos (WordPress, PHP, archivos de configuración, git).
// El sitio no tiene ninguna: el proxy responde 404 sin renderizar nada, lo que ahorra cómputo de
// Vercel y deja esas sondas fuera de los logs de la aplicación. Reemplaza las reglas del Vercel
// Firewall, que en el plan Hobby son limitadas (14.5, docs/security/fuera_de_alcance.md).
const SCANNER_PATH =
  /(^|\/)(wp-admin|wp-login|wp-content|wp-includes|wordpress|xmlrpc|phpmyadmin|pma|cgi-bin|\.git|\.svn|\.hg|\.env|\.aws|\.ssh|\.DS_Store|server-status|vendor\/phpunit)(\/|$|\.)|\.(php\d?|aspx?|jsp|cgi|sql|bak|old|swp|ini|config|yml|yaml|env)$/i;

export function isScannerPath(pathname: string): boolean {
  // security.txt es la única ruta oculta legítima del sitio.
  if (pathname.startsWith('/.well-known/')) return false;
  return SCANNER_PATH.test(pathname);
}
