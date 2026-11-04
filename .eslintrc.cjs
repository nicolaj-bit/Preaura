/**
 * This is intended to be a basic starting point for linting in your app.
 * It relies on recommended configs out of the box for simplicity, but you can
 * and should modify this configuration to best suit your team's needs.
 */

const TABLE_RULE = {
  selector:
    "MemberExpression[object.name=/^(db|prisma|client|tx)$/][property.name=/^(shopSetting|variantPlan|delivery|allocation|modeChange|sellingPlanRef|dataRequest|integrationSetting|outboxEvent|outboxDelivery)$/]",
  message:
    "Brug forShop(shop), complianceFor(shop) eller outboxFor(shop) fra app/models/ — så filtreres der altid på butik.",
};

const MUTATION_RULE = {
  selector: "TemplateElement[value.raw=/\\bmutation\\b/]",
  message:
    "Al skrivning til Shopify skal ligge i app/sync/shopifyGateway.server.ts og køres via syncVariant().",
};

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  env: {
    browser: true,
    commonjs: true,
    es6: true,
  },
  ignorePatterns: ["!**/.server", "!**/.client"],

  // Base config
  extends: ["eslint:recommended"],

  overrides: [
    // React
    {
      files: ["**/*.{js,jsx,ts,tsx}"],
      plugins: ["react", "jsx-a11y"],
      extends: [
        "plugin:react/recommended",
        "plugin:react/jsx-runtime",
        "plugin:react-hooks/recommended",
        "plugin:jsx-a11y/recommended",
      ],
      settings: {
        react: {
          version: "detect",
        },
        formComponents: ["Form"],
        linkComponents: [
          { name: "Link", linkAttribute: "to" },
          { name: "NavLink", linkAttribute: "to" },
        ],
        "import/resolver": {
          typescript: {},
        },
      },
      rules: {
        "react/no-unknown-property": ["error", { ignore: ["variant"] }],
      },
    },

    // Typescript
    {
      files: ["**/*.{ts,tsx}"],
      plugins: ["@typescript-eslint", "import"],
      parser: "@typescript-eslint/parser",
      settings: {
        "import/internal-regex": "^~/",
        "import/resolver": {
          node: {
            extensions: [".ts", ".tsx"],
          },
          typescript: {
            alwaysTryTypes: true,
          },
        },
      },
      extends: [
        "plugin:@typescript-eslint/recommended",
        "plugin:import/recommended",
        "plugin:import/typescript",
      ],
    },

    // To arkitekturregler. De står samlet, fordi ESLint lader en senere
    // no-restricted-syntax overskrive en tidligere i stedet for at lægge dem
    // sammen.
    //
    // 1. Forudbestillingens tabeller må kun bruges gennem
    //    app/models/preorder.server.ts, som altid filtrerer på butik.
    // 2. Kun synkroniseringen må skrive til Shopify: GraphQL-mutationer må
    //    kun stå i app/sync/shopifyGateway.server.ts.
    {
      files: ["app/**/*.{ts,tsx}"],
      excludedFiles: ["**/*.test.ts", "app/test/**"],
      rules: {
        "no-restricted-syntax": ["error", TABLE_RULE, MUTATION_RULE],
      },
    },
    {
      files: ["app/models/**"],
      excludedFiles: ["**/*.test.ts"],
      rules: { "no-restricted-syntax": ["error", MUTATION_RULE] },
    },
    {
      files: ["app/sync/shopifyGateway.server.ts"],
      rules: { "no-restricted-syntax": ["error", TABLE_RULE] },
    },
    {
      files: ["app/**/*.{ts,tsx}"],
      excludedFiles: ["app/sync/**", "app/test/**", "**/*.test.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: [
                  "**/sync/shopifyGateway.server",
                  "**/sync/syncVariant.server",
                  "**/sync/syncOrder.server",
                  "**/sync/gateway",
                ],
                message: "Brug shopifySync() fra app/sync/index.server.ts.",
              },
            ],
          },
        ],
      },
    },

    // Node
    {
      files: [
        ".eslintrc.cjs",
        "vite.config.{js,ts}",
        ".graphqlrc.{js,ts}",
        "shopify.server.{js,ts}",
        "**/*.server.{js,ts}",
      ],
      env: {
        node: true,
      },
    },
  ],
  globals: {
    shopify: "readonly",
  },
};
