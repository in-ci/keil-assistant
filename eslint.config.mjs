import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "out/**",
      ".vscode-test/**",
      "coverage/**",
    ],
  },
  {
    files: ["src/**/*.ts", "lib/**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // TypeScript 编译器负责检查变量和类型名称。
      "no-undef": "off",

      // 延续旧项目的部分代码规范。
      "no-redeclare": "error",
      curly: ["error", "all"],
      eqeqeq: ["error", "always"],
      semi: ["error", "always"],

      // 旧代码迁移阶段先作为警告处理。
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": [
        "error",
        {
          allowAsImport: true,
        },
      ],
    },
  },
]);
