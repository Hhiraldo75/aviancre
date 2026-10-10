import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// City of Providence public GIS (parcels, zoning, flood). Proxied so the
// browser doesn't depend on the city server's CORS settings. In production
// vercel.json sends the same /pvdgis URLs to the api/pvdgis.ts relay.
const proxy: Record<string, ProxyOptions> = {
  '/pvdgis': {
    target: 'https://webgis.providenceri.gov',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/pvdgis/, ''),
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy },
  preview: { proxy },
  build: {
    // MapLibre ships as one prebuilt, minified bundle (~1,050 kB) that can't be
    // split further; any other chunk this large still triggers the warning.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        // Libraries in their own long-cached chunks, apart from the app code.
        manualChunks(id) {
          if (id.includes('/node_modules/maplibre-gl/')) return 'maplibre'
          if (/\/node_modules\/(react|react-dom|scheduler|zustand)\//.test(id)) return 'react'
        },
      },
    },
  },
})
