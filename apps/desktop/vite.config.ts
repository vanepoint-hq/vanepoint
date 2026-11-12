import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Two pages: the main window and the transparent laser/dial overlay.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'es2021',
    outDir: 'dist',
    rollupOptions: {
      input: { main: here('./index.html'), overlay: here('./overlay.html') },
    },
  },
});
