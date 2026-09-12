import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  publicDir: 'public/revamp',
  server: { watch: { ignored: ['**/research/**', '**/art/**', '**/.local-tools/**'] } },
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'json-summary']
    }
  }
});
