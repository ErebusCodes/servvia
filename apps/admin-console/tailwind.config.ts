import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      colors: {
        white: 'var(--color-surface)',
        bg: 'var(--color-bg)',
        border: 'var(--color-border)',
        gray: {
          50: 'var(--color-bg)',
          100: 'var(--color-surface-3)',
          200: 'var(--color-border)',
          300: 'var(--color-border-strong)',
          400: 'var(--color-text-tertiary)',
          500: 'var(--color-text-secondary)',
          600: 'var(--gray-600)',
          700: 'var(--gray-700)',
          800: 'var(--gray-800)',
          900: 'var(--color-text)',
          950: 'var(--gray-950)',
        },
        emerald: {
          50: 'var(--color-primary-subtle)',
          100: 'var(--color-success-border)',
          200: 'var(--green-200)',
          300: 'var(--green-300)',
          400: 'var(--green-400)',
          500: 'var(--green-500)',
          600: 'var(--color-primary)',
          700: 'var(--color-primary-hover)',
          800: 'var(--color-primary-active)',
          900: 'var(--green-900)',
        },
        amber: {
          50: 'var(--color-warning-bg)',
          100: 'var(--color-warning-border)',
          500: 'var(--amber-500)',
          600: 'var(--amber-600)',
          700: 'var(--color-warning)',
        },
        red: {
          50: 'var(--color-danger-bg)',
          100: 'var(--color-danger-border)',
          500: 'var(--red-500)',
          600: 'var(--red-600)',
          700: 'var(--color-danger)',
        },
        blue: {
          50: 'var(--color-info-bg)',
          100: 'var(--color-info-border)',
          500: 'var(--blue-500)',
          600: 'var(--blue-600)',
          700: 'var(--color-info)',
        },
        vd: {
          bg: {
            page: '#262B40',
            card: '#2E3252',
            input: '#3A3E5C',
          },
          border: '#484D6D',
          accent: '#1DB8B8',
          text: {
            primary: '#F0F1F8',
            secondary: '#8890A8',
            muted: '#5A6080',
            sso: '#C8CCDE',
          },
        },
      },
      boxShadow: {
        'vd-card': '0 24px 80px rgba(0,0,0,0.45), 0 4px 16px rgba(0,0,0,0.3)',
      },
    },
  },
  plugins: [],
};

export default config;
