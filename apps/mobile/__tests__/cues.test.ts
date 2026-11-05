jest.mock('expo-speech', () => ({ speak: jest.fn() }));

import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { emitCue, onCue, setCuePreferences } from '@/lib/cues';

describe('run cues have visual and optional haptic equivalents', () => {
  beforeEach(() => jest.clearAllMocks());

  it('always delivers the visual text, haptics by preference, speech only when enabled', () => {
    const seen: string[] = [];
    const off = onCue((c) => seen.push(c.text));
    setCuePreferences({ audio: false, haptics: true });
    emitCue('gps_weak', 'GPS signal is weak');
    expect(seen).toEqual(['GPS signal is weak']);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
    expect(Speech.speak).not.toHaveBeenCalled();

    setCuePreferences({ audio: true, haptics: false });
    emitCue('split', 'Kilometre 1');
    expect(Speech.speak).toHaveBeenCalledWith('Kilometre 1', expect.any(Object));
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    off();
  });
});
