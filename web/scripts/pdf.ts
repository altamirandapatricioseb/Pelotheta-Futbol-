// PDF único de entrega (sección 15): imprime docs/entrega/documentacion.html (lo arma scripts/entrega.py)
// con números de página. `node scripts/pdf.ts` desde web/; lo corre `just docs`.
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from '@playwright/test';

const DIR = fileURLToPath(new URL('../../docs/entrega/', import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(`${DIR}documentacion.html`).href, { waitUntil: 'networkidle' });
const broken = await page.$$eval('img', (imgs) => imgs.filter((i) => i.naturalWidth === 0).map((i) => i.src));
if (broken.length) console.warn(`Imágenes que no cargaron: ${broken.join(', ')}`);
await page.pdf({
  path: `${DIR}Pelotheta_documentacion.pdf`,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate:
    '<div style="font-size:8px;width:100%;text-align:center;color:#666">Pelotheta Θ · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
});
await browser.close();
console.log(`PDF en ${DIR}Pelotheta_documentacion.pdf`);
