import { ZephyrClient } from '../clients/zephyr-client.js';
import {
  searchTestCasesSchema,
  SearchTestCasesInput,
} from '../utils/validation.js';
import { readOnlyIteration } from '../utils/tool-status.js';

let zephyrClient: ZephyrClient | null = null;

const getZephyrClient = (): ZephyrClient => {
  if (!zephyrClient) {
    zephyrClient = new ZephyrClient();
  }
  return zephyrClient;
};

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

export const getTestCase = async (input: { testCaseId: string }) => {
  try {
    const testCase = await getZephyrClient().getTestCase(input.testCaseId);

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