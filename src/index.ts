import express, { Request, Response } from 'express';
import cors from 'cors';
import { Octokit } from '@octokit/rest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN environment variable is required');
  process.exit(1);
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// Tool definitions
const tools = [
  {
    name: 'list_repositories',
    description: 'List repositories for the authenticated user',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          enum: ['all', 'owner', 'public', 'private', 'member'],
          description: 'Type of repositories to list',
        },
        sort: {
          type: 'string',
          enum: ['created', 'updated', 'pushed', 'full_name'],
          description: 'Sort field',
        },
        per_page: {
          type: 'number',
          description: 'Results per page (max 100)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_repository',
    description: 'Get details of a specific repository',
    inputSchema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'create_repository',
    description: 'Create a new repository',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Repository name' },
        description: { type: 'string', description: 'Repository description' },
        private: { type: 'boolean', description: 'Whether the repo is private' },
        auto_init: { type: 'boolean', description: 'Initialize with README' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_branches',
    description: 'List branches in a repository',
    inputSchema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'get_file_contents',
    description: 'Get contents of a file from a repository',
    inputSchema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        path: { type: 'string', description: 'Path to file' },
        ref: { type: 'string', description: 'Branch or commit SHA' },
      },
      required: ['owner', 'repo', 'path'],
    },
  },
  {
    name: 'create_or_update_file',
    description: 'Create or update a file in a repository',
    inputSchema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        path: { type: 'string', description: 'Path to file' },
        message: { type: 'string', description: 'Commit message' },
        content: { type: 'string', description: 'File content (will be base64 encoded)' },
        branch: { type: 'string', description: 'Branch name' },
        sha: { type: 'string', description: 'SHA of file being replaced (for updates)' },
      },
      required: ['owner', 'repo', 'path', 'message', 'content'],
    },
  },
  {
    name: 'list_issues',
    description: 'List issues in a repository',
    inputSchema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Issue state' },
        per_page: { type: 'number', description: 'Results per page' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'create_issue',
    description: 'Create an issue in a repository',
    inputSchema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        title: { type: 'string', description: 'Issue title' },
        body: { type: 'string', description: 'Issue body' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Labels' },
      },
      required: ['owner', 'repo', 'title'],
    },
  },
  {
    name: 'list_pull_requests',
    description: 'List pull requests in a repository',
    inputSchema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'PR state' },
        per_page: { type: 'number', description: 'Results per page' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'create_pull_request',
    description: 'Create a pull request',
    inputSchema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        title: { type: 'string', description: 'PR title' },
        head: { type: 'string', description: 'Head branch' },
        base: { type: 'string', description: 'Base branch' },
        body: { type: 'string', description: 'PR description' },
      },
      required: ['owner', 'repo', 'title', 'head', 'base'],
    },
  },
  {
    name: 'list_commits',
    description: 'List commits in a repository',
    inputSchema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        sha: { type: 'string', description: 'Branch or commit SHA' },
        per_page: { type: 'number', description: 'Results per page' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'list_workflows',
    description: 'List GitHub Actions workflows',
    inputSchema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'list_workflow_runs',
    description: 'List workflow runs for a repository',
    inputSchema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        workflow_id: { type: 'string', description: 'Workflow ID or filename' },
        per_page: { type: 'number', description: 'Results per page' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'get_authenticated_user',
    description: 'Get information about the authenticated user',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'search_repositories',
    description: 'Search for repositories',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        sort: { type: 'string', enum: ['stars', 'forks', 'updated'], description: 'Sort field' },
        per_page: { type: 'number', description: 'Results per page' },
      },
      required: ['query'],
    },
  },
];

// Tool implementations
async function listRepositories(args: Record<string, unknown>) {
  const response = await octokit.repos.listForAuthenticatedUser({
    type: (args.type as 'all' | 'owner' | 'public' | 'private' | 'member') || 'all',
    sort: (args.sort as 'created' | 'updated' | 'pushed' | 'full_name') || 'updated',
    per_page: (args.per_page as number) || 30,
  });
  return response.data.map(repo => ({
    name: repo.name,
    full_name: repo.full_name,
    description: repo.description,
    private: repo.private,
    html_url: repo.html_url,
    default_branch: repo.default_branch,
    updated_at: repo.updated_at,
  }));
}

async function getRepository(owner: string, repo: string) {
  const response = await octokit.repos.get({ owner, repo });
  return response.data;
}

async function createRepository(args: Record<string, unknown>) {
  const response = await octokit.repos.createForAuthenticatedUser({
    name: args.name as string,
    description: args.description as string,
    private: args.private as boolean,
    auto_init: args.auto_init as boolean,
  });
  return response.data;
}

async function listBranches(owner: string, repo: string) {
  const response = await octokit.repos.listBranches({ owner, repo });
  return response.data;
}

async function getFileContents(owner: string, repo: string, path: string, ref?: string) {
  const response = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ref,
  });
  
  const data = response.data;
  if ('content' in data && data.content) {
    return {
      name: data.name,
      path: data.path,
      sha: data.sha,
      size: data.size,
      content: Buffer.from(data.content, 'base64').toString('utf-8'),
    };
  }
  return data;
}

