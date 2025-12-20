# GitHub MCP SSE Server

A remote MCP server for GitHub via HTTP/SSE transport. Deploy to Railway and connect from Claude.ai.

## Tools Available

- **list_repositories** - List your repositories
- **get_repository** - Get repository details
- **create_repository** - Create a new repository
- **list_branches** - List branches
- **get_file_contents** - Read file contents
- **create_or_update_file** - Create or update files
- **list_issues** - List issues
- **create_issue** - Create an issue
- **list_pull_requests** - List PRs
- **create_pull_request** - Create a PR
- **list_commits** - List commits
- **list_workflows** - List GitHub Actions workflows
- **list_workflow_runs** - List workflow runs
- **get_authenticated_user** - Get your user info
- **search_repositories** - Search repos

## Deploy to Railway

1. Push this folder to GitHub
2. In Railway: New Project > Deploy from GitHub repo
3. Add environment variable:
   - `GITHUB_TOKEN` - Your GitHub Personal Access Token
4. Generate domain in Settings > Networking
5. Add to Claude: Settings > Connectors > Add custom connector
   - URL: `https://YOUR-DOMAIN.up.railway.app/sse`

## Get GitHub Token

1. Go to github.com/settings/tokens
2. Generate new token (classic)
3. Select scopes: repo, workflow, read:user
4. Copy the token

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes | GitHub Personal Access Token |
| `PORT` | No | Server port (default: 3000) |
