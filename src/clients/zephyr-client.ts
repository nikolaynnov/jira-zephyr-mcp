import axios, { AxiosInstance } from 'axios';
import { getHttpClientOptions, getJiraBaseUrl } from '../utils/config.js';
import { JiraClient } from './jira-client.js';
import {
  RawZapiCycle,
  RawZapiExecution,
  RawZapiExecutionResponse,
  RawZapiStatus,
  RawZapiTestStepResponse,
  RawZapiVersionBoard,
  ZAPI_EXECUTION_STATUS,
  ZephyrExecutionSummary,
  ZephyrTestCase,
  ZephyrTestCycle,
  ZephyrTestExecution,
  ZephyrTestReport,
  ZephyrTestStep,
} from '../types/zephyr-types.js';

// Read-only client for Zephyr for JIRA 5.6.3 (Zephyr Squad Server) via ZAPI.
// ZAPI is hosted on the same JIRA instance under /rest/zapi/latest and shares
// the JIRA session, so it reuses the JIRA auth/HTTP options and a JiraClient for
// project / issue / issue-type resolution.
export class ZephyrClient {
  private zapi: AxiosInstance;
  private jira: JiraClient;

  constructor(jira?: JiraClient) {
    this.jira = jira ?? new JiraClient();
    this.zapi = axios.create({
      baseURL: `${getJiraBaseUrl()}/rest/zapi/latest`,
      ...getHttpClientOptions(),
    });
  }

  // ---- test cycles -------------------------------------------------------

  async getTestCycles(projectKey: string, versionId?: string, limit = 50): Promise<{
    testCycles: ZephyrTestCycle[];
    total: number;
  }> {
    const projectId = await this.jira.resolveProjectId(projectKey);
    const versionIds = versionId
      ? [versionId]
      : await this.getVersionIds(projectId);

    const testCycles: ZephyrTestCycle[] = [];
    for (const vId of versionIds) {
      if (testCycles.length >= limit) {
        break;
      }
      const cycles = await this.getCyclesForVersion(projectId, vId);
      for (const cycle of cycles) {
        testCycles.push(cycle);
        if (testCycles.length >= limit) {
          break;
        }
      }
    }

    // Enrich each listed cycle with its execution status breakdown.
    for (const cycle of testCycles) {
      cycle.executionSummary = await this.getTestExecutionSummary(
        cycle.id,
        projectId,
        cycle.versionId
      );
    }

    return { testCycles, total: testCycles.length };
  }

  async getTestCycle(cycleId: string, projectKey?: string): Promise<ZephyrTestCycle | null> {
    // ZAPI has no "get cycle by id" endpoint; scan the project's cycles.
    if (!projectKey) {
      return null;
    }
    const projectId = await this.jira.resolveProjectId(projectKey);
    const versionIds = await this.getVersionIds(projectId);
    for (const vId of versionIds) {
      const cycles = await this.getCyclesForVersion(projectId, vId);
      const match = cycles.find(c => c.id === String(cycleId));
      if (match) {
        match.executionSummary = await this.getTestExecutionSummary(match.id, projectId, match.versionId);
        return match;
      }
    }
    return null;
  }

  private async getVersionIds(projectId: string): Promise<string[]> {
    const response = await this.zapi.get<RawZapiVersionBoard>('/util/versionBoard-list', {
      params: { projectId },
    });
    const board = response.data || {};
    const options = [
      ...(board.unreleasedVersions || []),
      ...(board.releasedVersions || []),
    ];
    const ids = options.map(v => String(v.value));
    // Always include the "Unscheduled" version (-1) even if the board omits it.
    if (!ids.includes('-1')) {
      ids.unshift('-1');
    }
    return Array.from(new Set(ids));
  }

  private async getCyclesForVersion(projectId: string, versionId: string): Promise<ZephyrTestCycle[]> {
    const response = await this.zapi.get<Record<string, unknown>>('/cycle', {
      params: { projectId, versionId },
    });
    const data = response.data || {};
    const cycles: ZephyrTestCycle[] = [];
    for (const [cycleId, value] of Object.entries(data)) {
      // The map mixes cycle objects with scalar meta keys (e.g. recordsCount).
      if (!value || typeof value !== 'object') {
        continue;
      }
      cycles.push(this.normalizeCycle(cycleId, value as RawZapiCycle));
    }
    return cycles;
  }

