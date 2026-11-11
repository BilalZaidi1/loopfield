import { fireEvent, render, screen } from '@testing-library/react-native';
import { BarChart } from '@/components/charts';

describe('accessible charts', () => {
  it('marks missing days as no data (never zero) and offers a numeric table', async () => {
    await render(<BarChart title="Steps per day" unit="steps" data={[{ label: '11-01', value: 5000 }, { label: '11-02', value: null }, { label: '11-03', value: 0 }]} />);
    expect(screen.getByLabelText(/2 of 3 periods have data, 1 without readable data/)).toBeTruthy();
    expect(screen.getByText(/no readable data for that period, not zero/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Show numbers/ }));
    expect(screen.getByLabelText('11-02: no data')).toBeTruthy();
    expect(screen.getByLabelText('11-01: 5000 steps')).toBeTruthy();
    expect(screen.getByLabelText('11-03: 0 steps')).toBeTruthy();
  });
});
