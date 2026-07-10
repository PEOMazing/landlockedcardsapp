import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0D0F14",
        panel: "#14171F",
        edge: "#262B38",
        body: "#F4F5F7",
        dim: "#8B93A7",
        foil: "#7AA2FF",
        win: "#3ECF8E",
        givvy: "#C084FC",
        bad: "#F0625D",
      },
    },
  },
  plugins: [],
};
export default config;
