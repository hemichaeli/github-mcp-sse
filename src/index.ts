import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { Octokit } from '@octokit/rest';
import { z } from 'zod';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN environment variable is required');
  process.exit(1);
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

function createServer() {
  const server = new McpServer({
    name: 'github-mcp-server',
    version: '1.0.0',
  });

  server.tool('get_authenticated_user', 'Get the authenticated user info', {}, async () => {
    try {
      const { data } = await octokit.users.getAuthenticated();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('list_repositories', 'List repositories for the authenticated user', {
    type: z.enum(['all', 'owner', 'public', 'private', 'member']).optional().describe('Type of repositories'),
    sort: z.enum(['created', 'updated', 'pushed', 'full_name']).optional().describe('Sort field'),
    per_page: z.number().optional().describe('Results per page (max 100)')
  }, async ({ type = 'all', sort = 'updated', per_page = 30 }) => {
    try {
      const { data } = await octokit.repos.listForAuthenticatedUser({ type, sort, per_page });
      const repos = data.map(r => ({ name: r.name, full_name: r.full_name, private: r.private, url: r.html_url }));
      return { content: [{ type: 'text', text: JSON.stringify(repos, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('get_repository', 'Get details of a specific repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name')
  }, async ({ owner, repo }) => {
    try {
      const { data } = await octokit.repos.get({ owner, repo });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('create_repository', 'Create a new repository', {
    name: z.string().describe('Repository name'),
    description: z.string().optional().describe('Repository description'),
    private: z.boolean().optional().describe('Whether the repo is private'),
    auto_init: z.boolean().optional().describe('Initialize with README')
  }, async ({ name, description, private: isPrivate = false, auto_init = true }) => {
    try {
      const { data } = await octokit.repos.createForAuthenticatedUser({ 
        name, description, private: isPrivate, auto_init 
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('list_branches', 'List branches in a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name')
  }, async ({ owner, repo }) => {
    try {
      const { data } = await octokit.repos.listBranches({ owner, repo });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('get_file_contents', 'Get contents of a file in a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    path: z.string().describe('File path'),
    ref: z.string().optional().describe('Branch/tag/commit (default: main)')
  }, async ({ owner, repo, path, ref }) => {
    try {
      const { data } = await octokit.repos.getContent({ owner, repo, path, ref });
      if ('content' in data) {
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        return { content: [{ type: 'text', text: content }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('create_or_update_file', 'Create or update a file in a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    path: z.string().describe('File path'),
    message: z.string().describe('Commit message'),
    content: z.string().describe('File content'),
    branch: z.string().optional().describe('Branch name'),
    sha: z.string().optional().describe('SHA of file being replaced (for updates)')
  }, async ({ owner, repo, path, message, content, branch, sha }) => {
    try {
      const { data } = await octokit.repos.createOrUpdateFileContents({
        owner, repo, path, message,
        content: Buffer.from(content).toString('base64'),
        branch, sha
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('list_issues', 'List issues in a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    state: z.enum(['open', 'closed', 'all']).optional().describe('Issue state')
  }, async ({ owner, repo, state = 'open' }) => {
    try {
      const { data } = await octokit.issues.listForRepo({ owner, repo, state });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('create_issue', 'Create an issue in a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    title: z.string().describe('Issue title'),
    body: z.string().optional().describe('Issue body')
  }, async ({ owner, repo, title, body }) => {
    try {
      const { data } = await octokit.issues.create({ owner, repo, title, body });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('list_pull_requests', 'List pull requests in a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    state: z.enum(['open', 'closed', 'all']).optional().describe('PR state')
  }, async ({ owner, repo, state = 'open' }) => {
    try {
      const { data } = await octokit.pulls.list({ owner, repo, state });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('create_pull_request', 'Create a pull request', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    title: z.string().describe('PR title'),
    head: z.string().describe('Branch with changes'),
    base: z.string().describe('Branch to merge into'),
    body: z.string().optional().describe('PR description')
  }, async ({ owner, repo, title, head, base, body }) => {
    try {
      const { data } = await octokit.pulls.create({ owner, repo, title, head, base, body });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('list_commits', 'List commits in a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    sha: z.string().optional().describe('Branch/tag/SHA'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ owner, repo, sha, per_page = 30 }) => {
    try {
      const { data } = await octokit.repos.listCommits({ owner, repo, sha, per_page });
      const commits = data.map(c => ({ 
        sha: c.sha.substring(0, 7), 
        message: c.commit.message.split('\n')[0],
        author: c.commit.author?.name,
        date: c.commit.author?.date
      }));
      return { content: [{ type: 'text', text: JSON.stringify(commits, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('search_repositories', 'Search for repositories', {
    q: z.string().describe('Search query'),
    sort: z.enum(['stars', 'forks', 'updated']).optional().describe('Sort field'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ q, sort, per_page = 10 }) => {
    try {
      const { data } = await octokit.search.repos({ q, sort, per_page });
      const repos = data.items.map(r => ({ 
        name: r.full_name, 
        stars: r.stargazers_count,
        url: r.html_url 
      }));
      return { content: [{ type: 'text', text: JSON.stringify(repos, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('list_workflows', 'List workflows in a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name')
  }, async ({ owner, repo }) => {
    try {
      const { data } = await octokit.actions.listRepoWorkflows({ owner, repo });
      return { content: [{ type: 'text', text: JSON.stringify(data.workflows, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('list_workflow_runs', 'List workflow runs', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    workflow_id: z.number().optional().describe('Workflow ID'),
    status: z.enum(['completed', 'in_progress', 'queued']).optional().describe('Run status')
  }, async ({ owner, repo, workflow_id, status }) => {
    try {
      const params: any = { owner, repo };
      if (workflow_id) params.workflow_id = workflow_id;
      if (status) params.status = status;
      const { data } = await octokit.actions.listWorkflowRunsForRepo(params);
      const runs = data.workflow_runs.map(r => ({
        id: r.id,
        name: r.name,
        status: r.status,
        conclusion: r.conclusion,
        created_at: r.created_at
      }));
      return { content: [{ type: 'text', text: JSON.stringify(runs, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  return server;
}

const app = express();

const transports: Record<string, SSEServerTransport> = {};

app.get('/health', (_req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ 
    status: 'healthy', 
    service: 'GitHub MCP SSE Server', 
    version: '1.0.0',
    timestamp: new Date().toISOString() 
  });
});

app.get('/sse', async (req: Request, res: Response) => {
  console.log('New SSE connection request');

  const transport = new SSEServerTransport('/message', res);
  
  transports[transport.sessionId] = transport;
  const sessionId = transport.sessionId;
  
  console.log(`SSE session created: ${sessionId}`);

  const server = createServer();

  const keepAlive = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch (e) {
      clearInterval(keepAlive);
    }
  }, 10000);

  res.on('close', () => {
    console.log(`SSE connection closed: ${sessionId}`);
    clearInterval(keepAlive);
    delete transports[sessionId];
  });

  await server.connect(transport);
  console.log(`MCP server connected for session: ${sessionId}`);
});

app.post('/message', async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  console.log(`Message received for session: ${sessionId}`);
  
  const transport = transports[sessionId];
  if (!transport) {
    console.log(`Session not found. Available: ${Object.keys(transports).join(', ')}`);
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  try {
    await transport.handlePostMessage(req, res);
    console.log(`Message handled successfully for session: ${sessionId}`);
  } catch (error) {
    console.error(`Error handling message: ${error}`);
    if (!res.headersSent) {
      res.status(500).json({ error: String(error) });
    }
  }
});

app.options('*', (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`GitHub MCP SSE Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
});
