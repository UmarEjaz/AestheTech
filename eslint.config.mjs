import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // Next 15 splits the TypeScript rules out of core-web-vitals into `next/typescript`; include both so
  // the `@typescript-eslint/*` rules referenced by inline eslint-disable comments stay defined.
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: ["node_modules/**", ".next/**"],
  },
];

export default eslintConfig;
