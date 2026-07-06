import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0E1420",
        panel: "#161D2C",
        edge: "#232D42",
        body: "#E8EDF6",
        dim: "#8B96AC",
        foil: "#FFB94A",
        win: "#3DDC84",
        givvy: "#FF8A3D",
        bad: "#F4645C",
      },
    },
  },
  plugins: [],
};
export default config;
