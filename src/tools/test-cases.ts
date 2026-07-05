import { ZephyrClient } from '../clients/zephyr-client.js';
import {
  searchTestCasesSchema,
  getTestCaseSchema,
  getTestCaseExecutionsSchema,
  SearchTestCasesInput,
  GetTestCaseInput,
  GetTestCaseExecutionsInput,
} from '../utils/validation.js';
import { readOnlyIteration } from '../utils/tool-status.js';
import { ZephyrTestExecution } from '../types/zephyr-types.js';

let zephyrClient: ZephyrClient | null = null;

const getZephyrClient = (): ZephyrClient => {
  if (!zephyrClient) {
    zephyrClient = new ZephyrClient();
  }
  return zephyrClient;
};

// Shared shape for an execution row returned by the test-case tools.
const toExecutionView = (execution: ZephyrTestExecution) => ({
  id: execution.id,
  status: execution.status,
  statusName: execution.statusName,
  cycleId: execution.cycleId,
  cycleName: execution.cycleName,
  versionName: execution.versionName,
  executedOn: execution.executedOn,
  executedBy: execution.executedBy,
  comment: execution.comment,
});

export const createTestCase = async (_input: unknown) => {
  return readOnlyIteration('create_test_case');
};

export const searchTestCases = async (input: SearchTestCasesInput) => {
  const validatedInput = searchTestCasesSchema.parse(input);

  try {
    const result = await getZephyrClient().searchTestCases(
      validatedInput.projectKey,
      validatedInput.query,
      validatedInput.limit
    );

    return {
      success: true,
      data: {
        testCases: result.testCases.map(testCase => ({
          id: testCase.id,
          key: testCase.key,
          name: testCase.name,
          objective: testCase.objective,
          status: testCase.status,
          priority: testCase.priority,
          labels: testCase.labels,
          components: testCase.components,
          project: testCase.project,
          createdOn: testCase.createdOn,
        })),
        total: result.total,
        projectKey: validatedInput.projectKey,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.message || error.message,
    };
  }
};

export const getTestCase = async (input: GetTestCaseInput) => {
  const validatedInput = getTestCaseSchema.parse(input);

  try {
    const testCase = await getZephyrClient().getTestCase(
      validatedInput.testCaseId,
      validatedInput.includeExecutions
    );

    return {
      success: true,
      data: {
        id: testCase.id,
        key: testCase.key,
        name: testCase.name,
        objective: testCase.objective,
        precondition: testCase.precondition,
        status: testCase.status,
        priority: testCase.priority,
        labels: testCase.labels,
        components: testCase.components,
        project: testCase.project,
        createdOn: testCase.createdOn,
        steps: testCase.steps,
        ...(validatedInput.includeExecutions
          ? {
              lastExecution: testCase.lastExecution
                ? toExecutionView(testCase.lastExecution)
                : null,
              executions: (testCase.executions || []).map(toExecutionView),
            }
          : {}),
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.message || error.message,
    };
  }
};

export const getTestCaseExecutions = async (input: GetTestCaseExecutionsInput) => {
  const validatedInput = getTestCaseExecutionsSchema.parse(input);

  try {
    const result = await getZephyrClient().getTestCaseExecutions(validatedInput.testCaseId);

    return {
      success: true,
      data: {
        testCaseId: result.testCaseId,
        issueKey: result.issueKey,
        total: result.total,
        lastExecution: result.lastExecution ? toExecutionView(result.lastExecution) : null,
        executions: result.executions.map(toExecutionView),
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.message || error.message,
    };
  }
};

export const createMultipleTestCases = async (_input: unknown) => {
  return readOnlyIteration('create_multiple_test_cases');
};