import { ZephyrClient } from '../clients/zephyr-client.js';
import {
  listTestCyclesSchema,
  ListTestCyclesInput,
} from '../utils/validation.js';
import { readOnlyIteration } from '../utils/tool-status.js';

let zephyrClient: ZephyrClient | null = null;

const getZephyrClient = (): ZephyrClient => {
  if (!zephyrClient) {
    zephyrClient = new ZephyrClient();
  }
  return zephyrClient;
};

export const createTestCycle = async (_input: unknown) => {
  return readOnlyIteration('create_test_cycle');
};

export const listTestCycles = async (input: ListTestCyclesInput) => {
  const validatedInput = listTestCyclesSchema.parse(input);

  try {
    const result = await getZephyrClient().getTestCycles(
      validatedInput.projectKey,
      validatedInput.versionId,
      validatedInput.limit
    );

    return {
      success: true,
      data: {
        total: result.total,
        testCycles: result.testCycles.map(cycle => ({
          id: cycle.id,
          name: cycle.name,
          description: cycle.description,
          projectId: cycle.projectId,
          projectKey: cycle.projectKey,
          versionId: cycle.versionId,
          versionName: cycle.versionName,
          environment: cycle.environment,
          build: cycle.build,
          totalExecutions: cycle.totalExecutions,
          totalExecuted: cycle.totalExecuted,
          createdBy: cycle.createdBy,
          createdOn: cycle.createdOn,
          executionSummary: {
            total: cycle.executionSummary.total,
            passed: cycle.executionSummary.passed,
            failed: cycle.executionSummary.failed,
            blocked: cycle.executionSummary.blocked,
            inProgress: cycle.executionSummary.inProgress,
            notExecuted: cycle.executionSummary.notExecuted,
            passRate: Math.round(cycle.executionSummary.passRate),
          },
        })),
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.message || error.message,
    };
  }
};

export const getTestCycle = async (input: { cycleId: string; projectKey?: string }) => {
  try {
    const testCycle = await getZephyrClient().getTestCycle(input.cycleId, input.projectKey);

    if (!testCycle) {
      return {
        success: false,
        error: input.projectKey
          ? 'Test cycle not found'
          : 'Test cycle lookup requires a projectKey on Zephyr Squad',
      };
    }

    return {
      success: true,
      data: {
        id: testCycle.id,
        name: testCycle.name,
        description: testCycle.description,
        projectId: testCycle.projectId,
        projectKey: testCycle.projectKey,
        versionId: testCycle.versionId,
        versionName: testCycle.versionName,
        environment: testCycle.environment,
        build: testCycle.build,
        totalExecutions: testCycle.totalExecutions,
        totalExecuted: testCycle.totalExecuted,
        createdBy: testCycle.createdBy,
        createdOn: testCycle.createdOn,
        executionSummary: {
          total: testCycle.executionSummary.total,
          passed: testCycle.executionSummary.passed,
          failed: testCycle.executionSummary.failed,
          blocked: testCycle.executionSummary.blocked,
          inProgress: testCycle.executionSummary.inProgress,
          notExecuted: testCycle.executionSummary.notExecuted,
          passRate: Math.round(testCycle.executionSummary.passRate),
        },
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.message || error.message,
    };
  }
};