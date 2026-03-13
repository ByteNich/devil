/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Devin-like dark palette
        bg: {
          primary: '#0d0d0d',
          secondary: '#141414',
          tertiary: '#1a1a1a',
          panel: '#111111',
        },
        border: {
          DEFAULT: '#2a2a2a',
          hover: '#3a3a3a',
        },
        accent: {
          DEFAULT: '#6366f1',
          hover: '#4f52d1',
          dim: '#6366f120',
        },
        tool: {
          bash: '#f59e0b',
          read: '#3b82f6',
          write: '#10b981',
          git: '#f97316',
          browser: '#8b5cf6',
          list: '#06b6d4',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
