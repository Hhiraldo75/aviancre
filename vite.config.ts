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
})
