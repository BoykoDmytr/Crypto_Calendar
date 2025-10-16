// tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class', // <— ВАЖЛИВО
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef6ff',
          100: '#d9eaff',
          200: '#bcd9ff',
          300: '#92c2ff',
          400: '#5aa3ff',
          500: '#2a86ff',
          600: '#1670f6',  // у тебе часто використовується
          700: '#0e5ed9',  // для :hover
          800: '#0d4bb0',
          900: '#0e3e8c',
        },
      },
    },
  },
  plugins: [],
};
