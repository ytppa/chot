import { defineConfig } from 'vite';

/**
 * Defines the browser build entry for the native Web Components frontend.
 */
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: false
  }
});

