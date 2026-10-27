import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import adonisjs from '@adonisjs/vite/client'

export default defineConfig({
  plugins: [
    tailwindcss(),
    vue(),
    adonisjs({ entryPoints: ['inertia/app.ts'], reload: ['resources/views/**/*.edge'] }),
  ],

  resolve: {
    alias: {
      '~/': `${import.meta.dirname}/inertia/`,
      '@generated': `${import.meta.dirname}/.adonisjs/client/`,
    },
  },

  server: {
    watch: {
      ignored: ['**/storage/**', '**/tmp/**'],
    },
  },
})
