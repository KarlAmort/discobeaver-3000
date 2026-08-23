import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";

export default [
   {
      ignores: [ "analysis/**", "node_modules/**", "site/**", "vendor/**" ]
   },
   {
      files: [ "addon/**/*.js", "app/javascript/**/*.js", "test/**/*.mjs", "eleventy.config.js" ],
      ...js.configs.recommended,
      languageOptions: {
         ecmaVersion: "latest",
         sourceType: "module",
         globals: {
            ...globals.browser,
            ...globals.node
         }
      },
      plugins: { "@stylistic": stylistic },
      rules: {
         "@stylistic/indent": [ "error", 3, {
            SwitchCase: 1,
            ImportDeclaration: "first",
            CallExpression: { arguments: "first" },
            FunctionDeclaration: { parameters: "first" },
            FunctionExpression: { parameters: "first" },
            ignoredNodes: [ "ConditionalExpression", "TemplateLiteral *", "ObjectExpression", "ObjectPattern", "ArrayExpression", "SwitchCase > BlockStatement" ]
         } ],
         "@stylistic/quotes": [ "error", "double", { avoidEscape: true, allowTemplateLiterals: "always" } ],
         "@stylistic/semi": [ "error", "always" ],
         "no-empty": [ "error", { allowEmptyCatch: true } ],
         "no-irregular-whitespace": [ "error", { skipStrings: true, skipTemplates: true } ],
         "no-unused-vars": [ "error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" } ]
      }
   }
];
