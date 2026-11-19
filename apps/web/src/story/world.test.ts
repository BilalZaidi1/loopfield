import { describe, expect, it } from 'vitest';
import { beats, finalCall, sectionIndex } from './world';

describe('final call landing', () => {
  // "Join the waitlist" and every other link to #download must land with the form showing.
  it('lands after the violet block opens and before it unpins', () => {
    const { heightVh, landVh } = finalCall;
    const landing = (landVh + 50) / heightVh; // progress is read at the middle of the screen
    const opened = beats.final.iris[1] - sectionIndex('final');
    const unpins = 1 - 50 / heightVh; // the 100vh stage stays pinned until the section's bottom reaches the screen's
    // The margin covers Lenis landing 64px above the target and a plain jump landing on it.
    expect(landing).toBeGreaterThan(opened + 0.05);
    expect(landing).toBeLessThan(unpins - 0.05);
  });
});
