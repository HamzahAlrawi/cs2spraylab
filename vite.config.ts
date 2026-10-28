import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({mode}) => ({
  publicDir: 'public/revamp',
  // Keep the live server's dependency URLs independent of test/build cache work.
  cacheDir: mode === 'development' ? 'node_modules/.vite-dev' : 'node_modules/.vite',
  // Authoring/research HTML is not an application entry point.
  optimizeDeps: {entries: ['index.html'], include: [
    'three/examples/jsm/libs/meshopt_decoder.module.js',
    'three/examples/jsm/loaders/GLTFLoader.js',
    'three/examples/jsm/loaders/FBXLoader.js',
    'three/examples/jsm/environments/RoomEnvironment.js',
    'three/examples/jsm/utils/SkeletonUtils.js',
    'three/examples/jsm/utils/BufferGeometryUtils.js',
    '@dimforge/rapier3d-compat',
  ]},
  server: { watch: { ignored: ['**/research/**', '**/art/**', '**/.local-tools/**'] } },
  plugins: [react()],
  test: {
    environment: 'node',
    maxWorkers: 4,
    include: ['src/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'json-summary']
    }
  }
}));
