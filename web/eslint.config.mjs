import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import tseslint from 'typescript-eslint';

// Configuración plana de ESLint 9 (sección 3): reglas de Next.js, typescript-eslint en modo
// estricto con información de tipos y accesibilidad (jsx-a11y).
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  ...tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: ['**/*.{ts,tsx}'] })),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // El plugin jsx-a11y ya lo registra eslint-config-next: acá solo se suben sus reglas
    // recomendadas completas (Next.js trae un subconjunto).
    files: ['**/*.{ts,tsx}'],
    rules: { ...jsxA11y.flatConfigs.recommended.rules },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'node_modules/**']),
]);
