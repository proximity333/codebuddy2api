import { checkinAccounts } from './account-status';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const CHECKIN_HOUR = 9;
const DAY_MS = 24 * 60 * 60 * 1000;

const globalCheckinSchedulerState = globalThis as typeof globalThis & {
  __codebuddy2apiCheckinScheduler__?: {
    timer: ReturnType<typeof setTimeout> | null;
    started: boolean;
  };
};

const getSchedulerState = () => {
  if (!globalCheckinSchedulerState.__codebuddy2apiCheckinScheduler__) {
    globalCheckinSchedulerState.__codebuddy2apiCheckinScheduler__ = {
      timer: null,
      started: false,
    };
  }
  return globalCheckinSchedulerState.__codebuddy2apiCheckinScheduler__;
};

/**
 * Milliseconds until the next daily check-in at 09:00 Asia/Shanghai (UTC+8).
 * Shanghai has no daylight saving time, so a fixed offset is safe.
 */
export const getNextCheckinDelay = (now: number = Date.now()): number => {
  const shanghaiNow = now + SHANGHAI_OFFSET_MS;
  const shanghaiMidnight = Math.floor(shanghaiNow / DAY_MS) * DAY_MS;
  let target = shanghaiMidnight + CHECKIN_HOUR * 60 * 60 * 1000;
  if (target <= shanghaiNow) target += DAY_MS;
  return target - shanghaiNow;
};

export const runScheduledCheckin = async (): Promise<void> => {
  try {
    const statuses = await checkinAccounts();
    console.info(
      '[CodeBuddy2API] Scheduled daily check-in finished',
      statuses.map((status) => ({
        error: status.error,
        filename: status.filename,
      })),
    );
  } catch (error) {
    console.warn('[CodeBuddy2API] Scheduled daily check-in failed', error);
  }
};

const scheduleNextCheckin = (): void => {
  const state = getSchedulerState();
  const delay = getNextCheckinDelay();
  state.timer = setTimeout(() => {
    void runScheduledCheckin().finally(() => {
      scheduleNextCheckin();
    });
  }, delay);
  // Keep the process free to exit between scheduled runs.
  state.timer.unref?.();
};

export const startCheckinScheduler = (): void => {
  const state = getSchedulerState();
  if (state.started) return;
  state.started = true;
  scheduleNextCheckin();
};

export const stopCheckinScheduler = (): void => {
  const state = getSchedulerState();
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.started = false;
};
