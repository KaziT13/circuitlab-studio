import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.OHMLAB_BACKEND_URL ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    // the backend owns /api; in dev Vite forwards it so the browser stays same-origin
    proxy: { '/api': { target: backend, changeOrigin: true } },
  },
});
