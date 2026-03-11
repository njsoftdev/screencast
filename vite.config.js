import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { execSync } from 'child_process';

function copyExtensionPlugin() {
  return {
    name: 'copy-extension',
    closeBundle() {
      execSync('node scripts/copy-extension.mjs', { stdio: 'inherit', cwd: resolve(__dirname) });
    },
  };
}

export default defineConfig({
  plugins: [react(), copyExtensionPlugin()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'popup-src.html'),
      output: {
        entryFileNames: 'popup-[name].js',
        chunkFileNames: 'popup-[name].js',
        assetFileNames: 'popup-[name].[ext]',
      },
    },
  },
});
