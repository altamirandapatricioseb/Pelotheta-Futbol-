import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
    // Cobertura de la lógica (16.7). Lo que solo lee de Supabase o de GitHub se prueba de punta a
    // punta (e2e), no con unidad.
    coverage: {
      include: ['lib/**/*.ts'],
      exclude: ['**/*.test.ts', 'lib/data/**', 'lib/supabase/**', 'lib/database.types.ts'],
      reporter: ['text-summary'],
      thresholds: { lines: 80 },
    },
  },
});
