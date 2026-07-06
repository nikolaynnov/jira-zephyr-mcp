// Shared responses for tools that are intentionally unavailable in this fork.

// The feature is planned but out of scope for the current read-only iteration.
export const readOnlyIteration = (feature: string) => ({
  success: false,
  error:
    `${feature} is not available yet: the current fork iteration is read-only. ` +
    'Only read operations are implemented for JIRA 8.12 Server + Zephyr Squad.',
  readOnly: true,
});
