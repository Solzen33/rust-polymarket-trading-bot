/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "#050816",
        surface: "#0B1020",
        accent: {
          DEFAULT: "#7C3AED",
          soft: "#4C1D95"
        }
      }
    }
  },
  plugins: []
};

