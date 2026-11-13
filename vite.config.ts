import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 项目站点部署在 https://<owner>.github.io/stripe-stats-demo/ 子路径下，
// base 必须与仓库名一致，静态资源才能正确加载。
export default defineConfig({
  base: '/stripe-stats-demo/',
  plugins: [react()],
})
