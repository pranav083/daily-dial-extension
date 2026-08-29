import js from "@eslint/js";

/** Chrome extension APIs available to both the page and the service worker. */
const extensionGlobals = {
  chrome: "readonly",
  console: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  URL: "readonly",
  Blob: "readonly",
  Intl: "readonly",
};

const browserGlobals = {
  ...extensionGlobals,
  window: "readonly",
  document: "readonly",
  HTMLElement: "readonly",
  HTMLTextAreaElement: "readonly",
  HTMLInputElement: "readonly",
  FileReader: "readonly",
  Image: "readonly",
  File: "readonly",
};

export default [
  { ignores: ["fonts/**", "icons/**", "*.zip"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
      "prefer-const": "error",
      "no-var": "error",
    },
  },
  {
    files: ["dial.js"],
    languageOptions: { globals: browserGlobals },
  },
  {
    files: ["background.js"],
    languageOptions: { globals: extensionGlobals },
  },
  {
    files: ["test/**/*.js"],
    languageOptions: { globals: { console: "readonly" } },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly" } },
    rules: { "no-console": "off" },
  },
];
