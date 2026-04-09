import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000', // бэкенд; если на 8001 — поменяйте на :8001
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'pdfjs-dist'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdfjs-dist')) return 'pdfjs'
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'react-vendor'
          if (id.includes('node_modules/react-router')) return 'router'
          if (id.includes('@headlessui')) return 'headlessui'
        },
      },
    },
    chunkSizeWarningLimit: 650,
  },
})
