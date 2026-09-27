import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const proxy = { target: 'http://localhost:3001', changeOrigin: true };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy: { '/api': proxy, '/uploads': proxy } }
});
