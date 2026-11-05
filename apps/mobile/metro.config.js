// Sentry's Metro config adds debug IDs so uploaded source maps resolve readable stack traces.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);
// The shared rules engine uses explicit `.ts` import specifiers (also consumed by Deno).
config.resolver.sourceExts = Array.from(new Set([...config.resolver.sourceExts, 'ts', 'tsx']));
module.exports = config;
