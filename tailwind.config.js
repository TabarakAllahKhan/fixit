/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#176B5B',
        'primary-pressed': '#12574A',
        'primary-soft': '#E8F2EF',
        ivory: '#F6F8F5',
        surface: '#FFFFFF',
        'surface-alt': '#FBFCFA',
        heading: '#192722',
        secondary: '#68756E',
        muted: '#8A9590',
        line: '#E7ECE8',
        'line-strong': '#D3DDD7',
        lime: '#D6ED83',
        'lime-soft': '#F3F9DD',
        success: '#27845B',
        warning: '#E6A23C',
        error: '#D85C52',
        'error-soft': '#FDF0EF',
      },
      fontFamily: {
        manrope: ['Manrope_400Regular'],
        'manrope-medium': ['Manrope_500Medium'],
        'manrope-semibold': ['Manrope_600SemiBold'],
        'manrope-bold': ['Manrope_700Bold'],
      },
    },
  },
  plugins: [],
};
