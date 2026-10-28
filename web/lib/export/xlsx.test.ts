import { describe, expect, it } from 'vitest';

import { buildXlsx, columnName, crc32 } from './xlsx';

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('libro de Excel', () => {
  it('CRC-32 estándar', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
  });

  it('nombres de columna como en Excel', () => {
    expect([0, 25, 26, 27, 701].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ']);
  });

  it('arma un zip con la hoja, los textos escapados y los números como números', () => {
    const bytes = buildXlsx([
      {
        name: 'Comparación',
        rows: [
          ['Ataque', null],
          ['Goles <cada 90>', 0.5],
        ],
        boldRows: [0],
      },
    ]);
    expect(text(bytes.slice(0, 2))).toBe('PK');
    const all = text(bytes);
    expect(all).toContain('xl/worksheets/sheet1.xml');
    expect(all).toContain('<sheet name="Comparación" sheetId="1" r:id="rId1"/>');
    expect(all).toContain('Goles &lt;cada 90&gt;');
    expect(all).toContain('<c r="B2"><v>0.5</v></c>');
    expect(all).toContain('<c r="A1" t="inlineStr" s="1">');
  });

  it('acorta el nombre de la hoja a 31 caracteres sin los símbolos prohibidos', () => {
    const all = text(buildXlsx([{ name: 'Una hoja: con / símbolos * y un nombre muy largo', rows: [] }]));
    expect(all).toContain('<sheet name="Una hoja con  símbolos  y un no"');
  });
});
