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
  URLSearchParams: "readonly",
  Blob: "readonly",
  Intl: "readonly",
  fetch: "readonly",
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
  localStorage: "readonly",
  navigator: "readonly",
  XMLHttpRequest: "readonly",
};

export default [
  // docs/demo/ is a generated copy of the files above; linting it would
  // report every finding twice.
  { ignores: ["fonts/**", "icons/**", "*.zip", "docs/demo/**", "build/**"] },
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
    // i18n.js runs in both: the page imports it, and so does the service
    // worker, which has chrome.* but no document — hence the guarded
    // document access in applyDocumentDirection's caller rather than here.
    files: ["dial.js", "i18n.js"],
    languageOptions: { globals: browserGlobals },
  },
  {
    files: ["background.js", "drive.js"],
    languageOptions: { globals: extensionGlobals },
  },
  {
    files: ["test/**/*.js"],
    languageOptions: { globals: { console: "readonly", URL: "readonly" } },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly" } },
    rules: { "no-console": "off" },
  },
];
