/// <reference types="jest" />
// Native modules that have no JS fallback are mocked for unit tests only.
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => {}), deleteItemAsync: jest.fn(async () => {}) }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(async () => {}), impactAsync: jest.fn(async () => {}), NotificationFeedbackType: { Success: 'success', Warning: 'warning' }, ImpactFeedbackStyle: { Light: 'light' } }));
