import { z } from 'zod';

export const createTestCycleSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  projectKey: z.string().min(1, 'Project key is required'),
  versionId: z.string().min(1, 'Version ID is required'),
  environment: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const readJiraIssueSchema = z.object({
  issueKey: z.string().min(1, 'Issue key is required'),
  fields: z.array(z.string()).optional(),
});

export const listTestCyclesSchema = z.object({
  projectKey: z.string().min(1, 'Project key is required'),
  versionId: z.string().optional(),
  limit: z.number().min(1).max(100).default(50),
});

export const executeTestSchema = z.object({
  executionId: z.string().min(1, 'Execution ID is required'),
  status: z.enum(['PASS', 'FAIL', 'WIP', 'BLOCKED']),
  comment: z.string().optional(),
  defects: z.array(z.string()).optional(),
});

export const getTestExecutionStatusSchema = z.object({
  cycleId: z.string().min(1, 'Cycle ID is required'),
});

export const listTestCycleExecutionsSchema = z.object({
  cycleId: z.string().min(1, 'Cycle ID is required'),
  projectKey: z.string().optional(),
  versionId: z.string().optional(),
});

export const linkDefectToExecutionSchema = z
  .object({
    // Target execution: either directly by id, or by (testKey + cycleName).
    executionId: z.string().min(1).optional(),
    testKey: z.string().min(1).optional(),
    cycleName: z.string().min(1).optional(),
    // JIRA defect issue keys to attach (e.g. ["IPLUS-42214"]).
    defectKeys: z.array(z.string().min(1)).min(1, 'At least one defect key is required'),
    // Optional step results to also attach the defects to (by stepResultId).
    stepResultIds: z.array(z.string().min(1)).optional(),
    // Alternative to stepResultIds: 1-based step order numbers (orderId). The tool
    // fetches the execution's step results and resolves each orderId to a stepResultId.
    orderIds: z.array(z.number().int().positive()).optional(),
    // Merge (default) keeps existing defects; replace overwrites the list.
    replace: z.boolean().default(false),
    // Preview the payload(s) without writing.
    dryRun: z.boolean().default(false),
  })
  .refine(
    data => Boolean(data.executionId) || Boolean(data.testKey && data.cycleName),
    {
      message: 'Provide executionId, or both testKey and cycleName, to identify the execution.',
    }
  );

export const generateTestReportSchema = z.object({
  cycleId: z.string().min(1, 'Cycle ID is required'),
  format: z.enum(['JSON', 'HTML']).default('JSON'),
});

export const createTestCaseSchema = z.object({
  projectKey: z.string().min(1, 'Project key is required'),
  name: z.string().min(1, 'Name is required'),
  objective: z.string().optional(),
  precondition: z.string().optional(),
  estimatedTime: z.number().min(0).optional(),
  priority: z.string().optional(),
  status: z.string().optional(),
  folderId: z.string().optional(),
  labels: z.array(z.string()).optional(),
  componentId: z.string().optional(),
  customFields: z.record(z.any()).optional(),
  testScript: z.object({
    type: z.enum(['STEP_BY_STEP', 'PLAIN_TEXT']),
    steps: z.array(z.object({
      index: z.number().min(1),
      description: z.string().min(1),
      testData: z.string().optional(),
      expectedResult: z.string().min(1),
    })).optional(),
    text: z.string().optional(),
  }).optional(),
});

export const searchTestCasesSchema = z.object({
  projectKey: z.string().min(1, 'Project key is required'),
  // Free-text keyword match on summary/description (NOT a JQL string).
  text: z.string().optional(),
  // Exact label / component filters (AND-ed together, each is "any of").
  labels: z.array(z.string().min(1)).optional(),
  components: z.array(z.string().min(1)).optional(),
  limit: z.number().min(1).max(100).default(50),
});

const executionStatusName = z.enum(['PASS', 'FAIL', 'WIP', 'BLOCKED', 'UNEXECUTED']);

