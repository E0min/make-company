# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Virtual Company is a multi-agent orchestration system built on Claude Code CLI and Gemini CLI. Multiple AI agents run as independent interactive sessions in tmux windows, communicating via a file-based message bus (inbox/outbox markdown files). A router daemon parses @mentions to route messages between agents.

The project is a **template system** — `install.sh` copies `template/` into a target project's `.claude/company/` directory, where it can be customized via `config.json`.

## Commands

```bash
# Install into a project
bash install.sh [target_dir]

# Interactive setup (company name, session name, compact threshold)
bash .claude/company/setup.sh

# Start the virtual company (launches tmux session with all agents)
bash .claude/company/run.sh

# Send a task to the Orchestrator agent
bash .claude/company/kickoff.sh '태스크 설명'

# Stop the tmux session
bash .claude/company/stop.sh

# Rebuild skill index (auto-discovers skills from .claude/skills/)
OUTPUT=.claude/company/skill-index.json PROJECT_DIR=$(pwd) bash .claude/company/scripts/build-skill-index.sh

# Test skill recommendations for an agent role
bash .claude/company/scripts/suggest-skills.sh frontend "버그 디버깅"
```

## Architecture

### Communication Flow

```
kickoff.sh "task" → inbox/orch.md → Orch agent processes → outbox/orch.md
  → router.sh parses @mentions → inbox/{recipient}.md → recipient processes → ...
  → all messages logged to channel/general.md
```

### Key Components

- **run.sh** — Parses `config.json`, creates runtime dirs, spawns tmux session with one window per agent plus Monitor and Router windows
- **router.sh** — Daemon polling outbox files every 1s, routing messages by @mention to recipient inboxes, logging to `channel/general.md`
- **run-agent.sh** — Runs `claude --agent <agent_file>` in foreground + background watcher that polls inbox every 2s, sends messages via tmux send-keys, captures responses from scrollback, and auto-compacts when context usage exceeds threshold
- **run-gemini.sh** — Same pattern for `gemini --yolo` sessions (no skill recommendations)
- **monitor.sh** — Real-time dashboard showing agent states and channel log (refreshes every 3s)
- **suggest-skills.sh** — Scores skills from `skill-index.json` against agent role + message keywords, returns top 3 (~98% token savings vs loading all skills)

### Agent States

Tracked in `state/{agent}.state`: `idle`, `working`, `compacting`, `error`, `rate-limited`, `done`, `stopped`

### Response Capture

Agents use tmux scrollback line counting — record line count before sending, wait for prompt readiness (polls for `❯`/`>`/`$` patterns), extract new lines, strip ANSI codes, write to outbox.

## Configuration

`config.json` drives the entire system:
- `project` — Company/project name
- `session_name` — tmux session identifier
- `compact_threshold` — Context % to trigger auto-compact (default: 50)
- `agents[]` — Array of `{id, engine ("claude"|"gemini"), agent_file, label}`

Agent files reference `.claude/agents/` definitions. The `id` field maps to inbox/outbox/state filenames.

## Language & Platform

- All scripts are Bash (3.x compatible — uses `case` instead of associative arrays for macOS compatibility)
- Python 3 used only for JSON parsing in scripts
- Requires: `tmux`, `claude` CLI, `gemini` CLI (optional), `python3`
- macOS or Linux
- Documentation and UI strings are in Korean
