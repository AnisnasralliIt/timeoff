// @ts-check
import base from "./base.js";
import nextjs from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  ...base,
  {
    files: ["**/*.ts", "**/*.tsx"],
    ignores: ["**/next-env.d.ts"],
    plugins: {
      "@next/next": nextjs,
      "react-hooks": reactHooks,
    },
    rules: {
      ...nextjs.configs.recommended.rules,
      ...nextjs.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
    },
  },
];
