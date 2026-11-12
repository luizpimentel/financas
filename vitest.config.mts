import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
      'react-native': path.resolve(rootDir, 'src/tests/mocks/react-native.tsx'),
      'react-native-safe-area-context': path.resolve(
        rootDir,
        'src/tests/mocks/react-native-safe-area-context.tsx',
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
