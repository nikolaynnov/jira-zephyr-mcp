import axios, { AxiosInstance } from 'axios';
import { getConfiguredTestIssueType, getHttpClientOptions, getJiraBaseUrl } from '../utils/config.js';
import { JiraIssue, JiraProject, JiraVersion } from '../types/jira-types.js';

// JIRA 8.12 Server exposes REST v2 (Cloud-only v3/ADF is not available here).
export class JiraClient {
  private client: AxiosInstance;
  private projectIdCache = new Map<string, string>();
  private testIssueType?: string;

  constructor() {
    this.client = axios.create({
      baseURL: `${getJiraBaseUrl()}/rest/api/2`,
      ...getHttpClientOptions(),
    });
  }

  async getIssue(issueKey: string, fields?: string[]): Promise<JiraIssue> {
    const params = fields ? { fields: fields.join(',') } : {};
    const response = await this.client.get(`/issue/${issueKey}`, { params });
    return response.data;
  }

  async getProject(projectKey: string): Promise<JiraProject> {
    const response = await this.client.get(`/project/${projectKey}`);
    return response.data;
  }

  async getProjectVersions(projectKey: string): Promise<JiraVersion[]> {
    const response = await this.client.get(`/project/${projectKey}/versions`);
    return response.data;
  }

  async searchIssues(jql: string, fields?: string[], maxResults = 50): Promise<{
    issues: JiraIssue[];
    total: number;
  }> {
    const params = {
      jql,
      fields: fields?.join(',') || '*all',
      maxResults,
    };

    const response = await this.client.get('/search', { params });
    return {
      issues: response.data.issues,
      total: response.data.total,
    };
  }

  // ---- write operations (REST v2) ---------------------------------------
  // Out of scope for the read-only iteration but kept available so callers can
  // opt in; on JIRA Server/DC the description is plain text (no Cloud ADF) and
  // the assignee is a username (no Cloud accountId).
  async createIssue(issueData: {
    projectKey: string;
    summary: string;
    description?: string;
    issueType: string;
    priority?: string;
    assignee?: string;
    labels?: string[];
    components?: string[];
  }): Promise<JiraIssue> {
    const payload = {
      fields: {
        project: { key: issueData.projectKey },
        summary: issueData.summary,
        description: issueData.description,
        issuetype: { name: issueData.issueType },
        priority: issueData.priority ? { name: issueData.priority } : undefined,
        assignee: issueData.assignee ? { name: issueData.assignee } : undefined,
        labels: issueData.labels,
        components: issueData.components?.map(name => ({ name })),
      },
    };

    const response = await this.client.post('/issue', payload);
    return this.getIssue(response.data.key);
  }

  async linkIssues(inwardIssueKey: string, outwardIssueKey: string, linkType: string): Promise<void> {
    const payload = {
      type: { name: linkType },
      inwardIssue: { key: inwardIssueKey },
      outwardIssue: { key: outwardIssueKey },
    };

    await this.client.post('/issueLink', payload);
  }

  // ZAPI works with numeric project ids; resolve and cache the projectKey -> id.
  async resolveProjectId(projectKey: string): Promise<string> {
    const cached = this.projectIdCache.get(projectKey);
    if (cached) {
      return cached;
    }
    const project = await this.getProject(projectKey);
    const id = String(project.id);
    this.projectIdCache.set(projectKey, id);
    return id;
  }

  // In Zephyr Squad a "test case" is a JIRA issue of the "Test" type, whose name
  // is often localized (e.g. "Тест"). Use the configured value, otherwise
  // auto-detect it from the instance's issue types.
  async resolveTestIssueType(): Promise<string | undefined> {
    if (this.testIssueType) {
      return this.testIssueType;
    }
    const configured = getConfiguredTestIssueType();
    if (configured) {
      this.testIssueType = configured;
      return configured;
    }
    try {
      const response = await this.client.get('/issuetype');
      const types: Array<{ name?: string }> = Array.isArray(response.data) ? response.data : [];
      const exact = types.find(t => /^(test|тест)$/i.test(String(t.name)));
      const fuzzy = types.find(t => /(test|тест)/i.test(String(t.name)));
      this.testIssueType = (exact || fuzzy)?.name || undefined;
    } catch {
      this.testIssueType = undefined;
    }
    return this.testIssueType;
  }
}