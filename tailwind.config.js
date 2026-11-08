/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/web/views/**/*.html', './src/web/public/**/*.js', './src/web/public/css/styles.css'],
  theme: {
    extend: {
      colors: {
        sukuna: {
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
          950: '#450a0a',
        },
        dark: {
          900: '#0f172a',
          950: '#020617',
        },
        text: '#f8fafc',
        muted: '#94a3b8',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['Fira Code', 'monospace'],
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.5rem',
        '3xl': '2rem',
      },
      boxShadow: {
        'glass': '0 4px 30px rgba(0, 0, 0, 0.1)',
        'neon': '0 0 20px rgba(239, 68, 68, 0.4)',
      },
    },
  },
  plugins: [],
}
