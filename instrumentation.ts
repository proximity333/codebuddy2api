export const register = async (): Promise<void> => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { refreshMissingCredentialModels } =
    await import('@/lib/server/domain/credential-models');
  const { startCheckinScheduler } =
    await import('@/lib/server/domain/checkin-scheduler');

  void refreshMissingCredentialModels();
  startCheckinScheduler();
};
