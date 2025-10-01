/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6ff',
          100: '#d9ecff',
          200: '#b7d9ff',
          300: '#89c0ff',
          400: '#5aa6ff',
          500: '#2b8dff',
          600: '#0f73e6',
          700: '#0859b4',
          800: '#073f80',
          900: '#062c59',
        },
      },
      boxShadow: {
        soft: '0 6px 24px rgba(0,0,0,.06)'
      }
    },
  },
  plugins: [],
}
