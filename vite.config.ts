import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // City of Providence public GIS (parcels, zoning, flood). Proxied so the
      // browser doesn't depend on the city server's CORS settings.
      '/pvdgis': {
        target: 'https://webgis.providenceri.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/pvdgis/, ''),
      },
    },
  },
})
