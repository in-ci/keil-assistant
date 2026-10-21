const { defineConfig } = require("@vscode/test-cli");

module.exports = defineConfig({
  files: "test/**/*.test.js",
  version: "stable",
  mocha: {
    ui: "tdd",
    timeout: 30000,
    reporter: "spec",
  },
});
