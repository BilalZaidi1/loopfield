/// <reference types="jest" />
// Native modules that have no JS fallback are mocked for unit tests only.
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => {}), deleteItemAsync: jest.fn(async () => {}) }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(async () => {}), impactAsync: jest.fn(async () => {}), NotificationFeedbackType: { Success: 'success', Warning: 'warning' }, ImpactFeedbackStyle: { Light: 'light' } }));
// Reanimated has no worklet runtime under Jest; animations resolve straight to their end state.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports
jest.mock('react-native-reanimated', () => require('./jest.reanimated-mock'));
// The query client watches connectivity and the app keeps small preferences in AsyncStorage; both are
// native modules, so every test gets their official Jest stand-ins.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports
jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock'));
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
