# My Agent

## What is this?

This is an autonomous AI agent powered by [thepopebot](https://github.com/stephengpope/thepopebot). It features a two-layer architecture: a Next.js Event Handler for orchestration (webhooks, Telegram chat, cron scheduling) and a Docker Agent for autonomous task execution.

## Directory Structure

```
/
├── .github/workflows/          # CI/CD workflows (managed by thepopebot)
├── .pi/skills/                 # Custom Pi agent skills
├── operating_system/           # Agent configuration
│   ├── SOUL.md                 # Agent personality and identity
│   ├── CHATBOT.md              # Telegram chat system prompt
│   ├── JOB_SUMMARY.md          # Job completion summary prompt
│   ├── HEARTBEAT.md            # Periodic check instructions
│   ├── TELEGRAM.md             # Telegram formatting guidelines
│   ├── AGENT.md                # Agent runtime environment
│   ├── CRONS.json              # Scheduled job definitions
│   └── TRIGGERS.json           # Webhook trigger definitions
├── app/                        # Next.js app directory
│   ├── layout.js               # Root layout
│   ├── page.js                 # Home page
│   └── api/[...thepopebot]/    # Framework API routes
├── cron/                       # Working dir for command-type cron actions
├── triggers/                   # Working dir for command-type trigger actions
├── logs/                       # Per-job directories (job.md + session logs)
├── next.config.mjs             # Next.js config with thepopebot wrapper
├── .env                        # API keys and tokens (gitignored)
└── package.json                # Dependencies
```

## Customization

- **operating_system/** — Agent personality, prompts, crons, triggers
- **.pi/skills/** — Custom Pi agent skills
- **cron/** and **triggers/** — Shell scripts for command-type actions
- **app/** — Add Next.js pages, API routes, components

## API Endpoints

All API routes are under `/api/`:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/webhook` | POST | Create a new job (requires API_KEY) |
| `/api/telegram/webhook` | POST | Telegram bot webhook |
| `/api/telegram/register` | POST | Register Telegram webhook URL |
| `/api/github/webhook` | POST | Receives notifications from GitHub Actions |
| `/api/jobs/status` | GET | Check status of a running job |
| `/api/ping` | GET | Health check |
