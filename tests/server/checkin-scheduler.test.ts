import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/server/domain/account-status', () => ({
  checkinAccounts: vi.fn(),
}));

const { checkinAccounts } = await import('@/lib/server/domain/account-status');
const {
  getNextCheckinDelay,
  runScheduledCheckin,
  startCheckinScheduler,
  stopCheckinScheduler,
} = await import('@/lib/server/domain/checkin-scheduler');

const DAY_MS = 24 * 60 * 60 * 1000;

// 2024-01-01T00:00:00Z === 2024-01-01T08:00:00+08:00 (Shanghai morning).
const shanghaiEightUtc = Date.UTC(2024, 0, 1, 0, 0, 0);

describe('checkin scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    stopCheckinScheduler();
  });

  afterEach(() => {
    stopCheckinScheduler();
    vi.useRealTimers();
  });

  it('schedules the next run at 09:00 Asia/Shanghai before the hour', () => {
    // 08:00 Shanghai -> one hour until 09:00.
    expect(getNextCheckinDelay(shanghaiEightUtc)).toBe(60 * 60 * 1000);
  });

  it('rolls over to the next day once 09:00 has passed', () => {
    // 09:00 Shanghai -> next run is 24h later.
    const now = shanghaiEightUtc + 60 * 60 * 1000;
    expect(getNextCheckinDelay(now)).toBe(DAY_MS);
  });

  it('targets 09:00 even after the hour has elapsed', () => {
    // 10:30 Shanghai -> 22.5h until tomorrow 09:00.
    const now = shanghaiEightUtc + (2 * 60 + 30) * 60 * 1000;
    expect(getNextCheckinDelay(now)).toBe(22.5 * 60 * 60 * 1000);
  });

  it('runs check-ins and reschedules itself', async () => {
    vi.mocked(checkinAccounts).mockResolvedValue([
      { error: null, filename: 'one.json' },
    ] as never);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    // Freeze at 08:50 Shanghai so the first tick fires within ten minutes.
    const eightFifty = shanghaiEightUtc + 50 * 60 * 1000;
    vi.setSystemTime(eightFifty);

    startCheckinScheduler();
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);

    expect(checkinAccounts).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      '[CodeBuddy2API] Scheduled daily check-in finished',
      [{ error: null, filename: 'one.json' }],
    );
  });

  it('ignores duplicate start calls', async () => {
    vi.mocked(checkinAccounts).mockResolvedValue([] as never);
    vi.setSystemTime(shanghaiEightUtc);

    startCheckinScheduler();
    startCheckinScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(checkinAccounts).toHaveBeenCalledTimes(1);
  });

  it('logs and swallows check-in failures', async () => {
    vi.mocked(checkinAccounts).mockRejectedValue(new Error('upstream down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await runScheduledCheckin();

    expect(warn).toHaveBeenCalledWith(
      '[CodeBuddy2API] Scheduled daily check-in failed',
      expect.any(Error),
    );
  });
});
