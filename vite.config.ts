import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages serves this repo from /experiments/, not the domain root.
  base: command === "build" ? "/experiments/" : "/",
  plugins: [react()],
}));
