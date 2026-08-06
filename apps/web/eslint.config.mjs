// @ts-check
import config from "@timeoff/config/eslint-config/next.js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    // Resolved relative to this file (apps/web). next-env.d.ts is generated.
    ignores: ["next-env.d.ts", ".next/**"],
  },
  ...config,
];
