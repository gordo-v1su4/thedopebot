# thepopebot - AI Agent Template

This document explains the thepopebot codebase for AI assistants working on this project.

## What is thepopebot?

thepopebot is a **template repository** for creating custom autonomous AI agents. It features a two-layer architecture: an Event Handler for orchestration (webhooks, Telegram chat, cron scheduling) and a Docker Agent for autonomous task execution via the Pi coding agent.

## Two-Layer Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          thepopebot Architecture                          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────────────┐                                                   │
│   │  Event Handler   │                                                   │
│   │  ┌────────────┐  │         1. create-job                            │
│   │  │  Telegram  │  │ ─────────────────────────►  ┌──────────────────┐ │
│   │  │   Cron     │  │                             │      GitHub      │ │
│   │  │   Chat     │  │ ◄─────────────────────────  │  (job/* branch)  │ │
│   │  └────────────┘  │   5. pr-webhook.yml calls   └────────┬─────────┘ │
│   │                  │      /github/webhook                 │           │
│   └──────────────────┘                                      │           │
│            │                                                │           │
│            │                           2. job-runner.yml    │           │
│            ▼                              triggers          │           │
│   ┌──────────────────┐                                      │           │
│   │ Telegram notifies│                                      ▼           │
│   │ user of job done │                         ┌──────────────────────┐ │
│   └──────────────────┘                         │    Docker Agent      │ │
│                                                │  ┌────────────────┐  │ │
│                                                │  │ 1. Clone       │  │ │
│                                                │  │ 2. Run Pi      │  │ │
│                                                │  │ 3. Commit      │  │ │
│                                                │  │ 4. Create PR   │  │ │
│                                                │  └────────────────┘  │ │
│                                                └──────────┬───────────┘ │
│                                                           │             │
│                                                           │ 3. PR opens │
│                                                           ▼             │
│                                                ┌──────────────────────┐ │
│                                                │       GitHub         │ │
│                                                │    (PR opened)       │ │
│                                                │                      │ │
│                                                │ 4. pr-webhook.yml    │ │
│                                                │    triggers          │ │
│                                                └──────────────────────┘ │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
/
├── auth.json                   # API credentials (Pi looks here)
├── .github/workflows/
│   ├── job-runner.yml          # Runs Docker agent when job/* branch created
│   └── pr-webhook.yml          # Notifies event handler when PR opened
├── operating_system/
│   ├── THEPOPEBOT.md           # Agent behavior instructions
│   ├── SOUL.md                 # Agent identity and personality
│   ├── CHATBOT.md              # Telegram chat system prompt
│   ├── JOB_SUMMARY.md          # Job completion summary prompt
│   ├── HEARTBEAT.md            # Periodic check instructions
│   └── CRONS.json              # Scheduled job definitions
├── event_handler/              # Event Handler orchestration layer
│   ├── server.js               # Express HTTP server (webhooks, Telegram, GitHub)
│   ├── cron.js                 # Cron scheduler (loads CRONS.json)
│   ├── claude/
│   │   ├── index.js            # Claude API integration for chat
│   │   ├── tools.js            # Tool definitions (create_job)
│   │   └── conversation.js     # Chat history management
│   └── tools/
│       ├── create-job.js       # Job creation via GitHub API
│       ├── github.js           # GitHub REST API helper
│       └── telegram.js         # Telegram bot integration
├── MEMORY.md                   # Long-term knowledge
├── TOOLS.md                    # Available tools reference
├── Dockerfile                  # Container definition
├── entrypoint.sh               # Container startup script
└── workspace/
    ├── job.md                  # Current task description
    └── logs/                   # Session logs (UUID.jsonl)
```

## Key Files

| File | Purpose |
|------|---------|
| `auth.json` | API keys for Anthropic/OpenAI/Groq. Pi reads this via PI_CODING_AGENT_DIR |
| `operating_system/THEPOPEBOT.md` | Core behavior instructions passed to the agent at runtime |
| `operating_system/SOUL.md` | Agent personality and identity |
| `operating_system/CHATBOT.md` | System prompt for Telegram chat |
| `operating_system/JOB_SUMMARY.md` | Prompt for summarizing completed jobs |
| `workspace/job.md` | The specific task for the agent to execute |
| `Dockerfile` | Builds the agent container (Node.js 22, Playwright, Pi) |
| `entrypoint.sh` | Container startup script - clones repo, runs agent, commits results |

## Event Handler Layer

The Event Handler is a Node.js Express server that provides orchestration capabilities:

### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/webhook` | POST | Generic webhook for job creation (requires API_KEY) |
| `/telegram/webhook` | POST | Telegram bot webhook for conversational interface |
| `/github/webhook` | POST | Receives notifications from GitHub Actions (pr-webhook.yml) |

### Components

- **server.js** - Express HTTP server handling all webhook routes
- **cron.js** - Loads CRONS.json and schedules jobs using node-cron
- **claude/** - Claude API integration for Telegram chat with tool use
- **tools/** - Job creation, GitHub API, and Telegram utilities

### Environment Variables (Event Handler)

| Variable | Description | Required |
|----------|-------------|----------|
| `API_KEY` | Authentication key for /webhook endpoint | Yes |
| `GH_TOKEN` | GitHub PAT for creating branches/files | Yes |
| `GH_OWNER` | GitHub repository owner | Yes |
| `GH_REPO` | GitHub repository name | Yes |
| `PORT` | Server port (default: 3000) | No |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from BotFather | For Telegram |
| `TELEGRAM_WEBHOOK_SECRET` | Secret for webhook validation | No |
| `GH_WEBHOOK_TOKEN` | Token for GitHub Actions webhook auth | For notifications |
| `ANTHROPIC_API_KEY` | Claude API key (or use auth.json) | For chat |
| `EVENT_HANDLER_MODEL` | Claude model for chat (default: claude-sonnet-4) | No |

## Docker Agent Layer

The Dockerfile creates a container with:
- **Node.js 22** (Bookworm slim)
- **Pi coding agent** (`@mariozechner/pi-coding-agent`)
- **Playwright + Chromium** (headless browser automation)
- **Git + GitHub CLI** (for repository operations)

### Runtime Flow (entrypoint.sh)

1. Extract Job ID from branch name (job/uuid → uuid) or generate UUID
2. Start headless Chrome (CDP on port 9222)
3. Configure Git credentials via `gh auth setup-git`
4. Clone repository branch to `/job`
5. Set `PI_CODING_AGENT_DIR=/job` so Pi finds auth.json
6. Run Pi with THEPOPEBOT.md + SOUL.md + job.md as prompt
7. Save session log to `workspace/logs/{JOB_ID}/`
8. Commit all changes with message `thepopebot: job {JOB_ID}`
9. Create PR and auto-merge to main with `gh pr create` and `gh pr merge --squash`

### Environment Variables (Docker Agent)

| Variable | Description | Required |
|----------|-------------|----------|
| `REPO_URL` | Git repository URL to clone | Yes |
| `BRANCH` | Branch to clone and work on (e.g., job/uuid) | Yes |
| `GH_TOKEN` | GitHub token for gh CLI authentication | Yes |
| `PI_AUTH` | Base64-encoded auth.json contents | Yes |

## GitHub Actions

GitHub Actions automate the job lifecycle. No manual webhook configuration needed.

### job-runner.yml

Triggers when a `job/*` branch is created. Runs the Docker agent container.

```yaml
on:
  create:
# Only runs if: branch name starts with "job/"
```

### pr-webhook.yml

Triggers when a PR is opened from a `job/*` branch. Sends a notification to the event handler so it can notify Telegram.

```yaml
on:
  pull_request:
    types: [opened]
    branches: [main]
# Only runs if: PR head branch starts with "job/"
```

### GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `GH_TOKEN` | GitHub PAT for Docker agent authentication |
| `PI_AUTH` | Base64-encoded auth.json contents |
| `GH_WEBHOOK_URL` | Event handler URL (e.g., `https://your-server.com`) |
| `GH_WEBHOOK_TOKEN` | Token to authenticate with event handler |

## How Pi Finds Credentials

Pi coding agent looks for `auth.json` in the directory specified by `PI_CODING_AGENT_DIR`. The entrypoint sets:

```bash
export PI_CODING_AGENT_DIR=/job
```

This means `auth.json` must be at `/job/auth.json` (the repository root).

## auth.json Format

```json
{
  "anthropic": { "type": "api_key", "key": "sk-ant-xxxxx" },
  "openai": { "type": "api_key", "key": "sk-xxxxx" },
  "groq": { "type": "api_key", "key": "xxxxx" }
}
```

## Customization Points

To create your own agent:

1. **auth.json** - Add your API keys
2. **operating_system/THEPOPEBOT.md** - Modify agent behavior and rules
3. **operating_system/SOUL.md** - Customize personality and identity
4. **operating_system/CHATBOT.md** - Configure Telegram chat behavior
5. **operating_system/CRONS.json** - Define scheduled jobs
6. **workspace/job.md** - Define the task to execute

## The Operating System

These files in `operating_system/` define the agent's character and behavior:

- **THEPOPEBOT.md** - Operational instructions (what to do, how to work)
- **SOUL.md** - Personality, identity, and values (who the agent is)
- **CHATBOT.md** - System prompt for Telegram chat
- **JOB_SUMMARY.md** - Prompt for summarizing completed jobs
- **HEARTBEAT.md** - Self-monitoring behavior
- **CRONS.json** - Scheduled job definitions

Additional files at root:
- **MEMORY.md** - Persistent knowledge across sessions

## Session Logs

Each job creates a session log at `workspace/logs/{JOB_ID}/`. This directory contains the full conversation history and can be resumed for follow-up tasks via the `--session-dir` flag.
