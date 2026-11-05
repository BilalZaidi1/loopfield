import Constants, { ExecutionEnvironment } from 'expo-constants';
import { log } from './log';

/**
 * True when the JavaScript runs inside the Expo Go app instead of a Loopfield build. Expo Go ships a fixed
 * set of native modules: it has no Mapbox, Apple Health or Health Connect code and cannot record location
 * in the background. Features that depend on those switch themselves off with an explanation instead of
 * crashing, and nothing is simulated in their place.
 */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * Loads a native module that may be missing from this binary. Returns null instead of throwing; outside
 * Expo Go a missing module is a build problem, so it is logged.
 */
export function optionalNativeModule<T>(name: string, load: () => T): T | null {
  try {
    return load();
  } catch (e) {
    if (!isExpoGo) log.warn(`native module ${name} unavailable: ${String(e)}`);
    return null;
  }
}
