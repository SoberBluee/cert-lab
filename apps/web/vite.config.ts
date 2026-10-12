import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = `http://127.0.0.1:${process.env.CKA_PORT ?? 4317}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': { target: api, changeOrigin: true, ws: true } },
  },
});
