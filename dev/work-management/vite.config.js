import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5177,
    proxy: {
      // API real da plataforma (auth + domínios live do Work Management)
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/auth': { target: 'http://localhost:3001', changeOrigin: true },
      '/system': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
