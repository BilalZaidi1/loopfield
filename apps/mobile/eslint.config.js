const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  { ignores: ['dist/*', 'ios/*', 'android/*', '.expo/*'] },
  {
    rules: {
      // Raw console output can leak personal data; use src/lib/log.ts which scrubs.
      'no-console': ['warn', { allow: ['warn', 'error'] }]
    }
  }
];
