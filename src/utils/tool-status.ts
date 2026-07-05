// Shared responses for tools that are intentionally unavailable in this fork.

// Zephyr Squad (Zephyr for JIRA) genuinely lacks the feature (e.g. Test Plans).
export const notSupportedOnPlatform = (feature: string) => ({
  success: false,
  error:
    `${feature} is not supported on Zephyr for JIRA 5.6.3 (Zephyr Squad Server). ` +
    'This concept does not exist in the target platform.',
  unsupported: true,
});

// The feature is planned but out of scope for the current read-only iteration.
export const readOnlyIteration = (feature: string) => ({
  success: false,
  error:
    `${feature} is not available yet: the current fork iteration is read-only. ` +
    'Only read operations are implemented for JIRA 8.12 Server + Zephyr Squad.',
  readOnly: true,
});
