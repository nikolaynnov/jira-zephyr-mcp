import axios, { AxiosInstance } from 'axios';
import { getHttpClientOptions, getJiraBaseUrl } from '../utils/config.js';
import { JiraClient } from './jira-client.js';
import {
  RawZapiCycle,
  RawZapiExecution,
  RawZapiExecutionResponse,
  RawZapiSingleExecution,
  RawZapiSingleExecutionResponse,
  RawZapiStatus,
  RawZapiTestStepResponse,
  RawZapiVersionBoard,
  RawZqlExecution,
  RawZqlExecutionResponse,
  RawZqlDefect,
  ZAPI_EXECUTION_STATUS,
  ZAPI_STATUS_NAME_TO_ID,
  DefectLinkTargetResult,
  ResolvedExecutionForDefects,
  ZephyrExecutionSearchResult,
  ZephyrExecutionSearchRow,
  ZephyrExecutionSummary,
  AggregateExecutionsByCycleResult,
  CycleExecutionAggregate,
  ZephyrLinkedDefect,
  ZephyrTestCase,
  ZephyrTestCycle,
  ZephyrTestExecution,
  ZephyrTestReport,
  ZephyrTestStep,
} from '../types/zephyr-types.js';

// Client for Zephyr for JIRA 5.6.3 (Zephyr Squad Server) via ZAPI.
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

  // Server-side execution search via ZQL (Zephyr Query Language). ZQL runs
  // against executions (not issues) and can filter by label/component/status/
  // release/cycle in a single call. Syntax was validated live against the
  // target server; see buildZql for the exact keyword/operator rules.
  async searchTestExecutions(
    projectKey: string,
    options: {
      labels?: string[];
      components?: string[];
      status?: string[];
      fixVersions?: string[];
      cycleNameContains?: string;
      cycleNames?: string[];
      zql?: string;
    } = {},
    limit = 50,
    offset = 0
  ): Promise<ZephyrExecutionSearchResult> {
    const zql = options.zql && options.zql.trim()
      ? options.zql.trim()
      : this.buildZql(projectKey, options);

    const response = await this.zapi.get<RawZqlExecutionResponse>('/zql/executeSearch', {
      params: { zqlQuery: zql, maxRecords: limit, offset },
    });
    const rows = response.data?.executions || [];
    const total = response.data?.totalCount ?? response.data?.executionsCount ?? rows.length;
    const count = rows.length;
    const hasMore = offset + count < total;
    return {
      total,
      count,
      offset,
      hasMore,
      nextOffset: hasMore ? offset + count : undefined,
      zql,
      // ZQL rows carry no executedOnVal, so keep the server's own order.
      executions: rows.map(row => this.normalizeZqlExecution(row)),
    };
  }

  // Build a ZQL query from structured filters. Rules verified live:
  //  - labels/component/fixVersion use IN (...) for "any of" (exact match)
  //  - executionStatus needs the NUMERIC code (names return HTTP 406)
  //  - cycleName ~ "x" is substring; cycleName IN (...) is exact
  private buildZql(
    projectKey: string,
    options: {
      labels?: string[];
      components?: string[];
      status?: string[];
      fixVersions?: string[];
      cycleNameContains?: string;
      cycleNames?: string[];
    }
  ): string {
    const clauses = [`project = "${this.escapeJql(projectKey)}"`];

    const inClause = (field: string, values?: string[]) => {
      const list = (values || []).filter(v => v && v.trim());
      if (list.length) {
        clauses.push(`${field} IN (${list.map(v => `"${this.escapeJql(v)}"`).join(', ')})`);
      }
    };

    inClause('labels', options.labels);
    inClause('component', options.components);
    inClause('fixVersion', options.fixVersions);
    inClause('cycleName', options.cycleNames);

    const statusIds = (options.status || [])
      .map(name => ZAPI_STATUS_NAME_TO_ID[name])
      .filter(id => id !== undefined);
    if (statusIds.length) {
      clauses.push(`executionStatus IN (${statusIds.join(', ')})`);
    }

    if (options.cycleNameContains && options.cycleNameContains.trim()) {
      clauses.push(`cycleName ~ "${this.escapeJql(options.cycleNameContains)}"`);
    }

    return clauses.join(' AND ');
  }

  // Roll up executions by cycle for whole-period / outlier analysis. Runs one
  // ZQL query (same filters as searchTestExecutions), paginates ALL matches
  // server-side (verified uncapped), and returns per-cycle status breakdowns -
  // never the raw rows. This is the right tool for "analyze a year of regression
  // cycles and flag the ones that stand out"; search_test_executions is for
  // listing individual runs.
  async aggregateExecutionsByCycle(
    projectKey: string,
    options: {
      labels?: string[];
      components?: string[];
      fixVersions?: string[];
      cycleNameContains?: string;
      cycleNames?: string[];
      zql?: string;
    } = {},
    maxExecutions = 10000
  ): Promise<AggregateExecutionsByCycleResult> {
    const zql = options.zql && options.zql.trim()
      ? options.zql.trim()
      : this.buildZql(projectKey, options);

    const pageSize = 1000;
    const groups = new Map<string, {
      cycleId?: string;
      cycleName?: string;
      versionName?: string;
      summary: ZephyrExecutionSummary;
      defectKeys: Set<string>;
    }>();

    let totalMatched = 0;
    let scanned = 0;
    let offset = 0;

    // Page until we've pulled every match or hit the safety ceiling. A short
    // page (fewer rows than requested) means we've reached the end.
    while (scanned < maxExecutions) {
      const remaining = maxExecutions - scanned;
      const maxRecords = Math.min(pageSize, remaining);
      const response = await this.zapi.get<RawZqlExecutionResponse>('/zql/executeSearch', {
        params: { zqlQuery: zql, maxRecords, offset },
      });
      const rows = response.data?.executions || [];
      totalMatched = response.data?.totalCount ?? response.data?.executionsCount ?? totalMatched;

      for (const raw of rows) {
        const row = this.normalizeZqlExecution(raw);
        const key = row.cycleId ?? `${row.cycleName ?? ''}|${row.versionName ?? ''}`;
        let group = groups.get(key);
        if (!group) {
          group = {
            cycleId: row.cycleId,
            cycleName: row.cycleName,
            versionName: row.versionName,
            summary: this.emptySummary(),
            defectKeys: new Set<string>(),
          };
          groups.set(key, group);
        }
        this.bucketStatus(group.summary, row.status);
        for (const key of row.defectKeys) group.defectKeys.add(key);
      }

      scanned += rows.length;
      offset += rows.length;
      if (rows.length < maxRecords || scanned >= totalMatched) break;
    }

    const DEFECT_SAMPLE = 25;
    const cycles: CycleExecutionAggregate[] = [...groups.values()].map(g => {
      const s = g.summary;
      s.passRate = s.total > 0 ? (s.passed / s.total) * 100 : 0;
      // executed = runs with a verdict; failRate ignores not-yet-run tests so an
      // unfinished cycle isn't mistaken for a failing one.
      const executed = s.passed + s.failed + s.blocked;
      const failRate = executed > 0 ? (s.failed / executed) * 100 : 0;
      const defectKeys = [...g.defectKeys];
      return {
        cycleId: g.cycleId,
        cycleName: g.cycleName,
        versionName: g.versionName,
        summary: s,
        executed,
        failRate,
        defectCount: defectKeys.length,
        defectKeys: defectKeys.slice(0, DEFECT_SAMPLE),
      };
    });

    // Highest fail rate first so quality outliers surface at the top; break ties
    // by how much was actually executed (a 100% failRate over 20 runs outranks
    // one over 2), then by defect count.
    cycles.sort((a, b) =>
      b.failRate - a.failRate ||
      b.executed - a.executed ||
      b.defectCount - a.defectCount
    );

    return {
      zql,
      totalMatched,
      executionsScanned: scanned,
      truncated: totalMatched > scanned,
      cycleCount: cycles.length,
      cycles,
    };
  }

  // Increment the matching summary bucket for a normalized status name.
  // Mirrors summarizeExecutions but works on the ZQL-mapped status string.
  private bucketStatus(summary: ZephyrExecutionSummary, status: string): void {
    summary.total++;
    switch (status) {
      case 'PASS': summary.passed++; break;
      case 'FAIL': summary.failed++; break;
      case 'BLOCKED': summary.blocked++; break;
      case 'WIP': summary.inProgress++; break;
      default: summary.notExecuted++;
    }
  }

  private normalizeZqlExecution(raw: RawZqlExecution): ZephyrExecutionSearchRow {
    const statusId = raw.status?.id !== undefined
      ? String(raw.status.id)
      : String(raw.executionStatus ?? '');
    const defects = this.collectDefects(raw);
    return {
      id: String(raw.id),
      status: ZAPI_EXECUTION_STATUS[statusId] || raw.status?.name || statusId,
      statusName: raw.status?.name,
      issueId: raw.issueId !== undefined ? String(raw.issueId) : undefined,
      issueKey: raw.issueKey,
      summary: raw.issueSummary,
      labels: raw.labels || [],
      components: (raw.components || []).map(c => c?.name || '').filter(Boolean),
      priority: raw.priority,
      cycleId: raw.cycleId !== undefined ? String(raw.cycleId) : undefined,
      cycleName: raw.cycleName,
      versionName: raw.versionName,
      executedOn: raw.executedOn || raw.creationDate || undefined,
      executedBy: raw.executedByDisplay || raw.executedBy || undefined,
      defectKeys: defects.map(d => d.key),
      defects,
    };
  }

  // Merge the three defect sources ZQL returns (executionDefects, stepDefects,
  // testDefectsUnMasked) into a de-duplicated list of linked defect issues.
  // Entries may be rich objects (defectKey/defectSummary/defectStatus) or bare
  // issue-key strings, so both shapes are handled.
  private collectDefects(raw: RawZqlExecution): ZephyrLinkedDefect[] {
    const byKey = new Map<string, ZephyrLinkedDefect>();
    const browseBase = `${getJiraBaseUrl()}/browse`;
    const add = (entry: RawZqlDefect | string | undefined) => {
      if (!entry) return;
      const defect: ZephyrLinkedDefect = typeof entry === 'string'
        ? { key: entry }
        : { key: entry.defectKey || '', summary: entry.defectSummary, status: entry.defectStatus };
      if (!defect.key) return;
      defect.url = `${browseBase}/${defect.key}`;
      const existing = byKey.get(defect.key);
      if (!existing) {
        byKey.set(defect.key, defect);
      } else {
        existing.summary = existing.summary || defect.summary;
        existing.status = existing.status || defect.status;
      }
    };
    (raw.executionDefects || []).forEach(add);
    (raw.stepDefects || []).forEach(add);
    (raw.testDefectsUnMasked || []).forEach(add);
    return [...byKey.values()];
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
      stepDefectCount: raw.stepDefectCount || undefined,
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

  async searchTestCases(
    projectKey: string,
    options: { text?: string; labels?: string[]; components?: string[] } = {},
    limit = 50
  ): Promise<{
    testCases: ZephyrTestCase[];
    total: number;
  }> {
    const testIssueType = await this.jira.resolveTestIssueType();
    const clauses = [`project = "${projectKey}"`];
    if (testIssueType) {
      clauses.push(`issuetype = "${testIssueType}"`);
    }
    // Exact label filter: labels IN ("a", "b") = "has any of these labels".
    const labels = (options.labels || []).filter(l => l.trim());
    if (labels.length) {
      clauses.push(`labels IN (${labels.map(l => `"${this.escapeJql(l)}"`).join(', ')})`);
    }
    // Exact component filter: component IN (...).
    const components = (options.components || []).filter(c => c.trim());
    if (components.length) {
      clauses.push(`component IN (${components.map(c => `"${this.escapeJql(c)}"`).join(', ')})`);
    }
    // Free-text keyword match (explicitly not JQL): scoped to summary/description.
    if (options.text && options.text.trim()) {
      const escaped = this.escapeJql(options.text);
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

  private escapeJql(value: string): string {
    return value.replace(/"/g, '\\"');
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
  // Accepts an issue key (e.g. QA-1246) or a numeric issue id. Labels/components
  // are returned once at the top level (they belong to the test case, not to
  // each run) so callers can filter by "modules" without a second lookup.
  async getTestCaseExecutions(testCaseId: string): Promise<{
    testCaseId: string;
    issueKey?: string;
    issueId: string;
    labels: string[];
    components: string[];
    total: number;
    lastExecution?: ZephyrTestExecution;
    executions: ZephyrTestExecution[];
  }> {
    const issue = await this.jira.getIssue(testCaseId, ['summary', 'labels', 'components']);
    const issueId = String(issue.id);
    const executions = await this.getExecutionsForIssueId(issueId);
    return {
      testCaseId,
      issueKey: issue.key,
      issueId,
      labels: issue.fields?.labels || [],
      components: (issue.fields?.components || []).map((c: { name: string }) => c.name),
      total: executions.length,
      lastExecution: executions[0],
      executions,
    };
  }

  // ---- step results --------------------------------------------------------

  // GET /rest/zapi/latest/stepResult?executionId={execId} returns a list of
  // step results with their ids. This is needed to link defects at the step level.
  async getStepResults(executionId: string): Promise<{ id: string; order: number; status: string }[]> {
    const response = await this.zapi.get('/stepResult', { params: { executionId } });
    // ZAPI returns { stepResults: [...] } or a bare array.
    const list = response.data?.stepResults ?? response.data ?? [];
    return (Array.isArray(list) ? list : []).map((s: any) => ({
      id: String(s.id),
      order: s.orderId ?? s.order ?? s.stepOrder ?? 0,
      status: s.status ?? s.executionStatus ?? '',
    }));
  }

  // ---- defect linking (write) --------------------------------------------

  // Resolve the execution to attach defects to, either directly by executionId
  // or by (testKey + cycleName). Returns the execution id, the Test issue id
  // (required in the /execute PUT body) and the current defect keys (for merge).
  async resolveExecutionForDefects(input: {
    executionId?: string;
    testKey?: string;
    cycleName?: string;
  }): Promise<ResolvedExecutionForDefects> {
    if (input.executionId && input.executionId.trim()) {
      return this.readExecutionById(input.executionId.trim());
    }
    if (!input.testKey || !input.cycleName) {
      throw new Error('Provide executionId, or both testKey and cycleName.');
    }
    const issue = await this.jira.getIssue(input.testKey, ['summary']);
    const issueId = String(issue.id);
    const { executions } = await this.fetchExecutionsByIssue(issueId);
    const wanted = input.cycleName.trim().toLowerCase();
    const matches = executions.filter(
      e => (e.cycleName || '').trim().toLowerCase() === wanted
    );
    if (matches.length === 0) {
      const available = [...new Set(executions.map(e => e.cycleName).filter(Boolean))];
      throw new Error(
        `No execution of ${input.testKey} in cycle "${input.cycleName}". ` +
        `Available cycles: ${available.join(' | ') || '(none)'}`
      );
    }
    if (matches.length > 1) {
      const ids = matches.map(e => e.id).join(', ');
      throw new Error(
        `${matches.length} executions of ${input.testKey} match cycle "${input.cycleName}" ` +
        `(executionIds: ${ids}). Pass executionId to disambiguate.`
      );
    }
    return this.readExecutionById(String(matches[0].id));
  }

  // GET a single execution and extract issueId + current defect keys. Handles
  // both the bare and { execution: {...} } response envelopes.
  private async readExecutionById(executionId: string): Promise<ResolvedExecutionForDefects> {
    const response = await this.zapi.get<RawZapiSingleExecution & RawZapiSingleExecutionResponse>(
      `/execution/${executionId}`
    );
    const exec = response.data?.execution ?? response.data ?? {};
    const issueId = exec.issueId !== undefined ? String(exec.issueId) : '';
    if (!issueId) {
      throw new Error(`Execution ${executionId} did not return an issueId.`);
    }
    return {
      executionId: String(exec.id ?? executionId),
      issueId,
      issueKey: exec.issueKey,
      cycleName: exec.cycleName,
      currentDefects: this.extractDefectKeys(exec.defects),
    };
  }

  private extractDefectKeys(defects: RawZapiSingleExecution['defects']): string[] {
    if (!Array.isArray(defects)) return [];
    return defects
      .map(d => (typeof d === 'string' ? d : d?.key ?? d?.defectKey ?? ''))
      .filter((k): k is string => Boolean(k));
  }

  // Union current + new defect keys unless replacing. Returns the final list.
  private mergeDefects(current: string[], toAdd: string[], replace: boolean): string[] {
    if (replace) return [...new Set(toAdd)];
    return [...new Set([...current, ...toAdd])];
  }

  // Attach defects to an EXECUTION via PUT /rest/zapi/latest/execution/{id}/execute.
  // This mirrors the JIRA UI call and also auto-creates the native JIRA link.
  // When dryRun is true, returns the payload without writing.
  async linkDefectsToExecution(
    resolved: ResolvedExecutionForDefects,
    defectKeys: string[],
    options: { replace?: boolean; dryRun?: boolean } = {}
  ): Promise<DefectLinkTargetResult> {
    const before = resolved.currentDefects;
    const after = this.mergeDefects(before, defectKeys, Boolean(options.replace));
    const added = after.filter(k => !before.includes(k));
    const result: DefectLinkTargetResult = {
      target: 'execution',
      id: resolved.executionId,
      before,
      after,
      added,
      written: false,
    };
    if (options.dryRun) return result;
    try {
      await this.zapi.put(`/execution/${resolved.executionId}/execute`, {
        defectList: after,
        issueId: Number(resolved.issueId) || resolved.issueId,
        comment: '',
        updateDefectList: 'true',
        changeAssignee: false,
      });
      result.written = true;
    } catch (error: any) {
      result.error = error.response?.data?.message || error.message;
    }
    return result;
  }

  // Attach defects to a single STEP RESULT via PUT /stepResult/{stepResultId}.
  // Reads the step's current defects first so merge does not drop existing links.
  async linkDefectsToStepResult(
    stepResultId: string,
    defectKeys: string[],
    options: { replace?: boolean; dryRun?: boolean } = {}
  ): Promise<DefectLinkTargetResult> {
    let before: string[] = [];
    try {
      const cur = await this.zapi.get<RawZapiSingleExecution>(`/stepResult/${stepResultId}`);
      before = this.extractDefectKeys(cur.data?.defects);
    } catch {
      before = [];
    }
    const after = this.mergeDefects(before, defectKeys, Boolean(options.replace));
    const added = after.filter(k => !before.includes(k));
    const result: DefectLinkTargetResult = {
      target: 'stepResult',
      id: String(stepResultId),
      before,
      after,
      added,
      written: false,
    };
    if (options.dryRun) return result;
    try {
      await this.zapi.put(`/stepResult/${stepResultId}`, {
        updateDefectList: 'true',
        defectList: after,
      });
      result.written = true;
    } catch (error: any) {
      result.error = error.response?.data?.message || error.message;
    }
    return result;
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
