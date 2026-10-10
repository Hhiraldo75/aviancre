import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