async function createOrUpdateFile(args: Record<string, unknown>) {
  const response = await octokit.repos.createOrUpdateFileContents({
    owner: args.owner as string,
    repo: args.repo as string,
    path: args.path as string,
    message: args.message as string,
    content: Buffer.from(args.content as string).toString('base64'),
    branch: args.branch as string,
    sha: args.sha as string,
  });
  return response.data;
}

async function listIssues(owner: string, repo: string, state?: string, per_page?: number) {
  const response = await octokit.issues.listForRepo({
    owner,
    repo,
    state: (state as 'open' | 'closed' | 'all') || 'open',
    per_page: per_page || 30,
  });
  return response.data;
}

async function createIssue(args: Record<string, unknown>) {
  const response = await octokit.issues.create({
    owner: args.owner as string,
    repo: args.repo as string,
    title: args.title as string,
    body: args.body as string,
    labels: args.labels as string[],
  });
  return response.data;
}

async function listPullRequests(owner: string, repo: string, state?: string, per_page?: number) {
  const response = await octokit.pulls.list({
    owner,
    repo,
    state: (state as 'open' | 'closed' | 'all') || 'open',
    per_page: per_page || 30,
  });
  return response.data;
}

async function createPullRequest(args: Record<string, unknown>) {
  const response = await octokit.pulls.create({
    owner: args.owner as string,
    repo: args.repo as string,
    title: args.title as string,
    head: args.head as string,
    base: args.base as string,
    body: args.body as string,
  });
  return response.data;
}

async function listCommits(owner: string, repo: string, sha?: string, per_page?: number) {
  const response = await octokit.repos.listCommits({
    owner,
    repo,
    sha,
    per_page: per_page || 30,
  });
  return response.data.map(commit => ({
    sha: commit.sha,
    message: commit.commit.message,
    author: commit.commit.author,
    date: commit.commit.author?.date,
  }));
}

async function listWorkflows(owner: string, repo: string) {
  const response = await octokit.actions.listRepoWorkflows({ owner, repo });
  return response.data.workflows;
}

async function listWorkflowRuns(owner: string, repo: string, workflow_id?: string, per_page?: number) {
  if (workflow_id) {
    const response = await octokit.actions.listWorkflowRuns({
      owner,
      repo,
      workflow_id,
      per_page: per_page || 10,
    });
    return response.data.workflow_runs;
  } else {
    const response = await octokit.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      per_page: per_page || 10,
    });
    return response.data.workflow_runs;
  }
}

async function getAuthenticatedUser() {
  const response = await octokit.users.getAuthenticated();
  return response.data;
}

async function searchRepositories(query: string, sort?: string, per_page?: number) {
  const response = await octokit.search.repos({
    q: query,
    sort: sort as 'stars' | 'forks' | 'updated',
    per_page: per_page || 30,
  });
  return response.data.items;
}

// Create MCP server
function createMCPServer() {
  const server = new Server(
    {
      name: 'github-mcp-sse',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: unknown;

      switch (name) {
        case 'list_repositories':
          result = await listRepositories(args || {});
          break;
        case 'get_repository':
          result = await getRepository(args?.owner as string, args?.repo as string);
          break;
        case 'create_repository':
          result = await createRepository(args || {});
          break;
        case 'list_branches':
          result = await listBranches(args?.owner as string, args?.repo as string);
          break;
        case 'get_file_contents':
          result = await getFileContents(
            args?.owner as string,
            args?.repo as string,
            args?.path as string,
            args?.ref as string
          );
          break;
        case 'create_or_update_file':
          result = await createOrUpdateFile(args || {});
          break;
        case 'list_issues':
          result = await listIssues(
            args?.owner as string,
            args?.repo as string,
            args?.state as string,
            args?.per_page as number
          );
          break;
        case 'create_issue':
          result = await createIssue(args || {});
          break;
        case 'list_pull_requests':
          result = await listPullRequests(
            args?.owner as string,
            args?.repo as string,
            args?.state as string,
            args?.per_page as number
          );
          break;
        case 'create_pull_request':
          result = await createPullRequest(args || {});
          break;
        case 'list_commits':
          result = await listCommits(
            args?.owner as string,
            args?.repo as string,
            args?.sha as string,
            args?.per_page as number
          );
          break;
        case 'list_workflows':
          result = await listWorkflows(args?.owner as string, args?.repo as string);
          break;
        case 'list_workflow_runs':
          result = await listWorkflowRuns(
            args?.owner as string,
            args?.repo as string,
            args?.workflow_id as string,
            args?.per_page as number
          );
          break;
        case 'get_authenticated_user':
          result = await getAuthenticatedUser();
          break;
        case 'search_repositories':
          result = await searchRepositories(
            args?.query as string,
            args?.sort as string,
            args?.per_page as number
          );
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${errorMessage}` }],
        isError: true,
      };
    }
  });

  return server;
}

// Express app
const app = express();
app.use(cors());
app.use(express.json());

const transports = new Map<string, SSEServerTransport>();

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'GitHub MCP SSE Server',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.get('/sse', async (req: Request, res: Response) => {
  console.log('New SSE connection');
  const transport = new SSEServerTransport('/message', res);
  const server = createMCPServer();
  const sessionId = Math.random().toString(36).substring(7);
  transports.set(sessionId, transport);

  res.on('close', () => {
    console.log('SSE connection closed');
    transports.delete(sessionId);
  });

  await server.connect(transport);
});

app.post('/message', async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);

  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).json({ error: 'No active session' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`GitHub MCP SSE Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
});
