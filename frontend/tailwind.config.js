/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  corePlugins: {
    preflight: false, // disable CSS reset — keeps existing App.css styles intact
  },
  theme: {
    extend: {},
  },
  plugins: [],
};
