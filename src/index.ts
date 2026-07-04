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

const TOOL_COUNT = 86;

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
function err(error: unknown) {
  return { content: [{ type: 'text' as const, text: `Error: ${error}` }], isError: true };
}

function createServer() {
  const server = new McpServer({
    name: 'github-mcp-server',
    version: '3.0.0',
  });

  // ==================== USER ====================
  server.tool('get_authenticated_user', 'Get the authenticated user info', {}, async () => {
    try {
      const { data } = await octokit.users.getAuthenticated();
      return ok(data);
    } catch (error) { return err(error); }
  });

  server.tool('get_user', 'Get a user by username', {
    username: z.string().describe('GitHub username')
  }, async ({ username }) => {
    try {
      const { data } = await octokit.users.getByUsername({ username });
      return ok(data);
    } catch (error) { return err(error); }
  });

  server.tool('get_rate_limit', 'Get current API rate limit status', {}, async () => {
    try {
      const { data } = await octokit.rateLimit.get();
      return ok(data.resources);
    } catch (error) { return err(error); }
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
      return ok(repos);
    } catch (error) { return err(error); }
  });

  server.tool('get_repository', 'Get details of a specific repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name')
  }, async ({ owner, repo }) => {
    try {
      const { data } = await octokit.repos.get({ owner, repo });
      return ok(data);
    } catch (error) { return err(error); }
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
      return ok(data);
    } catch (error) { return err(error); }
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
      return ok({ success: true, old_name: repo, new_name: data.name, full_name: data.full_name, url: data.html_url });
    } catch (error) { return err(error); }
  });

  server.tool('archive_repository', 'Archive or unarchive a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    archived: z.boolean().describe('true to archive, false to unarchive')
  }, async ({ owner, repo, archived }) => {
    try {
      const { data } = await octokit.repos.update({ owner, repo, archived });
      return ok({ success: true, repo: data.full_name, archived: data.archived });
    } catch (error) { return err(error); }
  });

  server.tool('delete_repository', 'Delete a repository (DANGEROUS!)', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    confirm: z.literal('DELETE').describe('Type DELETE to confirm')
  }, async ({ owner, repo, confirm }) => {
    if (confirm !== 'DELETE') {
      return { content: [{ type: 'text' as const, text: 'Error: You must pass confirm="DELETE" to delete a repository' }], isError: true };
    }
    try {
      await octokit.repos.delete({ owner, repo });
      return ok({ success: true, deleted: `${owner}/${repo}` });
    } catch (error) { return err(error); }
  });

  server.tool('fork_repository', 'Fork a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    name: z.string().optional().describe('New name for the fork'),
    default_branch_only: z.boolean().optional().describe('Fork only default branch')
  }, async ({ owner, repo, name, default_branch_only }) => {
    try {
      const { data } = await octokit.repos.createFork({ owner, repo, name, default_branch_only });
      return ok(data);
    } catch (error) { return err(error); }
  });

  server.tool('list_forks', 'List forks of a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ owner, repo, per_page = 30 }) => {
    try {
      const { data } = await octokit.repos.listForks({ owner, repo, per_page });
      return ok(data.map(f => ({ full_name: f.full_name, url: f.html_url })));
    } catch (error) { return err(error); }
  });

  server.tool('get_readme', 'Get the decoded README of a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    ref: z.string().optional().describe('Branch/tag/commit')
  }, async ({ owner, repo, ref }) => {
    try {
      const { data } = await octokit.repos.getReadme({ owner, repo, ref });
      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      return ok({ name: data.name, path: data.path, content });
    } catch (error) { return err(error); }
  });

  server.tool('get_repo_topics', 'Get topics of a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name')
  }, async ({ owner, repo }) => {
    try {
      const { data } = await octokit.repos.getAllTopics({ owner, repo });
      return ok(data);
    } catch (error) { return err(error); }
  });

  server.tool('set_repo_topics', 'Replace all topics of a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    names: z.array(z.string()).describe('Full list of topics (replaces existing)')
  }, async ({ owner, repo, names }) => {
    try {
      const { data } = await octokit.repos.replaceAllTopics({ owner, repo, names });
      return ok(data);
    } catch (error) { return err(error); }
  });

  server.tool('list_repo_languages', 'List languages used in a repository with byte counts', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name')
  }, async ({ owner, repo }) => {
    try {
      const { data } = await octokit.repos.listLanguages({ owner, repo });
      return ok(data);
    } catch (error) { return err(error); }
  });

  server.tool('list_contributors', 'List contributors of a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ owner, repo, per_page = 30 }) => {
    try {
      const { data } = await octokit.repos.listContributors({ owner, repo, per_page });
      return ok(data.map(c => ({ login: c.login, contributions: c.contributions })));
    } catch (error) { return err(error); }
  });

  // ==================== BRANCHES ====================
  server.tool('list_branches', 'List branches in a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ owner, repo, per_page = 30 }) => {
    try {
      const { data } = await octokit.repos.listBranches({ owner, repo, per_page });
      return ok(data);
    } catch (error) { return err(error); }
  });

  server.tool('get_branch', 'Get a specific branch', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    branch: z.string().describe('Branch name')
  }, async ({ owner, repo, branch }) => {
    try {
      const { data } = await octokit.repos.getBranch({ owner, repo, branch });
      return ok(data);
    } catch (error) { return err(error); }
  });

  server.tool('create_branch', 'Create a new branch', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    branch: z.string().describe('New branch name'),
    from_branch: z.string().optional().describe('Source branch (default: default branch)')
  }, async ({ owner, repo, branch, from_branch }) => {
    try {
      const sourceBranch = from_branch || (await octokit.repos.get({ owner, repo })).data.default_branch;
      const { data: refData } = await octokit.git.getRef({ owner, repo, ref: `heads/${sourceBranch}` });

      const { data } = await octokit.git.createRef({
        owner, repo,
        ref: `refs/heads/${branch}`,
        sha: refData.object.sha
      });
      return ok({ success: true, branch, sha: data.object.sha });
    } catch (error) { return err(error); }
  });

  server.tool('delete_branch', 'Delete a branch', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    branch: z.string().describe('Branch name')
  }, async ({ owner, repo, branch }) => {
    try {
      await octokit.git.deleteRef({ owner, repo, ref: `heads/${branch}` });
      return ok({ success: true, deleted: branch });
    } catch (error) { return err(error); }
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
      return ok(data);
    } catch (error) { return err(error); }
  });

  server.tool('get_branch_protection', 'Get branch protection settings', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    branch: z.string().describe('Branch name')
  }, async ({ owner, repo, branch }) => {
    try {
      const { data } = await octokit.repos.getBranchProtection({ owner, repo, branch });
      return ok(data);
    } catch (error) { return err(error); }
  });

  server.tool('delete_branch_protection', 'Remove branch protection', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    branch: z.string().describe('Branch name')
  }, async ({ owner, repo, branch }) => {
    try {
      await octokit.repos.deleteBranchProtection({ owner, repo, branch });
      return ok({ success: true, unprotected: branch });
    } catch (error) { return err(error); }
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
        return ok({ content, sha: data.sha, name: data.name, path: data.path, size: data.size });
      }
      return ok(data);
    } catch (error) { return err(error); }
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
        return ok(items);
      }
      return { content: [{ type: 'text' as const, text: 'Not a directory' }], isError: true };
    } catch (error) { return err(error); }
  });

  server.tool('get_tree', 'Get the full file tree of a branch (optionally recursive)', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    branch: z.string().optional().describe('Branch name (default: default branch)'),
    recursive: z.boolean().optional().describe('Recurse into subdirectories (default true)')
  }, async ({ owner, repo, branch, recursive = true }) => {
    try {
      const branchName = branch || (await octokit.repos.get({ owner, repo })).data.default_branch;
      const { data: branchData } = await octokit.repos.getBranch({ owner, repo, branch: branchName });
      const treeSha = branchData.commit.commit.tree.sha;
      const { data } = await octokit.git.getTree({ owner, repo, tree_sha: treeSha, recursive: recursive ? '1' : undefined });
      return ok({ truncated: data.truncated, tree: data.tree.map(t => ({ path: t.path, type: t.type, size: t.size })) });
    } catch (error) { return err(error); }
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
      return ok(data);
    } catch (error) { return err(error); }
  });

  server.tool('push_files', 'Push multiple files in a single atomic commit (Git Data API). files is a map of path to full file content.', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    message: z.string().describe('Commit message'),
    files: z.record(z.string()).describe('Map of file path to full UTF-8 content'),
    branch: z.string().optional().describe('Branch name (default: default branch)')
  }, async ({ owner, repo, message, files, branch }) => {
    try {
      const branchName = branch || (await octokit.repos.get({ owner, repo })).data.default_branch;
      const { data: refData } = await octokit.git.getRef({ owner, repo, ref: `heads/${branchName}` });
      const baseSha = refData.object.sha;
      const { data: baseCommit } = await octokit.git.getCommit({ owner, repo, commit_sha: baseSha });
      const treeItems = [] as Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }>;
      for (const [rawPath, content] of Object.entries(files)) {
        const { data: blob } = await octokit.git.createBlob({ owner, repo, content: Buffer.from(content, 'utf-8').toString('base64'), encoding: 'base64' });
        treeItems.push({ path: rawPath.replace(/^\//, ''), mode: '100644', type: 'blob', sha: blob.sha });
      }
      const { data: newTree } = await octokit.git.createTree({ owner, repo, base_tree: baseCommit.tree.sha, tree: treeItems });
      const { data: newCommit } = await octokit.git.createCommit({ owner, repo, message, tree: newTree.sha, parents: [baseSha] });
      await octokit.git.updateRef({ owner, repo, ref: `heads/${branchName}`, sha: newCommit.sha });
      return ok({ success: true, branch: branchName, commit_sha: newCommit.sha, files: treeItems.map(t => t.path) });
    } catch (error) { return err(error); }
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
        else return { content: [{ type: 'text' as const, text: 'Error: Could not get file SHA' }], isError: true };
      }
      const { data } = await octokit.repos.deleteFile({ owner, repo, path, message, sha: fileSha, branch });
      return ok(data);
    } catch (error) { return err(error); }
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
      return ok(commits);
    } catch (error) { return err(error); }
  });

  server.tool('get_commit', 'Get a specific commit', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    ref: z.string().describe('Commit SHA')
  }, async ({ owner, repo, ref }) => {
    try {
      const { data } = await octokit.repos.getCommit({ owner, repo, ref });
      return ok({
        sha: data.sha, message: data.commit.message, author: data.commit.author,
        files: data.files?.map(f => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions }))
      });
    } catch (error) { return err(error); }
  });

  server.tool('compare_commits', 'Compare two commits', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    base: z.string().describe('Base commit/branch'),
    head: z.string().describe('Head commit/branch')
  }, async ({ owner, repo, base, head }) => {
    try {
      const { data } = await octokit.repos.compareCommits({ owner, repo, base, head });
      return ok({
        status: data.status, ahead_by: data.ahead_by, behind_by: data.behind_by, total_commits: data.total_commits,
        files: data.files?.map(f => ({ filename: f.filename, status: f.status }))
      });
    } catch (error) { return err(error); }
  });

  server.tool('create_commit_status', 'Create a commit status (CI-style status check on a SHA)', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    sha: z.string().describe('Commit SHA'),
    state: z.enum(['error', 'failure', 'pending', 'success']).describe('Status state'),
    context: z.string().optional().describe('Status context label (default: default)'),
    description: z.string().optional().describe('Short description'),
    target_url: z.string().optional().describe('Link with details')
  }, async ({ owner, repo, sha, state, context, description, target_url }) => {
    try {
      const { data } = await octokit.repos.createCommitStatus({ owner, repo, sha, state, context, description, target_url });
      return ok(data);
    } catch (error) { return err(error); }
  });

  server.tool('list_commit_statuses', 'List statuses for a commit ref', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    ref: z.string().describe('Commit SHA, branch, or tag')
  }, async ({ owner, repo, ref }) => {
    try {
      const { data } = await octokit.repos.listCommitStatusesForRef({ owner, repo, ref });
      return ok(data.map(s => ({ state: s.state, context: s.context, description: s.description, created_at: s.created_at })));
    } catch (error) { return err(error); }
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
      return ok(data.map(i => ({
        number: i.number, title: i.title, state: i.state, labels: i.labels.map((l: any) => l.name), assignees: i.assignees?.map(a => a.login)
      })));
    } catch (error) { return err(error); }
  });

  server.tool('get_issue', 'Get a specific issue', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    issue_number: z.number().describe('Issue number')
  }, async ({ owner, repo, issue_number }) => {
    try {
      const { data } = await octokit.issues.get({ owner, repo, issue_number });
      return ok(data);
    } catch (error) { return err(error); }
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
      return ok(data);
    } catch (error) { return err(error); }
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
      return ok(data);
    } catch (error) { return err(error); }
  });

  server.tool('lock_issue', 'Lock an issue conversation', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    issue_number: z.number().describe('Issue number'),
    lock_reason: z.enum(['off-topic', 'too heated', 'resolved', 'spam']).optional().describe('Lock reason')
  }, async ({ owner, repo, issue_number, lock_reason }) => {
    try {
      await octokit.issues.lock({ owner, repo, issue_number, lock_reason });
      return ok({ success: true, locked: issue_number });
    } catch (error) { return err(error); }
  });

  server.tool('unlock_issue', 'Unlock an issue conversation', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    issue_number: z.number().describe('Issue number')
  }, async ({ owner, repo, issue_number }) => {
    try {
      await octokit.issues.unlock({ owner, repo, issue_number });
      return ok({ success: true, unlocked: issue_number });
    } catch (error) { return err(error); }
  });

  server.tool('create_issue_comment', 'Add a comment to an issue', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    issue_number: z.number().describe('Issue number'),
    body: z.string().describe('Comment body')
  }, async ({ owner, repo, issue_number, body }) => {
    try {
      const { data } = await octokit.issues.createComment({ owner, repo, issue_number, body });
      return ok(data);
    } catch (error) { return err(error); }
  });

  server.tool('list_issue_comments', 'List comments on an issue or PR', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    issue_number: z.number().describe('Issue or PR number'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ owner, repo, issue_number, per_page = 30 }) => {
    try {
      const { data } = await octokit.issues.listComments({ owner, repo, issue_number, per_page });
      return ok(data.map(c => ({ id: c.id, user: c.user?.login, body: c.body, created_at: c.created_at })));
    } catch (error) { return err(error); }
  });

  server.tool('update_issue_comment', 'Edit an existing issue/PR comment', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    comment_id: z.number().describe('Comment ID'),
    body: z.string().describe('New comment body')
  }, async ({ owner, repo, comment_id, body }) => {
    try {
      const { data } = await octokit.issues.updateComment({ owner, repo, comment_id, body });
      return ok({ success: true, id: data.id, url: data.html_url });
    } catch (error) { return err(error); }
  });

  server.tool('delete_issue_comment', 'Delete an issue/PR comment', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    comment_id: z.number().describe('Comment ID')
  }, async ({ owner, repo, comment_id }) => {
    try {
      await octokit.issues.deleteComment({ owner, repo, comment_id });
      return ok({ success: true, deleted: comment_id });
    } catch (error) { return err(error); }
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
      return ok(data.map(p => ({
        number: p.number, title: p.title, state: p.state, head: p.head.ref, base: p.base.ref, user: p.user?.login
      })));
    } catch (error) { return err(error); }
  });

  server.tool('get_pull_request', 'Get a specific pull request', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    pull_number: z.number().describe('PR number')
  }, async ({ owner, repo, pull_number }) => {
    try {
      const { data } = await octokit.pulls.get({ owner, repo, pull_number });
      return ok(data);
    } catch (error) { return err(error); }
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
      return ok(data);
    } catch (error) { return err(error); }
  });

  server.tool('update_pull_request', 'Update a pull request (title, body, state, base). Use state=closed to close a PR.', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    pull_number: z.number().describe('PR number'),
    title: z.string().optional().describe('New title'),
    body: z.string().optional().describe('New body'),
    state: z.enum(['open', 'closed']).optional().describe('State'),
    base: z.string().optional().describe('New base branch')
  }, async ({ owner, repo, pull_number, title, body, state, base }) => {
    try {
      const { data } = await octokit.pulls.update({ owner, repo, pull_number, title, body, state, base });
      return ok({ number: data.number, title: data.title, state: data.state, base: data.base.ref, url: data.html_url });
    } catch (error) { return err(error); }
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
      return ok(data);
    } catch (error) { return err(error); }
  });

  server.tool('update_pull_request_branch', 'Update a PR branch with the latest base branch changes', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    pull_number: z.number().describe('PR number')
  }, async ({ owner, repo, pull_number }) => {
    try {
      const { data } = await octokit.pulls.updateBranch({ owner, repo, pull_number });
      return ok(data);
    } catch (error) { return err(error); }
  });

  server.tool('list_pr_files', 'List files changed in a PR', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    pull_number: z.number().describe('PR number')
  }, async ({ owner, repo, pull_number }) => {
    try {
      const { data } = await octokit.pulls.listFiles({ owner, repo, pull_number });
      return ok(data.map(f => ({
        filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions
      })));
    } catch (error) { return err(error); }
  });

  server.tool('list_pr_reviews', 'List reviews on a pull request', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    pull_number: z.number().describe('PR number')
  }, async ({ owner, repo, pull_number }) => {
    try {
      const { data } = await octokit.pulls.listReviews({ owner, repo, pull_number });
      return ok(data.map(r => ({ id: r.id, user: r.user?.login, state: r.state, body: r.body, submitted_at: r.submitted_at })));
    } catch (error) { return err(error); }
  });

  server.tool('create_pr_review', 'Create a review on a pull request (approve, request changes, or comment)', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    pull_number: z.number().describe('PR number'),
    event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']).describe('Review action'),
    body: z.string().optional().describe('Review body (required for REQUEST_CHANGES and COMMENT)')
  }, async ({ owner, repo, pull_number, event, body }) => {
    try {
      const { data } = await octokit.pulls.createReview({ owner, repo, pull_number, event, body });
      return ok({ id: data.id, state: data.state, user: data.user?.login });
    } catch (error) { return err(error); }
  });

  server.tool('request_pr_reviewers', 'Request reviewers on a pull request', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    pull_number: z.number().describe('PR number'),
    reviewers: z.array(z.string()).describe('Usernames to request review from')
  }, async ({ owner, repo, pull_number, reviewers }) => {
    try {
      const { data } = await octokit.pulls.requestReviewers({ owner, repo, pull_number, reviewers });
      return ok({ success: true, requested_reviewers: data.requested_reviewers?.map(r => r.login) });
    } catch (error) { return err(error); }
  });

  server.tool('list_pr_comments', 'List review comments (code comments) on a pull request', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    pull_number: z.number().describe('PR number'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ owner, repo, pull_number, per_page = 30 }) => {
    try {
      const { data } = await octokit.pulls.listReviewComments({ owner, repo, pull_number, per_page });
      return ok(data.map(c => ({ id: c.id, user: c.user?.login, path: c.path, line: c.line, body: c.body })));
    } catch (error) { return err(error); }
  });

  // ==================== RELEASES & TAGS ====================
  server.tool('list_releases', 'List releases', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ owner, repo, per_page = 30 }) => {
    try {
      const { data } = await octokit.repos.listReleases({ owner, repo, per_page });
      return ok(data.map(r => ({
        id: r.id, tag_name: r.tag_name, name: r.name, draft: r.draft, prerelease: r.prerelease, published_at: r.published_at
      })));
    } catch (error) { return err(error); }
  });

  server.tool('get_latest_release', 'Get the latest published release', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name')
  }, async ({ owner, repo }) => {
    try {
      const { data } = await octokit.repos.getLatestRelease({ owner, repo });
      return ok({ id: data.id, tag_name: data.tag_name, name: data.name, body: data.body, published_at: data.published_at, url: data.html_url });
    } catch (error) { return err(error); }
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
      return ok(data);
    } catch (error) { return err(error); }
  });

  server.tool('update_release', 'Update a release', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    release_id: z.number().describe('Release ID'),
    tag_name: z.string().optional().describe('Tag name'),
    name: z.string().optional().describe('Release name'),
    body: z.string().optional().describe('Release notes'),
    draft: z.boolean().optional().describe('Draft state'),
    prerelease: z.boolean().optional().describe('Prerelease state')
  }, async ({ owner, repo, release_id, tag_name, name, body, draft, prerelease }) => {
    try {
      const { data } = await octokit.repos.updateRelease({ owner, repo, release_id, tag_name, name, body, draft, prerelease });
      return ok({ id: data.id, tag_name: data.tag_name, name: data.name, draft: data.draft, prerelease: data.prerelease });
    } catch (error) { return err(error); }
  });

  server.tool('delete_release', 'Delete a release (does not delete the tag)', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    release_id: z.number().describe('Release ID')
  }, async ({ owner, repo, release_id }) => {
    try {
      await octokit.repos.deleteRelease({ owner, repo, release_id });
      return ok({ success: true, deleted: release_id });
    } catch (error) { return err(error); }
  });

  server.tool('list_tags', 'List tags', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ owner, repo, per_page = 30 }) => {
    try {
      const { data } = await octokit.repos.listTags({ owner, repo, per_page });
      return ok(data);
    } catch (error) { return err(error); }
  });

  // ==================== LABELS ====================
  server.tool('list_labels', 'List labels in a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name')
  }, async ({ owner, repo }) => {
    try {
      const { data } = await octokit.issues.listLabelsForRepo({ owner, repo });
      return ok(data);
    } catch (error) { return err(error); }
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
      return ok(data);
    } catch (error) { return err(error); }
  });

  server.tool('update_label', 'Update a label', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    name: z.string().describe('Current label name'),
    new_name: z.string().optional().describe('New label name'),
    color: z.string().optional().describe('Color (hex without #)'),
    description: z.string().optional().describe('Description')
  }, async ({ owner, repo, name, new_name, color, description }) => {
    try {
      const { data } = await octokit.issues.updateLabel({ owner, repo, name, new_name, color, description });
      return ok(data);
    } catch (error) { return err(error); }
  });

  server.tool('delete_label', 'Delete a label', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    name: z.string().describe('Label name')
  }, async ({ owner, repo, name }) => {
    try {
      await octokit.issues.deleteLabel({ owner, repo, name });
      return ok({ success: true, deleted: name });
    } catch (error) { return err(error); }
  });

  // ==================== WORKFLOWS & ACTIONS ====================
  server.tool('list_workflows', 'List workflows', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name')
  }, async ({ owner, repo }) => {
    try {
      const { data } = await octokit.actions.listRepoWorkflows({ owner, repo });
      return ok(data.workflows);
    } catch (error) { return err(error); }
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
      return ok(data.workflow_runs.map(r => ({
        id: r.id, name: r.name, status: r.status, conclusion: r.conclusion, branch: r.head_branch, created_at: r.created_at
      })));
    } catch (error) { return err(error); }
  });

  server.tool('get_workflow_run', 'Get details of a workflow run', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    run_id: z.number().describe('Run ID')
  }, async ({ owner, repo, run_id }) => {
    try {
      const { data } = await octokit.actions.getWorkflowRun({ owner, repo, run_id });
      return ok({ id: data.id, name: data.name, status: data.status, conclusion: data.conclusion, branch: data.head_branch, event: data.event, created_at: data.created_at, updated_at: data.updated_at, url: data.html_url });
    } catch (error) { return err(error); }
  });

  server.tool('list_workflow_run_jobs', 'List jobs for a workflow run (with step-level status)', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    run_id: z.number().describe('Run ID')
  }, async ({ owner, repo, run_id }) => {
    try {
      const { data } = await octokit.actions.listJobsForWorkflowRun({ owner, repo, run_id });
      return ok(data.jobs.map(j => ({
        id: j.id, name: j.name, status: j.status, conclusion: j.conclusion,
        steps: j.steps?.map(s => ({ name: s.name, status: s.status, conclusion: s.conclusion }))
      })));
    } catch (error) { return err(error); }
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
      return ok({ success: true, workflow_id, ref });
    } catch (error) { return err(error); }
  });

  server.tool('cancel_workflow_run', 'Cancel a workflow run', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    run_id: z.number().describe('Run ID')
  }, async ({ owner, repo, run_id }) => {
    try {
      await octokit.actions.cancelWorkflowRun({ owner, repo, run_id });
      return ok({ success: true, cancelled: run_id });
    } catch (error) { return err(error); }
  });

  server.tool('rerun_workflow', 'Re-run a workflow', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    run_id: z.number().describe('Run ID')
  }, async ({ owner, repo, run_id }) => {
    try {
      await octokit.actions.reRunWorkflow({ owner, repo, run_id });
      return ok({ success: true, rerun: run_id });
    } catch (error) { return err(error); }
  });

  // ==================== WEBHOOKS ====================
  server.tool('list_webhooks', 'List repository webhooks', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name')
  }, async ({ owner, repo }) => {
    try {
      const { data } = await octokit.repos.listWebhooks({ owner, repo });
      return ok(data.map(h => ({ id: h.id, url: h.config.url, events: h.events, active: h.active })));
    } catch (error) { return err(error); }
  });

  server.tool('create_webhook', 'Create a repository webhook', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    url: z.string().describe('Payload URL'),
    events: z.array(z.string()).optional().describe('Events to subscribe to (default: push)'),
    secret: z.string().optional().describe('Webhook secret'),
    content_type: z.enum(['json', 'form']).optional().describe('Payload content type (default: json)'),
    active: z.boolean().optional().describe('Active (default true)')
  }, async ({ owner, repo, url, events = ['push'], secret, content_type = 'json', active = true }) => {
    try {
      const { data } = await octokit.repos.createWebhook({
        owner, repo, active, events,
        config: { url, content_type, ...(secret ? { secret } : {}) }
      });
      return ok({ id: data.id, url: data.config.url, events: data.events, active: data.active });
    } catch (error) { return err(error); }
  });

  server.tool('delete_webhook', 'Delete a repository webhook', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    hook_id: z.number().describe('Webhook ID')
  }, async ({ owner, repo, hook_id }) => {
    try {
      await octokit.repos.deleteWebhook({ owner, repo, hook_id });
      return ok({ success: true, deleted: hook_id });
    } catch (error) { return err(error); }
  });

  // ==================== COLLABORATORS ====================
  server.tool('list_collaborators', 'List repository collaborators', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name')
  }, async ({ owner, repo }) => {
    try {
      const { data } = await octokit.repos.listCollaborators({ owner, repo });
      return ok(data.map(c => ({ login: c.login, permissions: c.permissions })));
    } catch (error) { return err(error); }
  });

  server.tool('add_collaborator', 'Add a collaborator', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    username: z.string().describe('Username to add'),
    permission: z.enum(['pull', 'push', 'admin', 'maintain', 'triage']).optional().describe('Permission level')
  }, async ({ owner, repo, username, permission = 'push' }) => {
    try {
      const { data } = await octokit.repos.addCollaborator({ owner, repo, username, permission });
      return ok(data);
    } catch (error) { return err(error); }
  });

  server.tool('remove_collaborator', 'Remove a collaborator', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    username: z.string().describe('Username to remove')
  }, async ({ owner, repo, username }) => {
    try {
      await octokit.repos.removeCollaborator({ owner, repo, username });
      return ok({ success: true, removed: username });
    } catch (error) { return err(error); }
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
      return ok(data.items.map(r => ({
        name: r.full_name, description: r.description, stars: r.stargazers_count, url: r.html_url
      })));
    } catch (error) { return err(error); }
  });

  server.tool('search_code', 'Search code', {
    q: z.string().describe('Search query'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ q, per_page = 10 }) => {
    try {
      const { data } = await octokit.search.code({ q, per_page });
      return ok(data.items.map(i => ({
        name: i.name, path: i.path, repository: i.repository.full_name, url: i.html_url
      })));
    } catch (error) { return err(error); }
  });

  server.tool('search_issues', 'Search issues and PRs', {
    q: z.string().describe('Search query'),
    sort: z.enum(['created', 'updated', 'comments']).optional().describe('Sort field'),
    order: z.enum(['asc', 'desc']).optional().describe('Sort order'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ q, sort, order, per_page = 10 }) => {
    try {
      const { data } = await octokit.search.issuesAndPullRequests({ q, sort, order, per_page });
      return ok(data.items.map(i => ({
        number: i.number, title: i.title, state: i.state, repository: i.repository_url.split('/').slice(-2).join('/'), url: i.html_url
      })));
    } catch (error) { return err(error); }
  });

  server.tool('search_users', 'Search users', {
    q: z.string().describe('Search query'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ q, per_page = 10 }) => {
    try {
      const { data } = await octokit.search.users({ q, per_page });
      return ok(data.items.map(u => ({
        login: u.login, type: u.type, url: u.html_url
      })));
    } catch (error) { return err(error); }
  });

  // ==================== GISTS ====================
  server.tool('list_gists', 'List gists for authenticated user', {
    per_page: z.number().optional().describe('Results per page')
  }, async ({ per_page = 30 }) => {
    try {
      const { data } = await octokit.gists.list({ per_page });
      return ok(data.map(g => ({
        id: g.id, description: g.description, public: g.public, files: Object.keys(g.files || {}), url: g.html_url
      })));
    } catch (error) { return err(error); }
  });

  server.tool('get_gist', 'Get a gist with decoded file contents', {
    gist_id: z.string().describe('Gist ID')
  }, async ({ gist_id }) => {
    try {
      const { data } = await octokit.gists.get({ gist_id });
      const files: Record<string, string> = {};
      for (const [name, f] of Object.entries(data.files || {})) {
        files[name] = (f as any)?.content || '';
      }
      return ok({ id: data.id, description: data.description, public: data.public, files, url: data.html_url });
    } catch (error) { return err(error); }
  });

  server.tool('create_gist', 'Create a gist', {
    description: z.string().optional().describe('Gist description'),
    public: z.boolean().optional().describe('Public gist'),
    files: z.record(z.object({ content: z.string() })).describe('Files object')
  }, async ({ description, public: isPublic = false, files }) => {
    try {
      const { data } = await octokit.gists.create({ description, public: isPublic, files });
      return ok(data);
    } catch (error) { return err(error); }
  });

  server.tool('update_gist', 'Update a gist (set a file content to empty string to delete it)', {
    gist_id: z.string().describe('Gist ID'),
    description: z.string().optional().describe('New description'),
    files: z.record(z.object({ content: z.string() })).optional().describe('Files to add/update')
  }, async ({ gist_id, description, files }) => {
    try {
      const { data } = await octokit.gists.update({ gist_id, description, files: files as any });
      return ok({ id: data.id, description: data.description, files: Object.keys(data.files || {}), url: data.html_url });
    } catch (error) { return err(error); }
  });

  server.tool('delete_gist', 'Delete a gist', {
    gist_id: z.string().describe('Gist ID')
  }, async ({ gist_id }) => {
    try {
      await octokit.gists.delete({ gist_id });
      return ok({ success: true, deleted: gist_id });
    } catch (error) { return err(error); }
  });

  // ==================== STARRING ====================
  server.tool('list_stargazers', 'List stargazers of a repo', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name'),
    per_page: z.number().optional().describe('Results per page')
  }, async ({ owner, repo, per_page = 30 }) => {
    try {
      const { data } = await octokit.activity.listStargazersForRepo({ owner, repo, per_page });
      return ok(data.map((s: any) => s.login || s));
    } catch (error) { return err(error); }
  });

  server.tool('star_repository', 'Star a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name')
  }, async ({ owner, repo }) => {
    try {
      await octokit.activity.starRepoForAuthenticatedUser({ owner, repo });
      return ok({ success: true, starred: `${owner}/${repo}` });
    } catch (error) { return err(error); }
  });

  server.tool('unstar_repository', 'Unstar a repository', {
    owner: z.string().describe('Repository owner'),
    repo: z.string().describe('Repository name')
  }, async ({ owner, repo }) => {
    try {
      await octokit.activity.unstarRepoForAuthenticatedUser({ owner, repo });
      return ok({ success: true, unstarred: `${owner}/${repo}` });
    } catch (error) { return err(error); }
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
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    tool_count: TOOL_COUNT
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
  console.log(`GitHub MCP SSE Server v3.0.0 running on port ${PORT}`);
  console.log(`${TOOL_COUNT} tools available`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
});
