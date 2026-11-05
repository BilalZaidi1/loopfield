/* Test-only stand-in for react-native-reanimated: no worklet runtime exists under Jest, so animated values
 * resolve straight to their targets and animated components render as their plain React Native versions. */
const RN = require('react-native');

const settle = (v) => v;
const chain = () => {
  const c = {};
  for (const k of ['duration', 'delay', 'springify', 'damping', 'stiffness', 'mass', 'easing', 'reduceMotion', 'withCallback', 'randomDelay']) c[k] = () => c;
  return c;
};
const createAnimatedComponent = (C) => C;
const Animated = { View: RN.View, Text: RN.Text, ScrollView: RN.ScrollView, Image: RN.Image, FlatList: RN.FlatList, createAnimatedComponent };

module.exports = {
  __esModule: true,
  default: Animated,
  ...Animated,
  useSharedValue: (v) => ({ value: v }),
  useAnimatedStyle: (fn) => fn(),
  useAnimatedProps: (fn) => fn(),
  useDerivedValue: (fn) => ({ value: fn() }),
  useReducedMotion: () => true,
  withTiming: (v, _cfg, cb) => {
    if (cb) cb(true);
    return v;
  },
  withSpring: (v, _cfg, cb) => {
    if (cb) cb(true);
    return v;
  },
  withDelay: (_d, v) => v,
  withRepeat: settle,
  withSequence: (...vs) => vs[vs.length - 1],
  cancelAnimation: () => {},
  runOnJS: (fn) => fn,
  Easing: { linear: (t) => t, quad: (t) => t, cubic: (t) => t, out: (f) => f, in: (f) => f, inOut: (f) => f, bezier: () => (t) => t },
  FadeIn: chain(),
  FadeOut: chain(),
  FadeInDown: chain(),
  SlideInDown: chain(),
  SlideOutDown: chain(),
  LinearTransition: chain(),
  ReduceMotion: { System: 'system', Always: 'always', Never: 'never' }
};
