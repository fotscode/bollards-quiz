import { defineConfig } from "vite";

// GitHub Pages project site: https://<user>.github.io/<repo>/
const base = process.env.BASE_URL ?? "/";

export default defineConfig({
  base,
  root: ".",
  publicDir: "public",
});