  private normalizeCycle(cycleId: string, raw: RawZapiCycle): ZephyrTestCycle {
    return {
      id: String(cycleId),
      name: raw.name || '',
      description: raw.description || undefined,
      projectId: raw.projectId !== undefined ? String(raw.projectId) : '',
      projectKey: raw.projectKey,
      versionId: raw.versionId !== undefined ? String(raw.versionId) : '',
      versionName: raw.versionName,
      environment: raw.environment || undefined,
      build: raw.build || undefined,
      totalExecutions: raw.totalCycleExecutions ?? raw.totalExecutions ?? 0,
      totalExecuted: raw.totalExecuted ?? 0,
      createdBy: raw.createdByDisplay || raw.createdBy,
      createdOn: raw.createdDate || undefined,
      executionSummary: this.emptySummary(),
    };
  }

  // ---- executions --------------------------------------------------------

  private async fetchExecutions(
    cycleId: string,
    projectId?: string,
    versionId?: string
  ): Promise<{ executions: RawZapiExecution[]; statusMap: Record<string, RawZapiStatus> }> {
    const params: Record<string, string | number> = { cycleId };
    if (projectId) params.projectId = projectId;
    if (versionId !== undefined) params.versionId = versionId;

    const response = await this.zapi.get<RawZapiExecutionResponse>('/execution', { params });
    return {
      executions: response.data?.executions || [],
      statusMap: response.data?.status || {},
    };
  }

  // ZAPI returns every execution of a single Test issue across all cycles when
  // queried by issueId (verified: same envelope as the cycleId query).
  private async fetchExecutionsByIssue(
    issueId: string
  ): Promise<{ executions: RawZapiExecution[]; statusMap: Record<string, RawZapiStatus> }> {
    const response = await this.zapi.get<RawZapiExecutionResponse>('/execution', {
      params: { issueId },
    });
    return {
      executions: response.data?.executions || [],
      statusMap: response.data?.status || {},
    };
  }

  // Newest-first by execution timestamp; unexecuted rows (no executedOnVal) last.
  private sortNewestFirst(executions: RawZapiExecution[]): RawZapiExecution[] {
    return [...executions].sort(
      (a, b) => (Number(b.executedOnVal) || 0) - (Number(a.executedOnVal) || 0)
    );
  }

  // Per-cycle execution list (the detail behind the aggregate summary).
  async getTestCycleExecutions(
    cycleId: string,
    projectKey?: string,
    versionId?: string
  ): Promise<{ cycleId: string; total: number; executions: ZephyrTestExecution[] }> {
    const projectId = projectKey ? await this.jira.resolveProjectId(projectKey) : undefined;
    const { executions, statusMap } = await this.fetchExecutions(cycleId, projectId, versionId);
    const sorted = this.sortNewestFirst(executions);
    return {
      cycleId: String(cycleId),
      total: sorted.length,
      executions: sorted.map(e => this.normalizeExecution(e, statusMap)),
    };
  }

  async getTestExecutionSummary(
    cycleId: string,
    projectId?: string,
    versionId?: string
  ): Promise<ZephyrExecutionSummary> {
    const { executions } = await this.fetchExecutions(cycleId, projectId, versionId);
    return this.summarizeExecutions(executions);
  }

  async generateTestReport(cycleId: string): Promise<ZephyrTestReport> {
    const { executions, statusMap } = await this.fetchExecutions(cycleId);
    const normalized = executions.map(e => this.normalizeExecution(e, statusMap));
    const first = executions[0];

    return {
      cycleId: String(cycleId),
      cycleName: first?.cycleName,
      projectId: first?.projectId !== undefined ? String(first.projectId) : undefined,
      versionName: first?.versionName,
      summary: this.summarizeExecutions(executions),
      executions: normalized,
      generatedOn: new Date().toISOString(),
    };
  }

  private normalizeExecution(
    raw: RawZapiExecution,
    statusMap: Record<string, RawZapiStatus>
  ): ZephyrTestExecution {
    const statusId = String(raw.executionStatus);
    return {
      id: String(raw.id),
      status: ZAPI_EXECUTION_STATUS[statusId] || statusId,
      statusName: statusMap[statusId]?.name,
      issueId: raw.issueId !== undefined ? String(raw.issueId) : undefined,
      issueKey: raw.issueKey,
      summary: raw.summary,
      comment: raw.comment || undefined,
      executedOn: raw.executedOn || undefined,
      executedBy: raw.executedByDisplay || raw.executedBy,
      cycleId: raw.cycleId !== undefined ? String(raw.cycleId) : undefined,
      cycleName: raw.cycleName,
      versionName: raw.versionName,
    };
  }

