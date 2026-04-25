import nextCoreWebVitals from "eslint-config-next/core-web-vitals.js";

/** @type {import("eslint").Linter.Config[]} */
const eslintConfig = [
  ...(Array.isArray(nextCoreWebVitals) ? nextCoreWebVitals : [nextCoreWebVitals]),
  {
    ignores: [".venv/**", "**/.venv/**"],
  },
];

export default eslintConfig;
