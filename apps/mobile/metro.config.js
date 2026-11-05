// Sentry's Metro config adds debug IDs so uploaded source maps resolve readable stack traces.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);
// The shared rules engine uses explicit `.ts` import specifiers (also consumed by Deno).
config.resolver.sourceExts = Array.from(new Set([...config.resolver.sourceExts, 'ts', 'tsx']));

// The browser version has no maps or health integrations. These native-only SDKs resolve to an empty module
// on web so the web bundle never includes code that cannot run there; the app checks the platform before
// using them and shows those features as unavailable in the browser.
const NATIVE_ONLY = new Set(['@rnmapbox/maps', '@kingstinct/react-native-healthkit', 'react-native-health-connect', 'react-native-nitro-modules']);
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && NATIVE_ONLY.has(moduleName)) return { type: 'empty' };
  return upstreamResolve ? upstreamResolve(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
