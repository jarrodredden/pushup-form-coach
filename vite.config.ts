import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const offline = mode === 'offline';
  return {
    // Relative paths let the same build run from a Vercel root, a GitHub Pages subpath, or an unzipped folder.
    base: './',
    plugins: [react()],
    server: {
      host: '0.0.0.0',
    },
    build: offline
      ? {
          outDir: 'dist-offline',
          emptyOutDir: true,
          copyPublicDir: false,
          modulePreload: false,
          cssCodeSplit: false,
          chunkSizeWarningLimit: 2000,
          rollupOptions: { output: { inlineDynamicImports: true } },
        }
      : undefined,
  };
});