export const searchTestExecutionsSchema = z.object({
  projectKey: z.string().min(1, 'Project key is required'),
  // Structured filters -> ZQL clauses (ignored entirely if `zql` is provided).
  labels: z.array(z.string().min(1)).optional(),
  components: z.array(z.string().min(1)).optional(),
  status: z.array(executionStatusName).optional(),
  fixVersions: z.array(z.string().min(1)).optional(),
  // cycleName ~ "..." (substring: e.g. "2026.2" matches Linux/Windows/приёмка).
  cycleNameContains: z.string().optional(),
  // cycleName IN (...) exact cycle names.
  cycleNames: z.array(z.string().min(1)).optional(),
  // Escape hatch: raw ZQL. When set, ALL structured params above are ignored.
  zql: z.string().optional(),
  // Page size (rows returned in one call). The underlying ZQL search is not
  // capped server-side, but raw rows are kept bounded to protect the model's
  // context; page with `offset` for more, or use aggregate_executions_by_cycle
  // for whole-period questions.
  limit: z.number().min(1).max(200).default(50),
  // 0-based offset for pagination. Use the response's `nextOffset` to continue.
  offset: z.number().min(0).default(0),
});

export const aggregateExecutionsByCycleSchema = z.object({
  projectKey: z.string().min(1, 'Project key is required'),
  // Structured filters -> ZQL clauses (ignored entirely if `zql` is provided).
  // Scope to a group via labels/components (e.g. labels: ["modules"]).
  labels: z.array(z.string().min(1)).optional(),
  components: z.array(z.string().min(1)).optional(),
  fixVersions: z.array(z.string().min(1)).optional(),
  // cycleName ~ "..." (substring: e.g. "Регресс" matches all regression cycles).
  cycleNameContains: z.string().optional(),
  // cycleName IN (...) exact cycle names.
  cycleNames: z.array(z.string().min(1)).optional(),
  // Escape hatch: raw ZQL. When set, ALL structured filters above are ignored.
  // Note: do NOT add an executionStatus filter here - it defeats the per-cycle
  // status breakdown this tool is built to compute.
  zql: z.string().optional(),
  // Safety ceiling on executions pulled and aggregated across all pages.
  maxExecutions: z.number().min(1).max(50000).default(10000),
});

export const getTestCaseSchema = z.object({
  testCaseId: z.string().min(1, 'Test case ID is required'),
  includeExecutions: z.boolean().default(false),
});

export const getTestCaseExecutionsSchema = z.object({
  testCaseId: z.string().min(1, 'Test case ID is required'),
});

export const createMultipleTestCasesSchema = z.object({
  testCases: z.array(createTestCaseSchema).min(1, 'At least one test case is required'),
  continueOnError: z.boolean().default(true),
});

export type CreateTestCycleInput = z.infer<typeof createTestCycleSchema>;
export type ReadJiraIssueInput = z.infer<typeof readJiraIssueSchema>;
export type ListTestCyclesInput = z.infer<typeof listTestCyclesSchema>;
export type ExecuteTestInput = z.infer<typeof executeTestSchema>;
export type GetTestExecutionStatusInput = z.infer<typeof getTestExecutionStatusSchema>;
export type ListTestCycleExecutionsInput = z.infer<typeof listTestCycleExecutionsSchema>;
export type LinkDefectToExecutionInput = z.infer<typeof linkDefectToExecutionSchema>;
export type GenerateTestReportInput = z.infer<typeof generateTestReportSchema>;
export type CreateTestCaseInput = z.infer<typeof createTestCaseSchema>;
export type SearchTestCasesInput = z.infer<typeof searchTestCasesSchema>;
export type SearchTestExecutionsInput = z.infer<typeof searchTestExecutionsSchema>;
export type AggregateExecutionsByCycleInput = z.infer<typeof aggregateExecutionsByCycleSchema>;
export type GetTestCaseInput = z.infer<typeof getTestCaseSchema>;
export type GetTestCaseExecutionsInput = z.infer<typeof getTestCaseExecutionsSchema>;
export type CreateMultipleTestCasesInput = z.infer<typeof createMultipleTestCasesSchema>;