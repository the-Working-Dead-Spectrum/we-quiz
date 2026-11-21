/** @type {import('tailwindcss').Config} */
// Brand palette derived from the We.info logo (src/logo-weinfo.png):
//   brand blue #2c83c0 → primary-500, brand navy #0b141f → gray-950.
// `gray` is overridden with a navy-tinted scale so every neutral (text, borders, dark game
// screens) matches the logo's ink color without touching each component.
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eef6fc',
          100: '#d7eaf7',
          200: '#b3d6ef',
          300: '#82bbe3',
          400: '#4f9cd3',
          500: '#2c83c0',
          600: '#2169a1',
          700: '#1c5583',
          800: '#1b486c',
          900: '#1b3d5a',
          950: '#12273b',
        },
        gray: {
          50: '#f5f7fa',
          100: '#eaeef3',
          200: '#d5dce5',
          300: '#b3bfcd',
          400: '#8394a8',
          500: '#5f7187',
          600: '#47576b',
          700: '#334256',
          800: '#1d2a3a',
          900: '#121d2b',
          950: '#0b141f',
        },
        // Answer tiles. Contrast checked for their text color (white, or gray-950 on yellow).
        answer: {
          red: '#d6303a',
          blue: '#2169a1',
          yellow: '#f2b705',
          green: '#16803c',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Poppins', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      spacing: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-slow': 'bounce 2s infinite',
        'spin-slow': 'spin 3s linear infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'slide-down': 'slideDown 0.4s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        shake: 'shake 0.5s ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.9)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-4px)' },
          '20%, 40%, 60%, 80%': { transform: 'translateX(4px)' },
        },
      },
    },
  },
  plugins: [],
};
