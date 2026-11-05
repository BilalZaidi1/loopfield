import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic Expo config. Only EXPO_PUBLIC_* values reach the JavaScript bundle; they are all
 * client-safe identifiers (publishable keys, DSNs, public tokens). Secrets live on the server and
 * in EAS build environments (e.g. SENTRY_AUTH_TOKEN for source-map upload), never here.
 *
 * Brand: "Loopfield" is a working codename pending naming/trademark clearance (PRD §22).
 */
const APP_ENV = (process.env.APP_ENV ?? 'development') as 'development' | 'preview' | 'production';
const NAME = process.env.APP_DISPLAY_NAME ?? (APP_ENV === 'production' ? 'Loopfield' : `Loopfield (${APP_ENV})`);
const BUNDLE_ID = process.env.APP_BUNDLE_ID ?? 'dev.loopfield.app';
const SCHEME = process.env.APP_SCHEME ?? 'loopfield';
const suffix = APP_ENV === 'production' ? '' : `.${APP_ENV}`;
// EXPO_GO_UPDATE=1 (only in .eas/workflows/publish-expo-go-update.yml) publishes JavaScript that the Expo Go app
// can open, for testing on a phone without a Loopfield build. Its runtime version is "exposdk:<SDK version>",
// which no Loopfield build has, so installed builds never download it. Every other build and update keeps the
// fingerprint policy, and this switch changes nothing else in the config.
const EXPO_GO_UPDATE = process.env.EXPO_GO_UPDATE === '1';

const HEALTH_CONNECT_READ = [
  'android.permission.health.READ_EXERCISE',
  'android.permission.health.READ_HEART_RATE',
  'android.permission.health.READ_RESTING_HEART_RATE',
  'android.permission.health.READ_HEART_RATE_VARIABILITY',
  'android.permission.health.READ_STEPS',
  'android.permission.health.READ_ACTIVE_CALORIES_BURNED',
  'android.permission.health.READ_SLEEP',
  'android.permission.health.READ_VO2_MAX',
  'android.permission.health.READ_ELEVATION_GAINED',
  'android.permission.health.READ_STEPS_CADENCE'
];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: NAME,
  slug: 'loopfield',
  owner: process.env.EXPO_OWNER ?? 'bilalzaidi95',
  scheme: SCHEME,
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  runtimeVersion: EXPO_GO_UPDATE ? { policy: 'sdkVersion' } : { policy: 'fingerprint' },
  // Over-the-air JavaScript updates (Expo Update). A build only takes updates published for its own channel and
  // native fingerprint; if none is available, or the download is slow, the bundled code runs.
  updates: { url: `https://u.expo.dev/${process.env.EAS_PROJECT_ID ?? '2734ce29-57cb-4a7e-b82a-58ecbe115a1e'}`, checkAutomatically: 'ON_LOAD', fallbackToCacheTimeout: 0 },
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: BUNDLE_ID + suffix,
    supportsTablet: false,
    usesAppleSignIn: false,
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Your location records runs you start. Territory and route results use only the competitive interval you explicitly start, and raw traces are never shown to other runners.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'Background location keeps recording a run you started while your screen is locked. Recording stops when you finish the run.',
      NSHealthShareUsageDescription:
        'Optional: read workouts, heart rate, steps, calories, sleep, resting heart rate, HRV and VO2 max to show your private health dashboard on this phone. Health data is never uploaded or shared.',
      NSHealthUpdateUsageDescription: 'Optional: save runs you record in this app to Apple Health when you turn on workout export.',
      NSMotionUsageDescription: 'Motion data can improve recording accuracy for runs you start.',
      NSPhotoLibraryUsageDescription: 'Choose photos to add to a post. Location metadata is removed before upload.',
      NSCameraUsageDescription: 'Take a photo to add to a post. Location metadata is removed before upload.',
      UIBackgroundModes: ['location', 'remote-notification'],
      ITSAppUsesNonExemptEncryption: false
    },
    entitlements: { 'com.apple.developer.healthkit': true, 'com.apple.developer.healthkit.access': [] }
  },
  android: {
    package: (BUNDLE_ID + suffix).replace(/-/g, '_'),
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#0E1A14' },
    allowBackup: false,
    // Firebase config for push (FCM) arrives as an EAS file variable; without it the app runs with in-app notifications only.
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
    permissions: [
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.ACTIVITY_RECOGNITION',
      ...HEALTH_CONNECT_READ,
      'android.permission.health.WRITE_EXERCISE'
    ],
    blockedPermissions: ['android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.RECORD_AUDIO']
  },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { image: './assets/splash.png', imageWidth: 200, resizeMode: 'contain', backgroundColor: '#0E1A14' }],
    'expo-sqlite',
    'expo-secure-store',
    ['expo-location', { isAndroidBackgroundLocationEnabled: true, isAndroidForegroundServiceEnabled: true, isIosBackgroundLocationEnabled: true }],
    ['expo-notifications', { color: '#1F6F4A', defaultChannel: 'default' }],
    ['expo-image-picker', { photosPermission: 'Choose photos to add to a post. Location metadata is removed before upload.', cameraPermission: 'Take a photo to add to a post.', microphonePermission: false }],
    ['@rnmapbox/maps', {}],
    ['@kingstinct/react-native-healthkit', { NSHealthShareUsageDescription: 'Optional: read health data for your private on-device dashboard. It is never uploaded or shared.', NSHealthUpdateUsageDescription: 'Optional: save runs you record to Apple Health.', background: false }],
    'react-native-health-connect',
    // compileSdk 37 is required by Expo SDK 58 modules (React Native 0.88 default); minSdk 28 for Health Connect.
    ['expo-build-properties', { android: { minSdkVersion: 28, compileSdkVersion: 37, targetSdkVersion: 36 }, ios: { deploymentTarget: '16.4' } }],
    // Source maps upload only when the build has a Sentry auth token (an EAS secret); otherwise the build skips it.
    ['@sentry/react-native/expo', { organization: process.env.SENTRY_ORG ?? 'futurama-labs', project: process.env.SENTRY_PROJECT_MOBILE ?? 'loopfield-mobile', url: process.env.SENTRY_URL ?? 'https://de.sentry.io/', disableAutoUpload: !process.env.SENTRY_AUTH_TOKEN }],
    'expo-web-browser',
    'expo-localization'
  ],
  experiments: { typedRoutes: false },
  extra: {
    appEnv: APP_ENV,
    // Expo project @bilalzaidi95/loopfield. The ID is not a secret; EAS_PROJECT_ID overrides it for other projects.
    eas: { projectId: process.env.EAS_PROJECT_ID ?? '2734ce29-57cb-4a7e-b82a-58ecbe115a1e' }
  }
});
