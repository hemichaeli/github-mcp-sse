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
    version: '2.0.0',
  });

  // ==================== USER ====================
  server.tool('get_authenticated_user', 'Get the authenticated user info', {}, async () => {
    try {
      const { data } = await octokit.users.getAuthenticated();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('get_user', 'Get a user by username', {
    username: z.string().describe('GitHub username')
  }, async ({ username }) => {
    try {
      const { data } = await octokit.users.getByUsername({ username });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  // ==================== REPOSITORIES ====================
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

  server.tool('rename_repository', 'Rename a repository and update settings', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Current repository name'),
    new_name: z.string().describe('New repository name'),
    description: z.string().optional().describe('New description'),
    private: z.boolean().optional().describe('Change visibility'),
    homepage: z.string().optional().describe('Homepage URL'),
    has_issues: z.boolean().optional().describe('Enable issues'),
    has_wiki: z.boolean().optional().describe('Enable wiki'),
    has_projects: z.boolean().optional().describe('Enable projects'),
    default_branch: z.string().optional().describe('Default branch name')
  }, async ({ owner, repo, new_name, description, private: isPrivate, homepage, has_issues, has_wiki, has_projects, default_branch }) => {
    try {
      const updateParams: any = { owner, repo, name: new_name };
      if (description !== undefined) updateParams.description = description;
      if (isPrivate !== undefined) updateParams.private = isPrivate;
      if (homepage !== undefined) updateParams.homepage = homepage;
      if (has_issues !== undefined) updateParams.has_issues = has_issues;
      if (has_wiki !== undefined) updateParams.has_wiki = has_wiki;
      if (has_projects !== undefined) updateParams.has_projects = has_projects;
      if (default_branch !== undefined) updateParams.default_branch = default_branch;

      const { data } = await octokit.repos.update(updateParams);
      return { content: [{ type: 'text', text: JSON.stringify({
        success: true, old_name: repo, new_name: data.name, full_name: data.full_name, url: data.html_url
      }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('delete_repository', 'Delete a repository (DANGEROUS!)', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    confirm: z.literal('DELETE').describe('Type DELETE to confirm')
  }, async ({ owner, repo, confirm }) => {
    if (confirm !== 'DELETE') {
      return { content: [{ type: 'text', text: 'Error: You must pass confirm="DELETE" to delete a repository' }], isError: true };
    }
    try {
      await octokit.repos.delete({ owner, repo });
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, deleted: `${owner}/${repo}` }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('fork_repository', 'Fork a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    name: z.string().optional().describe('New name for the fork'),
    default_branch_only: z.boolean().optional().describe('Fork only default branch')
  }, async ({ owner, repo, name, default_branch_only }) => {
    try {
      const { data } = await octokit.repos.createFork({ owner, repo, name, default_branch_only });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('list_forks', 'List forks of a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ owner, repo, per_page = 30 }) => {
    try {
      const { data } = await octokit.repos.listForks({ owner, repo, per_page });
      return { content: [{ type: 'text', text: JSON.stringify(data.map(f => ({ full_name: f.full_name, url: f.html_url })), null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  // ==================== BRANCHES ====================
  server.tool('list_branches', 'List branches in a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ owner, repo, per_page = 30 }) => {
    try {
      const { data } = await octokit.repos.listBranches({ owner, repo, per_page });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('get_branch', 'Get a specific branch', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    branch: z.string().describe('Branch name')
  }, async ({ owner, repo, branch }) => {
    try {
      const { data } = await octokit.repos.getBranch({ owner, repo, branch });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('create_branch', 'Create a new branch', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    branch: z.string().describe('New branch name'),
    from_branch: z.string().optional().describe('Source branch (default: default branch)')
  }, async ({ owner, repo, branch, from_branch }) => {
    try {
      // Get the SHA of the source branch
      const sourceBranch = from_branch || (await octokit.repos.get({ owner, repo })).data.default_branch;
      const { data: refData } = await octokit.git.getRef({ owner, repo, ref: `heads/${sourceBranch}` });
      
      const { data } = await octokit.git.createRef({
        owner, repo,
        ref: `refs/heads/${branch}`,
        sha: refData.object.sha
      });
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, branch, sha: data.object.sha }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('delete_branch', 'Delete a branch', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    branch: z.string().describe('Branch name')
  }, async ({ owner, repo, branch }) => {
    try {
      await octokit.git.deleteRef({ owner, repo, ref: `heads/${branch}` });
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, deleted: branch }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('merge_branches', 'Merge one branch into another', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    base: z.string().describe('Branch to merge into'),
    head: z.string().describe('Branch to merge from'),
    commit_message: z.string().optional().describe('Merge commit message')
  }, async ({ owner, repo, base, head, commit_message }) => {
    try {
      const { data } = await octokit.repos.merge({ owner, repo, base, head, commit_message });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  // ==================== FILES ====================
  server.tool('get_file_contents', 'Get contents of a file. Returns content and SHA.', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    path: z.string().describe('File path'),
    ref: z.string().optional().describe('Branch/tag/commit')
  }, async ({ owner, repo, path, ref }) => {
    try {
      const { data } = await octokit.repos.getContent({ owner, repo, path, ref });
      if ('content' in data && 'sha' in data) {
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        return { content: [{ type: 'text', text: JSON.stringify({ content, sha: data.sha, name: data.name, path: data.path, size: data.size }, null, 2) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('list_directory', 'List contents of a directory', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    path: z.string().optional().describe('Directory path (root if empty)'),
    ref: z.string().optional().describe('Branch/tag/commit')
  }, async ({ owner, repo, path = '', ref }) => {
    try {
      const { data } = await octokit.repos.getContent({ owner, repo, path, ref });
      if (Array.isArray(data)) {
        const items = data.map(item => ({ name: item.name, type: item.type, path: item.path, size: item.size }));
        return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
      }
      return { content: [{ type: 'text', text: 'Not a directory' }], isError: true };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('create_or_update_file', 'Create or update a file. SHA auto-fetched for updates.', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    path: z.string().describe('File path'),
    message: z.string().describe('Commit message'),
    content: z.string().describe('File content'),
    branch: z.string().optional().describe('Branch name'),
    sha: z.string().optional().describe('SHA (auto-fetched if not provided)')
  }, async ({ owner, repo, path, message, content, branch, sha }) => {
    try {
      let fileSha = sha;
      if (!fileSha) {
        try {
          const { data: existingFile } = await octokit.repos.getContent({ owner, repo, path, ref: branch });
          if ('sha' in existingFile) fileSha = existingFile.sha;
        } catch (e: any) {
          if (e.status !== 404) throw e;
        }
      }
      const { data } = await octokit.repos.createOrUpdateFileContents({
        owner, repo, path, message, content: Buffer.from(content).toString('base64'), branch, sha: fileSha
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('delete_file', 'Delete a file. SHA auto-fetched if not provided.', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    path: z.string().describe('File path'),
    message: z.string().describe('Commit message'),
    branch: z.string().optional().describe('Branch name'),
    sha: z.string().optional().describe('SHA (auto-fetched if not provided)')
  }, async ({ owner, repo, path, message, branch, sha }) => {
    try {
      let fileSha = sha;
      if (!fileSha) {
        const { data: existingFile } = await octokit.repos.getContent({ owner, repo, path, ref: branch });
        if ('sha' in existingFile) fileSha = existingFile.sha;
        else return { content: [{ type: 'text', text: 'Error: Could not get file SHA' }], isError: true };
      }
      const { data } = await octokit.repos.deleteFile({ owner, repo, path, message, sha: fileSha, branch });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  // ==================== COMMITS ====================
  server.tool('list_commits', 'List commits in a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    sha: z.string().optional().describe('Branch/tag/SHA'),
    path: z.string().optional().describe('Filter by file path'),
    author: z.string().optional().describe('Filter by author'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ owner, repo, sha, path, author, per_page = 30 }) => {
    try {
      const { data } = await octokit.repos.listCommits({ owner, repo, sha, path, author, per_page });
      const commits = data.map(c => ({ sha: c.sha.substring(0, 7), message: c.commit.message.split('\n')[0], author: c.commit.author?.name, date: c.commit.author?.date }));
      return { content: [{ type: 'text', text: JSON.stringify(commits, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('get_commit', 'Get a specific commit', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    ref: z.string().describe('Commit SHA')
  }, async ({ owner, repo, ref }) => {
    try {
      const { data } = await octokit.repos.getCommit({ owner, repo, ref });
      return { content: [{ type: 'text', text: JSON.stringify({
        sha: data.sha, message: data.commit.message, author: data.commit.author,
        files: data.files?.map(f => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions }))
      }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('compare_commits', 'Compare two commits', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    base: z.string().describe('Base commit/branch'),
    head: z.string().describe('Head commit/branch')
  }, async ({ owner, repo, base, head }) => {
    try {
      const { data } = await octokit.repos.compareCommits({ owner, repo, base, head });
      return { content: [{ type: 'text', text: JSON.stringify({
        status: data.status, ahead_by: data.ahead_by, behind_by: data.behind_by, total_commits: data.total_commits,
        files: data.files?.map(f => ({ filename: f.filename, status: f.status }))
      }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  // ==================== ISSUES ====================
  server.tool('list_issues', 'List issues in a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    state: z.enum(['open', 'closed', 'all']).optional().describe('Issue state'),
    labels: z.string().optional().describe('Comma-separated labels'),
    assignee: z.string().optional().describe('Filter by assignee'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ owner, repo, state = 'open', labels, assignee, per_page = 30 }) => {
    try {
      const { data } = await octokit.issues.listForRepo({ owner, repo, state, labels, assignee, per_page });
      return { content: [{ type: 'text', text: JSON.stringify(data.map(i => ({
        number: i.number, title: i.title, state: i.state, labels: i.labels.map((l: any) => l.name), assignees: i.assignees?.map(a => a.login)
      })), null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('get_issue', 'Get a specific issue', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    issue_number: z.number().describe('Issue number')
  }, async ({ owner, repo, issue_number }) => {
    try {
      const { data } = await octokit.issues.get({ owner, repo, issue_number });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('create_issue', 'Create an issue', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    title: z.string().describe('Issue title'),
    body: z.string().optional().describe('Issue body'),
    labels: z.array(z.string()).optional().describe('Labels'),
    assignees: z.array(z.string()).optional().describe('Assignees')
  }, async ({ owner, repo, title, body, labels, assignees }) => {
    try {
      const { data } = await octokit.issues.create({ owner, repo, title, body, labels, assignees });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('update_issue', 'Update an issue', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    issue_number: z.number().describe('Issue number'),
    title: z.string().optional().describe('New title'),
    body: z.string().optional().describe('New body'),
    state: z.enum(['open', 'closed']).optional().describe('State'),
    labels: z.array(z.string()).optional().describe('Labels'),
    assignees: z.array(z.string()).optional().describe('Assignees')
  }, async ({ owner, repo, issue_number, title, body, state, labels, assignees }) => {
    try {
      const { data } = await octokit.issues.update({ owner, repo, issue_number, title, body, state, labels, assignees });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('create_issue_comment', 'Add a comment to an issue', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    issue_number: z.number().describe('Issue number'),
    body: z.string().describe('Comment body')
  }, async ({ owner, repo, issue_number, body }) => {
    try {
      const { data } = await octokit.issues.createComment({ owner, repo, issue_number, body });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  // ==================== PULL REQUESTS ====================
  server.tool('list_pull_requests', 'List pull requests', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    state: z.enum(['open', 'closed', 'all']).optional().describe('PR state'),
    head: z.string().optional().describe('Filter by head branch'),
    base: z.string().optional().describe('Filter by base branch'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ owner, repo, state = 'open', head, base, per_page = 30 }) => {
    try {
      const { data } = await octokit.pulls.list({ owner, repo, state, head, base, per_page });
      return { content: [{ type: 'text', text: JSON.stringify(data.map(p => ({
        number: p.number, title: p.title, state: p.state, head: p.head.ref, base: p.base.ref, user: p.user?.login
      })), null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('get_pull_request', 'Get a specific pull request', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    pull_number: z.number().describe('PR number')
  }, async ({ owner, repo, pull_number }) => {
    try {
      const { data } = await octokit.pulls.get({ owner, repo, pull_number });
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
    body: z.string().optional().describe('PR description'),
    draft: z.boolean().optional().describe('Create as draft')
  }, async ({ owner, repo, title, head, base, body, draft }) => {
    try {
      const { data } = await octokit.pulls.create({ owner, repo, title, head, base, body, draft });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('merge_pull_request', 'Merge a pull request', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    pull_number: z.number().describe('PR number'),
    commit_title: z.string().optional().describe('Merge commit title'),
    commit_message: z.string().optional().describe('Merge commit message'),
    merge_method: z.enum(['merge', 'squash', 'rebase']).optional().describe('Merge method')
  }, async ({ owner, repo, pull_number, commit_title, commit_message, merge_method = 'merge' }) => {
    try {
      const { data } = await octokit.pulls.merge({ owner, repo, pull_number, commit_title, commit_message, merge_method });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('list_pr_files', 'List files changed in a PR', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    pull_number: z.number().describe('PR number')
  }, async ({ owner, repo, pull_number }) => {
    try {
      const { data } = await octokit.pulls.listFiles({ owner, repo, pull_number });
      return { content: [{ type: 'text', text: JSON.stringify(data.map(f => ({
        filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions
      })), null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  // ==================== RELEASES & TAGS ====================
  server.tool('list_releases', 'List releases', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ owner, repo, per_page = 30 }) => {
    try {
      const { data } = await octokit.repos.listReleases({ owner, repo, per_page });
      return { content: [{ type: 'text', text: JSON.stringify(data.map(r => ({
        id: r.id, tag_name: r.tag_name, name: r.name, draft: r.draft, prerelease: r.prerelease, published_at: r.published_at
      })), null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('create_release', 'Create a release', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    tag_name: z.string().describe('Tag name'),
    name: z.string().optional().describe('Release name'),
    body: z.string().optional().describe('Release notes'),
    draft: z.boolean().optional().describe('Create as draft'),
    prerelease: z.boolean().optional().describe('Mark as prerelease'),
    target_commitish: z.string().optional().describe('Target branch/commit')
  }, async ({ owner, repo, tag_name, name, body, draft, prerelease, target_commitish }) => {
    try {
      const { data } = await octokit.repos.createRelease({ owner, repo, tag_name, name, body, draft, prerelease, target_commitish });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('list_tags', 'List tags', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ owner, repo, per_page = 30 }) => {
    try {
      const { data } = await octokit.repos.listTags({ owner, repo, per_page });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  // ==================== LABELS ====================
  server.tool('list_labels', 'List labels in a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name')
  }, async ({ owner, repo }) => {
    try {
      const { data } = await octokit.issues.listLabelsForRepo({ owner, repo });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('create_label', 'Create a label', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    name: z.string().describe('Label name'),
    color: z.string().describe('Color (hex without #)'),
    description: z.string().optional().describe('Description')
  }, async ({ owner, repo, name, color, description }) => {
    try {
      const { data } = await octokit.issues.createLabel({ owner, repo, name, color, description });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  // ==================== WORKFLOWS & ACTIONS ====================
  server.tool('list_workflows', 'List workflows', {
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
    branch: z.string().optional().describe('Branch'),
    status: z.enum(['completed', 'in_progress', 'queued', 'waiting', 'pending']).optional().describe('Status'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ owner, repo, workflow_id, branch, status, per_page = 30 }) => {
    try {
      const params: any = { owner, repo, per_page };
      if (workflow_id) params.workflow_id = workflow_id;
      if (branch) params.branch = branch;
      if (status) params.status = status;
      const { data } = await octokit.actions.listWorkflowRunsForRepo(params);
      return { content: [{ type: 'text', text: JSON.stringify(data.workflow_runs.map(r => ({
        id: r.id, name: r.name, status: r.status, conclusion: r.conclusion, branch: r.head_branch, created_at: r.created_at
      })), null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('trigger_workflow', 'Trigger a workflow dispatch event', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    workflow_id: z.string().describe('Workflow ID or filename'),
    ref: z.string().describe('Branch/tag to run on'),
    inputs: z.record(z.string()).optional().describe('Workflow inputs')
  }, async ({ owner, repo, workflow_id, ref, inputs }) => {
    try {
      await octokit.actions.createWorkflowDispatch({ owner, repo, workflow_id, ref, inputs });
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, workflow_id, ref }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('cancel_workflow_run', 'Cancel a workflow run', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    run_id: z.number().describe('Run ID')
  }, async ({ owner, repo, run_id }) => {
    try {
      await octokit.actions.cancelWorkflowRun({ owner, repo, run_id });
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, cancelled: run_id }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('rerun_workflow', 'Re-run a workflow', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    run_id: z.number().describe('Run ID')
  }, async ({ owner, repo, run_id }) => {
    try {
      await octokit.actions.reRunWorkflow({ owner, repo, run_id });
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, rerun: run_id }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  // ==================== COLLABORATORS ====================
  server.tool('list_collaborators', 'List repository collaborators', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name')
  }, async ({ owner, repo }) => {
    try {
      const { data } = await octokit.repos.listCollaborators({ owner, repo });
      return { content: [{ type: 'text', text: JSON.stringify(data.map(c => ({ login: c.login, permissions: c.permissions })), null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('add_collaborator', 'Add a collaborator', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    username: z.string().describe('Username to add'),
    permission: z.enum(['pull', 'push', 'admin', 'maintain', 'triage']).optional().describe('Permission level')
  }, async ({ owner, repo, username, permission = 'push' }) => {
    try {
      const { data } = await octokit.repos.addCollaborator({ owner, repo, username, permission });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('remove_collaborator', 'Remove a collaborator', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    username: z.string().describe('Username to remove')
  }, async ({ owner, repo, username }) => {
    try {
      await octokit.repos.removeCollaborator({ owner, repo, username });
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, removed: username }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  // ==================== SEARCH ====================
  server.tool('search_repositories', 'Search repositories', {
    q: z.string().describe('Search query'),
    sort: z.enum(['stars', 'forks', 'updated', 'help-wanted-issues']).optional().describe('Sort field'),
    order: z.enum(['asc', 'desc']).optional().describe('Sort order'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ q, sort, order, per_page = 10 }) => {
    try {
      const { data } = await octokit.search.repos({ q, sort, order, per_page });
      return { content: [{ type: 'text', text: JSON.stringify(data.items.map(r => ({
        name: r.full_name, description: r.description, stars: r.stargazers_count, url: r.html_url
      })), null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('search_code', 'Search code', {
    q: z.string().describe('Search query'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ q, per_page = 10 }) => {
    try {
      const { data } = await octokit.search.code({ q, per_page });
      return { content: [{ type: 'text', text: JSON.stringify(data.items.map(i => ({
        name: i.name, path: i.path, repository: i.repository.full_name, url: i.html_url
      })), null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('search_issues', 'Search issues and PRs', {
    q: z.string().describe('Search query'),
    sort: z.enum(['created', 'updated', 'comments']).optional().describe('Sort field'),
    order: z.enum(['asc', 'desc']).optional().describe('Sort order'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ q, sort, order, per_page = 10 }) => {
    try {
      const { data } = await octokit.search.issuesAndPullRequests({ q, sort, order, per_page });
      return { content: [{ type: 'text', text: JSON.stringify(data.items.map(i => ({
        number: i.number, title: i.title, state: i.state, repository: i.repository_url.split('/').slice(-2).join('/'), url: i.html_url
      })), null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('search_users', 'Search users', {
    q: z.string().describe('Search query'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ q, per_page = 10 }) => {
    try {
      const { data } = await octokit.search.users({ q, per_page });
      return { content: [{ type: 'text', text: JSON.stringify(data.items.map(u => ({
        login: u.login, type: u.type, url: u.html_url
      })), null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  // ==================== GISTS ====================
  server.tool('list_gists', 'List gists for authenticated user', {
    per_page: z.number().optional().describe('Results per page')
  }, async ({ per_page = 30 }) => {
    try {
      const { data } = await octokit.gists.list({ per_page });
      return { content: [{ type: 'text', text: JSON.stringify(data.map(g => ({
        id: g.id, description: g.description, public: g.public, files: Object.keys(g.files || {}), url: g.html_url
      })), null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('create_gist', 'Create a gist', {
    description: z.string().optional().describe('Gist description'),
    public: z.boolean().optional().describe('Public gist'),
    files: z.record(z.object({ content: z.string() })).describe('Files object')
  }, async ({ description, public: isPublic = false, files }) => {
    try {
      const { data } = await octokit.gists.create({ description, public: isPublic, files });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  // ==================== STARRING ====================
  server.tool('list_stargazers', 'List stargazers of a repo', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ owner, repo, per_page = 30 }) => {
    try {
      const { data } = await octokit.activity.listStargazersForRepo({ owner, repo, per_page });
      return { content: [{ type: 'text', text: JSON.stringify(data.map((s: any) => s.login || s), null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('star_repository', 'Star a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name')
  }, async ({ owner, repo }) => {
    try {
      await octokit.activity.starRepoForAuthenticatedUser({ owner, repo });
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, starred: `${owner}/${repo}` }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error}` }], isError: true };
    }
  });

  server.tool('unstar_repository', 'Unstar a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name')
  }, async ({ owner, repo }) => {
    try {
      await octokit.activity.unstarRepoForAuthenticatedUser({ owner, repo });
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, unstarred: `${owner}/${repo}` }, null, 2) }] };
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
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    tool_count: 55
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
    try { res.write(': keepalive\n\n'); } catch (e) { clearInterval(keepAlive); }
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
    if (!res.headersSent) res.status(500).json({ error: String(error) });
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
  console.log(`GitHub MCP SSE Server v2.0.0 running on port ${PORT}`);
  console.log(`55 tools available`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
});
