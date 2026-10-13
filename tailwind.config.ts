import type { Config } from 'tailwindcss';

// Brandit design tokens. These mirror the Brandit design system.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#F3F5F7',
        paper2: '#E9EDF1',
        surface: '#FFFFFF',
        ink: '#0B1F33',
        ink2: '#16324F',
        muted: '#3D5166',
        'on-ink-muted': '#C9D3DD',
        accent: '#FFC400',
        'accent-hi': '#FFCE33',
        line: '#D9DFE5',
        'line-control': '#7A8A9B',
        placeholder: '#E6EBF0',
        good: '#0B6B45',
        'good-tint': '#E3F4EC',
        warn: '#6B4500',
        'warn-tint': '#FFF1CC',
        bad: '#8A2C00',
        'bad-tint': '#FFE1D6',
      },
      fontFamily: {
        display: ['"Bricolage Grotesque Variable"', 'system-ui', 'sans-serif'],
        sans: ['"DM Sans Variable"', 'system-ui', 'sans-serif'],
      },
      borderRadius: { sm2: '12px', md2: '16px', lg2: '20px', xl2: '28px' },
      boxShadow: {
        press: '0 12px 0 #0B1F33',
        'press-sm': '0 6px 0 #0B1F33',
        key: '0 3px 0 #B88A00',
        'key-down': '0 1px 0 #B88A00',
        focus: '0 0 0 4px rgba(255,196,0,.55)',
      },
      keyframes: {
        shake: { '0%,100%': { transform: 'translateX(0)' }, '20%': { transform: 'translateX(-6px)' }, '40%': { transform: 'translateX(6px)' }, '60%': { transform: 'translateX(-4px)' }, '80%': { transform: 'translateX(3px)' } },
        rise: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        indeterminate: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(400%)' } },
        pop: { '0%': { transform: 'scale(.6)', opacity: '0' }, '60%': { transform: 'scale(1.08)' }, '100%': { transform: 'scale(1)', opacity: '1' } },
      },
      animation: { indeterminate: 'indeterminate 1.1s ease-in-out infinite', shake: 'shake .4s ease-in-out', rise: 'rise .22s ease-out', pop: 'pop .35s ease-out' },
    },
  },
  plugins: [],
};
export default config;
