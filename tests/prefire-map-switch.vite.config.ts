import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  publicDir: false,
  cacheDir: 'node_modules/.vite-prefire-map-switch',
  optimizeDeps: {noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'three', 'lucide-react', '@dimforge/rapier3d-compat']},
  plugins: [{name: 'prefire-map-switch-stage', enforce: 'pre', resolveId(source, importer) {
    if (source === '../duel/DuelStage' && importer?.replace(/\\/g, '/').endsWith('/prefire/PrefirePractice.tsx'))
      return fileURLToPath(new URL('./prefire-map-switch-stage.tsx', import.meta.url));
  }}, react()],
});
