import tailwindcss from "@tailwindcss/vite";
import solidPlugin from "vite-plugin-solid";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), solidPlugin()],
});
