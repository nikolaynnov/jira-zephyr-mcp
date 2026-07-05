# JIRA Zephyr MCP Server
[![License: MIT + NPF 1.0](https://img.shields.io/badge/License-MIT%20%2B%20NPF%201.0-e25822.svg)](LICENSE)

A Model Context Protocol (MCP) server that provides comprehensive integration with JIRA's Zephyr test management system. This server enables seamless test management operations including creating test plans, managing test cycles, executing tests, and reading JIRA issues.

## Fork: JIRA 8.12 Server + Zephyr for JIRA 5.6.3

> **This fork targets an on-prem JIRA, not JIRA Cloud / Zephyr Scale.**
>
> Upstream talks to JIRA Cloud (`/rest/api/3`) and Zephyr Scale Cloud
> (`https://api.zephyrscale.smartbear.com/v2`). This fork retargets it to a
> self-hosted **JIRA 8.12 Server / Data Center** with the
> **Zephyr for JIRA 5.6.3 (Zephyr Squad Server / ZAPI)** add-on.

### Goals

- **Authentication** - support self-hosted JIRA auth in two modes: **login +
  password** HTTP Basic (works on any version, incl. JIRA < 8.14) and
  **Personal Access Token** Bearer (JIRA 8.14+). Switching to a PAT later is
  just an env change.
- **JIRA REST** - target `/rest/api/2` instead of the Cloud-only `/rest/api/3`
  (plain-text issue descriptions instead of ADF, `assignee` by `name`).
- **Zephyr REST** - talk to the **ZAPI** endpoints hosted on the JIRA server
  (`/rest/zapi/latest/...`) using the same JIRA session - no separate Zephyr token.
- **First milestone** - get all **read-only** tools working end-to-end.

### Platform differences that shape the fork

| Concept | Zephyr Scale (Cloud, upstream) | Zephyr Squad 5.6.3 (this fork) |
|---------|--------------------------------|--------------------------------|
| Base URL | `api.zephyrscale.smartbear.com/v2` | `<jira>/rest/zapi/latest` |
| Auth | `Bearer <ZEPHYR_API_TOKEN>` | JIRA Basic (login/password) |
| Test case | first-class entity | a JIRA issue of type `Test` (+ ZAPI test steps) |
| Test cycle | `testcycles` | ZAPI `cycle` (needs numeric `projectId` / `versionId`) |
| Execution status | `PASS` / `FAIL` / `WIP` / `BLOCKED` | numeric IDs (1/2/3/4, `-1` unexecuted; configurable) |
| **Test plan** | supported | **not supported** - no such concept in Zephyr Squad |

> `create_test_plan` and `list_test_plans` will be disabled in this fork with an
> explicit "not supported in Zephyr Squad" message.

### API compatibility probe

Before rewriting the clients, verify every endpoint the read-only tools rely on is
available on your server. The probe issues **GET** requests only (safe for prod):

1. Copy `.env.probe.example` to `.env` and fill in your JIRA URL, login and password.
2. Install dev dependencies once (`npm install`), then run:

```bash
npm run check-api
```

The script prints a support matrix (`[ OK ]` / `[FAIL]` / `[SKIP]`) for each endpoint
and the read-only tool that depends on it.

> **Verified:** on a JIRA 8.12 + Zephyr for JIRA 5.6.3 instance every read-only
> endpoint above returns `200` with login/password Basic auth. Two findings feed into
> the client rewrite: the JIRA host is reached **directly** (the probe bypasses the
> corporate Squid proxy), and the *Test* issue type may be **localized** (e.g. `Тест`),
> so it must be configurable rather than hard-coded.

## Features

### Core Capabilities
- **Test Plan Management**: Create and list test plans in Zephyr
- **Test Cycle Management**: Create and manage test execution cycles
- **JIRA Integration**: Read JIRA issue details and metadata
- **Test Execution**: Update test execution results and status
- **Progress Tracking**: Monitor test execution progress and statistics
- **Issue Linking**: Associate test cases with JIRA issues
- **Reporting**: Generate comprehensive test execution reports

### Available Tools

**Read-only (implemented for this fork):**

1. **read_jira_issue** - Retrieve JIRA issue information
2. **list_test_cycles** - View test cycles for a project with aggregate execution status
3. **get_test_execution_status** - Aggregate pass/fail/blocked counts and pass rate for a cycle
4. **list_test_cycle_executions** - List the individual test executions inside a cycle (which tests ran, with status/date/executor)
5. **generate_test_report** - Test execution report for a cycle (JSON includes the full executions list; HTML renders a page)
6. **search_test_cases** - Search test cases (JIRA issues of the Test type) in a project
7. **get_test_case** - Get a test case with its Zephyr steps; optional `includeExecutions` adds its run history
8. **get_test_case_executions** - Execution history of a single test across all cycles, newest first (status, date, executor, cycle, version/release)

**Not implemented in the current read-only iteration** (return an explanatory error): `create_test_cycle`, `execute_test`, `link_tests_to_issues`, `create_test_case`, `create_multiple_test_cases`.

**Not supported on Zephyr Squad** (the platform has no Test Plan concept): `create_test_plan`, `list_test_plans`.

## Prerequisites

- Node.js 18.0.0 or higher
- JIRA Server/Data Center 8.12+ with the Zephyr for JIRA (Zephyr Squad) add-on
- Valid JIRA credentials (login + password, or a Personal Access Token on JIRA 8.14+)


### Integration with Cursor

Clone the project, then add the following to your Cursor configuration:

```json
{
  "mcpServers": {
    "jira-zephyr": {
      "command": "node",
      "args": ["/path/to/jira-zephyr-mcp/dist/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://jira.your-company.com",
        "JIRA_USERNAME": "your-jira-login",
        "JIRA_PASSWORD": "your-jira-password"
      }
    }
  }
}
```

#### Using Docker

Alternatively, you can configure Cursor to run the MCP server in Docker (ensure the image is built first):

```json
{
  "mcpServers": {
    "jira-zephyr": {
      "command": "docker",
      "args": ["run", "--rm", "-i","-e","JIRA_BASE_URL","-e","JIRA_USERNAME","-e","JIRA_PASSWORD", "jira-zephyr-mcp"],
      "env": {
        "JIRA_BASE_URL": "https://jira.your-company.com",
        "JIRA_USERNAME": "your-jira-login",
        "JIRA_PASSWORD": "your-jira-password"
      }
    }
  }
}
```

## Installation (for development)

1. Clone the repository:
```bash
git clone https://github.com/your-username/jira-zephyr-mcp.git
cd jira-zephyr-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Configuration

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Configure your JIRA credentials in `.env`:
```bash
JIRA_BASE_URL=https://jira.your-company.com
JIRA_USERNAME=your-jira-login
JIRA_PASSWORD=your-jira-password
# Optional: name of the "Test" issue type (auto-detected if omitted), e.g. Тест
# JIRA_TEST_ISSUE_TYPE=Test
```

### Authentication

This fork targets **JIRA 8.12 Server + Zephyr for JIRA 5.6.3 (Zephyr Squad)** and
supports two authentication modes. ZAPI is served by the same JIRA instance under
`/rest/zapi/latest`, so it reuses the JIRA session — no separate Zephyr API token
is required.

- **Basic auth** — set `JIRA_USERNAME` + `JIRA_PASSWORD`. Works on any JIRA
  version, including releases older than 8.14 that predate Personal Access Tokens.
- **Bearer (PAT)** — set `JIRA_API_TOKEN` to a Personal Access Token. Requires
  JIRA 8.14+. When present it takes precedence over the username/password, so
  once your server is upgraded you can drop the token in and remove the
  login/password.

## Usage

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```


## Running with Docker

You can containerize and run the MCP server using Docker.

### Prerequisites
- Docker installed on your system
- The project cloned locally

### Building the Docker Image
1. Navigate to the project directory:

```bash
cd /path/to/jira-zephyr-mcp
```

2. Build the Docker image:

```bash
docker build -t jira-zephyr-mcp:latest .
```

You can specify a different tag if desired, e.g., `-t jira-zephyr-mcp:v1.0.0`.

### Running the Container
1. Run the container with required environment variables:

```bash
docker run -d --name jira-zephyr-mcp \
  -e JIRA_BASE_URL=https://jira.your-company.com \
  -e JIRA_USERNAME=your-jira-login \
  -e JIRA_PASSWORD=your-jira-password \
  jira-zephyr-mcp:latest
```

Note: For integration with systems like Cursor, use the Docker configuration shown in the 'Integration with Cursor' section above. Ensure the image is built with the desired tag that matches your Cursor config. The server communicates via stdio, so ensure your setup supports this when running in a container.

## Tool Usage Examples

### Reading JIRA Issues
```typescript
// Read basic issue information
await readJiraIssue({ issueKey: "ABC-123" });

// Read specific fields
await readJiraIssue({ 
  issueKey: "ABC-123", 
  fields: ["summary", "status", "assignee"] 
});
```

### Creating Test Plans
```typescript
await createTestPlan({
  name: "Release 2.0 Test Plan",
  description: "Comprehensive testing for release 2.0",
  projectKey: "ABC",
  startDate: "2024-01-15",
  endDate: "2024-01-30"
});
```

### Managing Test Cycles
```typescript
// Create a test cycle
await createTestCycle({
  name: "Sprint 10 Testing",
  description: "Testing for sprint 10 features",
  projectKey: "ABC",
  versionId: "10001",
  environment: "Production"
});

// List test cycles
await listTestCycles({
  projectKey: "ABC",
  limit: 25
});
```

### Test Execution
```typescript
// Update test execution status
await executeTest({
  executionId: "12345",
  status: "PASS",
  comment: "All tests passed successfully"
});

// Get execution status
await getTestExecutionStatus({ cycleId: "67890" });
```

### Generating Reports
```typescript
// Generate JSON report
await generateTestReport({
  cycleId: "67890",
  format: "JSON"
});

// Generate HTML report
await generateTestReport({
  cycleId: "67890",
  format: "HTML"
});
```

## Error Handling

The server implements comprehensive error handling:
- Input validation using Zod schemas
- API error mapping and user-friendly messages
- Network timeout handling
- Authentication error detection

## Development

### Scripts
- `npm run build` - Build the TypeScript project
- `npm run dev` - Run in development mode with file watching
- `npm start` - Run the built MCP server
- `npm run lint` - Run ESLint
- `npm run typecheck` - Run TypeScript type checking
- `npm run check-api` - Probe the target JIRA/ZAPI instance for read-only API compatibility

### Project Structure
```
src/
├── index.ts              # Main MCP server entry point
├── clients/              # API clients
│   ├── jira-client.ts    # JIRA REST v2 client (Server/DC)
│   └── zephyr-client.ts  # Zephyr Squad ZAPI client (read-only)
├── tools/                # MCP tool implementations
│   ├── jira-issues.ts    # JIRA issue tools
│   ├── test-plans.ts     # Test plans (not supported on Zephyr Squad)
│   ├── test-cycles.ts    # Test cycle management
│   ├── test-cases.ts     # Test case tools
│   └── test-execution.ts # Test execution tools
├── types/                # TypeScript type definitions
│   ├── jira-types.ts     # JIRA API types
│   └── zephyr-types.ts   # Zephyr ZAPI types
└── utils/                # Utility functions
    ├── config.ts         # Configuration & auth management
    ├── tool-status.ts    # Shared not-supported / read-only responses
    └── validation.ts     # Input validation schemas
scripts/
└── check-api.ts          # Read-only JIRA/ZAPI compatibility probe (npm run check-api)
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## Security

- Never commit API tokens or credentials to the repository
- Use environment variables for all sensitive configuration
- Regularly rotate API tokens
- Implement proper access controls in your JIRA instance

## License

This project is a fork of
[leorosignoli/jira-zephyr-mcp](https://github.com/leorosignoli/jira-zephyr-mcp)
and is distributed under **two** licenses:

- **Original upstream code** — MIT License, Copyright (c) 2025 Leonardo Andrade.
- **Modifications in this fork** — NPF (No Perdak Fire) License, Copyright (c) 2026 nikolaynnov.

See the [LICENSE](LICENSE) file for the full text of both. Any portions inherited
from the upstream project remain available under the MIT License regardless of
the NPF terms.

## Support

For issues and questions:
1. Check the existing GitHub issues
2. Create a new issue with detailed information
3. Include error logs and configuration (without sensitive data)

## Roadmap

- [ ] Support for Zephyr Squad (in addition to Zephyr Scale)
- [ ] Bulk test execution operations
- [ ] Advanced reporting with charts and metrics
- [ ] Test case creation and management
- [ ] Integration with CI/CD pipelines
- [ ] Custom field support for test management
