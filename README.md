# stripe-stats-demo

复刻 stripe.com 首页 "The backbone of global commerce" 统计区块的独立 demo：包含六个时段（Pre-dawn / Sunrise / Daytime / Dusk / Sunset / Night）的场景切换、渐变背景过渡，以及 1:1 还原的 WebGL 数据可视化画布；右上角的时段选择器按钮会在太阳/月亮图标之间平滑变形。

**在线预览**：<https://lnoo.github.io/stripe-stats-demo/>

> 仅供学习交流，视觉与交互版权归 Stripe 所有。

## 本地运行

```bash
bun install
bun run dev        # 开发服务器
bun run build      # 产物构建（dist/）
bun run preview    # 预览构建产物
```

## 技术栈

- Vite + React 19 + TypeScript
- three.js（WebGL 数据可视化，不支持 WebGL 时自动降级为静态图）
- 无其它运行时依赖；样式为纯 CSS（自带全部 design token 变量）

## 结构

```
src/
├── main.tsx                        # 挂载入口
└── features/stripe-stats/
    ├── index.tsx                   # 区块本体（数据、时段状态、渐变背景）
    ├── stripe-stats.css            # 全部样式（含 --hds-* / --stats-* 变量）
    ├── time-of-day-select.tsx      # 太阳/月亮变形的时段选择器
    └── dataviz/
        ├── animation.ts            # 时段调色板与缓动工具
        ├── manager.ts              # WebGL 渲染循环管理器
        ├── scenes.ts               # 四个统计场景（支付量/订阅/在线率/支付方式）
        ├── shaders.ts              # GLSL 着色器
        └── data-viz.tsx            # React 包装组件与 hooks
```

## 部署

推送到 `main` 分支后，GitHub Actions（`.github/workflows/deploy.yml`）自动构建并发布到 GitHub Pages。
