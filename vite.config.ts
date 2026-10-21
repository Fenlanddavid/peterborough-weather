import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), {
    // satellite.js 7.1.0's barrel re-exports optional WASM workers. We use only its JS API;
    // prune that unused export before Vite's worker scan (which otherwise fails on TLA).
    name: 'satellite-js-without-unused-wasm',
    transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/satellite.js/dist/index.js')) return code.replace(/export \* from ['"]\.\/wasm\/index\.js['"];?/, '');
    },
  }],
  base: './', // relative paths for GitHub Pages
  build: { manifest: 'asset-manifest.json' },
})
