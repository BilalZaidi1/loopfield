import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Card, Medal, TextField, Txt } from '@/components/ui';
import { enabledProviders } from '@/features/auth/oauth';
import { fmtDay, splitValue } from '@/lib/format';
import { thisWeekByDay, weekKey, type ActivityRow } from '@/features/results/useActivities';
import { ThemeProvider, THEME_STORAGE_KEY } from '@/theme/ThemeProvider';
import { familyForWeight, fonts, themes, usePalette, useThemeMode } from '@/theme/tokens';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/state/session', () => ({ useSession: () => ({ userId: null }), useUnits: () => 'metric' }));

function Probe() {
  const p = usePalette();
  const { mode, setMode, scheme } = useThemeMode();
  return (
    <>
      <Text testID="bg">{p.bg}</Text>
      <Text testID="mode">{`${mode}:${scheme}`}</Text>
      <Text testID="to-light" onPress={() => setMode('light')}>light</Text>
    </>
  );
}

describe('theme', () => {
  beforeEach(() => AsyncStorage.clear());

  it('restores the saved choice before rendering and persists a new one', async () => {
    await AsyncStorage.setItem(THEME_STORAGE_KEY, 'dark');
    await render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(await screen.findByTestId('bg')).toHaveTextContent(themes.dark.palette.bg);
    expect(screen.getByTestId('mode')).toHaveTextContent('dark:dark');
    await fireEvent.press(screen.getByTestId('to-light'));
    expect(screen.getByTestId('bg')).toHaveTextContent(themes.light.palette.bg);
    expect(await AsyncStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('ignores unknown saved values and follows the system', async () => {
    await AsyncStorage.setItem(THEME_STORAGE_KEY, 'neon');
    await render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(await screen.findByTestId('mode')).toHaveTextContent(/^system:/);
  });

  it('keeps light and dark designed separately, with readable text on every colour block', () => {
    expect(themes.light.palette.bg).not.toBe(themes.dark.palette.bg);
    expect(themes.light.territory.mineFill).not.toBe(themes.dark.territory.mineFill);
    // Cool blocks carry white text, bright blocks carry ink text.
    expect(themes.light.blocks.violet.fg).toBe('#FFFFFF');
    expect(themes.light.blocks.orange.fg).toBe('#121318');
    expect(themes.dark.blocks.green.fg).toBe('#121318');
  });

  it('maps style weights to real font files so Android never fakes bold', () => {
    expect(familyForWeight('700', false)).toBe(fonts.bold);
    expect(familyForWeight(600, false)).toBe(fonts.semibold);
    expect(familyForWeight('900', true)).toBe(fonts.blackItalic);
    expect(familyForWeight(undefined, false)).toBe(fonts.medium);
  });
});

describe('components', () => {
  it('lets people reveal and hide a password', async () => {
    await render(<TextField label="Password" value="secret-pass" onChangeText={() => {}} secure />);
    expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(false);
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeTruthy();
  });

  it('recolours text placed on a colour block', async () => {
    await render(
      <Card tone="violet">
        <Txt>On violet</Txt>
      </Card>
    );
    const style = [screen.getByText('On violet').props.style].flat(5).reduce((a: Record<string, unknown>, s: unknown) => ({ ...a, ...(s as object) }), {});
    expect(style.color).toBe(themes.light.blocks.violet.fg);
  });

  it('shows the real achievement on a medal', async () => {
    await render(<Medal label="5K" />);
    expect(screen.getByText('5K')).toBeTruthy();
  });
});

describe('formatting and weekly totals', () => {
  it('formats calendar days without shifting them across time zones', () => {
    expect(fmtDay('2026-11-02', { day: 'numeric' })).toBe('2');
    expect(splitValue('12.40 km')).toEqual({ value: '12.40', unit: 'km' });
    expect(splitValue('—')).toEqual({ value: '—', unit: '' });
  });

  it('keys weeks by the local Monday', () => {
    const wed = new Date(2026, 10, 4, 12).getTime(); // Wednesday 4 Nov 2026, local time
    expect(weekKey(wed)).toBe('2026-11-02');
  });

  it('splits this week by day next to the same weekday last week', () => {
    const now = new Date(2026, 10, 4, 18).getTime();
    const run = (d: Date, km: number) => ({ id: String(d.getTime()), started_at: d.toISOString(), distance_m: km * 1000 }) as unknown as ActivityRow;
    const days = thisWeekByDay([run(new Date(2026, 10, 3, 7), 5), run(new Date(2026, 9, 27, 7), 8), run(new Date(2026, 10, 4, 6), 3)], now);
    expect(days).toHaveLength(7);
    expect(days[1]!.distanceM).toBe(5000); // Tuesday this week
    expect(days[1]!.lastWeekM).toBe(8000); // Tuesday last week
    expect(days[2]!.distanceM).toBe(3000);
    expect(days[0]!.distanceM).toBe(0);
  });
});

describe('social sign-in', () => {
  it('offers only providers that are switched on, Apple first on iPhone', () => {
    expect(enabledProviders({ google: true, apple: true, email: true }, 'ios')).toEqual(['apple', 'google']);
    expect(enabledProviders({ google: true, apple: false }, 'android')).toEqual(['google']);
    expect(enabledProviders(undefined, 'web')).toEqual([]);
  });
});
