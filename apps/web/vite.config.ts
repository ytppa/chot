import { defineConfig } from 'vite';

/**
 * Defines the browser build entry for the native Web Components frontend.
 */
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    allowedHosts: ['127.0.0.1', 'localhost', 'chat.local'],
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/ws': {
        target: 'ws://127.0.0.1:3000',
        ws: true
      }
    }
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: false
  }
});
