import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    proxy: {
      '/__sample_downloads': {
        target: 'https://docs.influxdata.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/__sample_downloads/, '/downloads')
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'echarts-vendor': ['echarts', 'echarts-for-react'],
          'lucide': ['lucide-react']
        }
      }
    }
  }
})
