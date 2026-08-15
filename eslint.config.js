import js from "@eslint/js";
import react from "eslint-plugin-react";
import globals from "globals";

export default [
  {
    ignores: ["dist/", "node_modules/", "src-tauri/", ".opencode/"],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}", "vite.config.js", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: globals.browser,
    },
    plugins: { react },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      ...react.configs.recommended.rules,
      // React 19 + новый JSX transform: импорт React не обязателен
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
    },
  },
];
