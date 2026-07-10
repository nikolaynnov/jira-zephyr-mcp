import { ZephyrClient } from '../clients/zephyr-client.js';
import {
  getTestExecutionStatusSchema,
  listTestCycleExecutionsSchema,
  searchTestExecutionsSchema,
  aggregateExecutionsByCycleSchema,
  generateTestReportSchema,
  linkDefectToExecutionSchema,
  GetTestExecutionStatusInput,
  ListTestCycleExecutionsInput,
  SearchTestExecutionsInput,
  AggregateExecutionsByCycleInput,
  GenerateTestReportInput,
  LinkDefectToExecutionInput,
} from '../utils/validation.js';
import { readOnlyIteration } from '../utils/tool-status.js';
import { DefectLinkTargetResult } from '../types/zephyr-types.js';

let zephyrClient: ZephyrClient | null = null;

const getZephyrClient = (): ZephyrClient => {
  if (!zephyrClient) {
    zephyrClient = new ZephyrClient();
  }
  return zephyrClient;
};

export const executeTest = async (_input: unknown) => {
  return readOnlyIteration('execute_test');
};

export const getTestExecutionStatus = async (input: GetTestExecutionStatusInput) => {
  const validatedInput = getTestExecutionStatusSchema.parse(input);

  try {
    const summary = await getZephyrClient().getTestExecutionSummary(validatedInput.cycleId);

    return {
      success: true,
      data: {
        cycleId: validatedInput.cycleId,
        summary: {
          total: summary.total,
          passed: summary.passed,
          failed: summary.failed,
          blocked: summary.blocked,
          inProgress: summary.inProgress,
          notExecuted: summary.notExecuted,
          passRate: Math.round(summary.passRate),
        },
        progress: {
          completed: summary.passed + summary.failed + summary.blocked,
          remaining: summary.notExecuted + summary.inProgress,
          completionPercentage: summary.total > 0
            ? Math.round(((summary.passed + summary.failed + summary.blocked) / summary.total) * 100)
            : 0,
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

export const linkDefectToExecution = async (input: LinkDefectToExecutionInput) => {
  const validatedInput = linkDefectToExecutionSchema.parse(input);
  const client = getZephyrClient();

  try {
    const resolved = await client.resolveExecutionForDefects({
      executionId: validatedInput.executionId,
      testKey: validatedInput.testKey,
      cycleName: validatedInput.cycleName,
    });

    const writeOptions = {
      replace: validatedInput.replace,
      dryRun: validatedInput.dryRun,
    };

    const targets: DefectLinkTargetResult[] = [];
    targets.push(
      await client.linkDefectsToExecution(resolved, validatedInput.defectKeys, writeOptions)
    );

    // Collect step-level targets: explicit stepResultIds plus any resolved from orderIds.
    const stepResultIds = new Set<string>(validatedInput.stepResultIds ?? []);
    if (validatedInput.orderIds && validatedInput.orderIds.length > 0) {
      const steps = await client.getStepResults(resolved.executionId);
      const idByOrder = new Map(steps.map(s => [s.order, s.id]));
      for (const orderId of validatedInput.orderIds) {
        const stepResultId = idByOrder.get(orderId);
        if (stepResultId) {
          stepResultIds.add(stepResultId);
        } else {
          targets.push({
            target: 'stepResult',
            id: `orderId=${orderId}`,
            before: [],
            after: [],
            added: [],
            written: false,
            error: `No step with orderId ${orderId} in execution ${resolved.executionId}. ` +
              `Available orderIds: ${steps.map(s => s.order).join(', ') || '(none)'}`,
          });
        }
      }
    }

    for (const stepResultId of stepResultIds) {
      targets.push(
        await client.linkDefectsToStepResult(stepResultId, validatedInput.defectKeys, writeOptions)
      );
    }

    const failed = targets.filter(t => t.error);
    return {
      success: failed.length === 0,
      data: {
        dryRun: validatedInput.dryRun,
        replace: validatedInput.replace,
        execution: {
          executionId: resolved.executionId,
          issueId: resolved.issueId,
          issueKey: resolved.issueKey,
          cycleName: resolved.cycleName,
        },
        requestedDefects: validatedInput.defectKeys,
        targets,
      },
      ...(failed.length > 0 && {
        error: failed
          .map(t => `${t.target} ${t.id}: ${t.error}`)
          .join('; '),
      }),
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.message || error.message,
    };
  }
};

export const listTestCycleExecutions = async (input: ListTestCycleExecutionsInput) => {
  const validatedInput = listTestCycleExecutionsSchema.parse(input);

  try {
    const result = await getZephyrClient().getTestCycleExecutions(
      validatedInput.cycleId,
      validatedInput.projectKey,
      validatedInput.versionId
    );

    return {
      success: true,
      data: {
        cycleId: result.cycleId,
        total: result.total,
        executions: result.executions.map(execution => ({
          id: execution.id,
          status: execution.status,
          statusName: execution.statusName,
          issueKey: execution.issueKey,
          summary: execution.summary,
          executedOn: execution.executedOn,
          executedBy: execution.executedBy,
          comment: execution.comment,
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

export const searchTestExecutions = async (input: SearchTestExecutionsInput) => {
  const validatedInput = searchTestExecutionsSchema.parse(input);

  try {
    const result = await getZephyrClient().searchTestExecutions(
      validatedInput.projectKey,
      {
        labels: validatedInput.labels,
        components: validatedInput.components,
        status: validatedInput.status,
        fixVersions: validatedInput.fixVersions,
        cycleNameContains: validatedInput.cycleNameContains,
        cycleNames: validatedInput.cycleNames,
        zql: validatedInput.zql,
      },
      validatedInput.limit,
      validatedInput.offset
    );

    return {
      success: true,
      data: {
        total: result.total,
        count: result.count,
        offset: result.offset,
        hasMore: result.hasMore,
        nextOffset: result.nextOffset,
        zql: result.zql,
        executions: result.executions,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.message || error.message,
    };
  }
};

export const aggregateExecutionsByCycle = async (input: AggregateExecutionsByCycleInput) => {
  const validatedInput = aggregateExecutionsByCycleSchema.parse(input);

  try {
    const result = await getZephyrClient().aggregateExecutionsByCycle(
      validatedInput.projectKey,
      {
        labels: validatedInput.labels,
        components: validatedInput.components,
        fixVersions: validatedInput.fixVersions,
        cycleNameContains: validatedInput.cycleNameContains,
        cycleNames: validatedInput.cycleNames,
        zql: validatedInput.zql,
      },
      validatedInput.maxExecutions
    );

    return {
      success: true,
      data: result,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.message || error.message,
    };
  }
};

export const generateTestReport = async (input: GenerateTestReportInput) => {
  const validatedInput = generateTestReportSchema.parse(input);

  try {
    const report = await getZephyrClient().generateTestReport(validatedInput.cycleId);

    if (validatedInput.format === 'HTML') {
      const htmlReport = generateHtmlReport(report);
      return {
        success: true,
        data: {
          format: 'HTML',
          content: htmlReport,
          generatedOn: report.generatedOn,
        },
      };
    }

    return {
      success: true,
      data: {
        format: 'JSON',
        content: report,
        generatedOn: report.generatedOn,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.message || error.message,
    };
  }
};

const generateHtmlReport = (report: any) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Test Execution Report - ${report.cycleName}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background-color: #f5f5f5; padding: 20px; border-radius: 5px; }
        .summary { display: flex; gap: 20px; margin: 20px 0; }
        .metric { background-color: #e8f4f8; padding: 15px; border-radius: 5px; text-align: center; }
        .metric h3 { margin: 0 0 10px 0; }
        .metric .value { font-size: 24px; font-weight: bold; }
        .executions { margin-top: 30px; }
        .execution { padding: 10px; border-left: 4px solid #ddd; margin: 10px 0; }
        .execution.pass { border-left-color: #4caf50; }
        .execution.fail { border-left-color: #f44336; }
        .execution.blocked { border-left-color: #ff9800; }
        .execution.progress { border-left-color: #2196f3; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Test Execution Report</h1>
        <h2>${report.cycleName || `Cycle ${report.cycleId}`}</h2>
        ${report.versionName ? `<p>Version: ${report.versionName}</p>` : ''}
        <p>Generated: ${new Date(report.generatedOn).toLocaleString()}</p>
      </div>

      <div class="summary">
        <div class="metric">
          <h3>Total Tests</h3>
          <div class="value">${report.summary.total}</div>
        </div>
        <div class="metric">
          <h3>Passed</h3>
          <div class="value">${report.summary.passed}</div>
        </div>
        <div class="metric">
          <h3>Failed</h3>
          <div class="value">${report.summary.failed}</div>
        </div>
        <div class="metric">
          <h3>Blocked</h3>
          <div class="value">${report.summary.blocked}</div>
        </div>
        <div class="metric">
          <h3>Pass Rate</h3>
          <div class="value">${Math.round(report.summary.passRate)}%</div>
        </div>
      </div>

      <div class="executions">
        <h3>Test Executions</h3>
        ${report.executions.map((exec: any) => `
          <div class="execution ${String(exec.status || '').toLowerCase()}">
            <strong>${exec.issueKey || exec.id}</strong> - ${exec.statusName || exec.status}
            ${exec.summary ? `<p>${exec.summary}</p>` : ''}
            ${exec.comment ? `<p>${exec.comment}</p>` : ''}
          </div>
        `).join('')}
      </div>
    </body>
    </html>
  `;
};