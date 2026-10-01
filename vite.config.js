import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Die Funk-Aufnahmen kommen ohne CORS-Header von livetiming.formula1.com. Über diesen Proxy kann der Browser sie
// für Wellenform und Transkription lesen (Abspielen geht auch ohne). Siehe audioUrl() mit proxy = 'local'.
const f1static = { '/f1static': { target: 'https://livetiming.formula1.com', changeOrigin: true, rewrite: (p) => p.replace(/^\/f1static/, '') } };

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 8080, proxy: f1static },
  preview: { proxy: f1static },
  test: { environment: 'node', include: ['test/**/*.test.{js,jsx}'] },
});
