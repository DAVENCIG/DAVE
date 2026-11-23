import { defineConfig } from "vitest/config"
// Keep tests separate from the build-only Vite plugins.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.js", "functions/**/*.test.js"],
  },
})
