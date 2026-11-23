import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// WebXR requires a secure context. `npm run dev:lan` serves over self-signed
// HTTPS so a headset on the same network can open the dev server.
export default defineConfig(({ command }) => ({
  base: './',
  plugins: command === 'serve' && process.argv.includes('--host') ? [basicSsl()] : [],
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 }, // Rapier embeds its WASM
}));
