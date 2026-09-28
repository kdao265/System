import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([".next/**", ".e2e/**", "test-results/**", "playwright-report/**", "blob-report/**", "out/**", "next-env.d.ts", "supabase/.temp/**"]),
]);
