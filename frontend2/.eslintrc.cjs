module.exports = {
  root: true,
  ignorePatterns: ['dist/', 'node_modules/'],
  env: { browser: true, es2022: true, node: true },
  extends: ['eslint:recommended', 'plugin:vue/vue3-recommended'],
  parser: 'vue-eslint-parser',
  parserOptions: { parser: '@typescript-eslint/parser', sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  rules: {
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'vue/multi-word-component-names': 'off',
    'vue/require-default-prop': 'off'
  }
}
