import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En Docker, API_URL apunta al contenedor de la API (http://api:3000); fuera de Docker, a localhost.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' },
    watch: process.env.VITE_POLLING === 'true' ? { usePolling: true } : undefined, // Docker en Windows
  },
});