  private summarizeExecutions(executions: RawZapiExecution[]): ZephyrExecutionSummary {
    const summary = this.emptySummary();
    for (const execution of executions) {
      summary.total++;
      const status = ZAPI_EXECUTION_STATUS[String(execution.executionStatus)];
      switch (status) {
        case 'PASS':
          summary.passed++;
          break;
        case 'FAIL':
          summary.failed++;
          break;
        case 'BLOCKED':
          summary.blocked++;
          break;
        case 'WIP':
          summary.inProgress++;
          break;
        default:
          summary.notExecuted++;
      }
    }
    summary.passRate = summary.total > 0 ? (summary.passed / summary.total) * 100 : 0;
    return summary;
  }

  private emptySummary(): ZephyrExecutionSummary {
    return { total: 0, passed: 0, failed: 0, blocked: 0, inProgress: 0, notExecuted: 0, passRate: 0 };
  }

  // ---- test cases (JIRA issues of the "Test" type) -----------------------

  async searchTestCases(projectKey: string, query?: string, limit = 50): Promise<{
    testCases: ZephyrTestCase[];
    total: number;
  }> {
    const testIssueType = await this.jira.resolveTestIssueType();
    const clauses = [`project = "${projectKey}"`];
    if (testIssueType) {
      clauses.push(`issuetype = "${testIssueType}"`);
    }
    if (query && query.trim()) {
      const escaped = query.replace(/"/g, '\\"');
      clauses.push(`(summary ~ "${escaped}" OR text ~ "${escaped}")`);
    }
    const jql = clauses.join(' AND ');

    const { issues, total } = await this.jira.searchIssues(
      jql,
      ['summary', 'status', 'priority', 'labels', 'components', 'project', 'created', 'issuetype'],
      limit
    );

    // Steps require a per-issue ZAPI call, so they are omitted from search
    // results for performance; use get_test_case for the full test case.
    const testCases = issues.map(issue => this.issueToTestCase(issue, []));
    return { testCases, total };
  }

  async getTestCase(testCaseId: string, includeExecutions = false): Promise<ZephyrTestCase> {
    const issue = await this.jira.getIssue(testCaseId, [
      'summary',
      'description',
      'status',
      'priority',
      'labels',
      'components',
      'project',
      'created',
      'issuetype',
    ]);

    let steps: ZephyrTestStep[] = [];
    try {
      const response = await this.zapi.get<RawZapiTestStepResponse>(`/teststep/${issue.id}`);
      const raw = response.data?.stepBeanCollection || [];
      steps = raw.map(s => ({
        id: s.id,
        orderId: s.orderId,
        description: s.step,
        testData: s.data || undefined,
        expectedResult: s.result || undefined,
      }));
    } catch {
      // A Test issue without steps (or steps not accessible) still returns the case.
      steps = [];
    }

    const testCase = this.issueToTestCase(issue, steps);

    if (includeExecutions) {
      const executions = await this.getExecutionsForIssueId(String(issue.id));
      testCase.executions = executions;
      testCase.lastExecution = executions[0];
    }

    return testCase;
  }

  // Execution history of a single Test issue across all cycles (newest-first).
  // Accepts an issue key (e.g. QA-1246) or a numeric issue id.
  async getTestCaseExecutions(testCaseId: string): Promise<{
    testCaseId: string;
    issueKey?: string;
    issueId: string;
    total: number;
    lastExecution?: ZephyrTestExecution;
    executions: ZephyrTestExecution[];
  }> {
    const issue = await this.jira.getIssue(testCaseId, ['summary']);
    const issueId = String(issue.id);
    const executions = await this.getExecutionsForIssueId(issueId);
    return {
      testCaseId,
      issueKey: issue.key,
      issueId,
      total: executions.length,
      lastExecution: executions[0],
      executions,
    };
  }

  private async getExecutionsForIssueId(issueId: string): Promise<ZephyrTestExecution[]> {
    const { executions, statusMap } = await this.fetchExecutionsByIssue(issueId);
    return this.sortNewestFirst(executions).map(e => this.normalizeExecution(e, statusMap));
  }

  private issueToTestCase(issue: any, steps: ZephyrTestStep[]): ZephyrTestCase {
    const fields = issue.fields || {};
    return {
      id: String(issue.id),
      key: issue.key,
      name: fields.summary || '',
      objective: fields.description || undefined,
      status: fields.status?.name,
      priority: fields.priority?.name,
      labels: fields.labels || [],
      components: (fields.components || []).map((c: { name: string }) => c.name),
      project: fields.project
        ? { key: fields.project.key, name: fields.project.name }
        : undefined,
      createdOn: fields.created || undefined,
      steps,
    };
  }
}
