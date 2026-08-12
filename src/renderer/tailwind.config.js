/**
 * 语义化主题颜色通过 CSS 变量驱动（见 src/styles/index.css）。
 * 用 rgb(var(--xxx) / <alpha-value>) 让 Tailwind 透明度修饰符（如 bg-surface/[0.06]）依然可用。
 */
const withVar = (cssVar) => `rgb(var(${cssVar}) / <alpha-value>)`

module.exports = {
  content: ["./src/**/*.{ts,tsx}", "./index.html"],
  // dark: 前缀基于 documentElement 的 data-theme="dark"（与 CSS 变量方案配合）
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // —— 语义化主题 token（随 data-theme 切换）——
        base: withVar('--color-bg-base'),
        surface: withVar('--color-bg-surface'),
        elevated: withVar('--color-bg-elevated'),
        inset: withVar('--color-bg-inset'),
        'border-subtle': withVar('--color-border-subtle'),
        'border-strong': withVar('--color-border-strong'),
        'text-primary': withVar('--color-text-primary'),
        'text-secondary': withVar('--color-text-secondary'),
        'text-muted': withVar('--color-text-muted'),
        'text-faint': withVar('--color-text-faint'),
        brand: withVar('--color-accent'),
        'brand-soft': withVar('--color-accent-soft'),
        'bubble-user': withVar('--color-bubble-user'),
        'bubble-user-text': withVar('--color-bubble-user-text'),

        // —— 旧有自定义色（保留兼容）——
        panel: {
          dark: '#0f1219',
          darker: '#0a0d12',
          border: '#1e2433',
        },
        terminal: {
          bg: '#0d1117',
          header: '#161b22',
          border: '#30363d',
        },
        accent: {
          cyan: '#58d5ba',
          purple: '#bc8cff',
          green: '#7ee787',
          red: '#ff7b72',
          yellow: '#d29922',
        },
      }
    },
  },
  plugins: [],
}
