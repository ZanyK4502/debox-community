---
name: debox-community
description: "Use when a user needs DeBox group lookup, membership verification, voting or lottery stats, profile reports, or batch wallet checks. Requires a DeBox API key."
homepage: https://docs.debox.pro/zh/category/apis--sdks
metadata:
  openclaw:
    emoji: "🎫"
    requires:
      bins: ["node", "npm"]
      env: ["DEBOX_API_KEY"]
---

# When To Use

Use this skill when the task is about DeBox community data:

- Query a group by invite URL
- Check whether a wallet has joined a group
- Verify voting or lottery thresholds
- Generate a DeBox profile report
- Batch-verify a wallet list

# Required Inputs

- `apiKey`: from `DEBOX_API_KEY` or `~/.openclaw/workspace/skills/debox-community/config.json`
- For group-based commands: prefer `groupUrl` such as `https://m.debox.pro/group?id=xxxx`
- For membership or verification: `wallet`
- For profile and user lookup: `userId`

If a required value is missing, ask only for the missing field. Prefer asking for `groupUrl` rather than `groupId`.

# Config

Config file path:

`~/.openclaw/workspace/skills/debox-community/config.json`

Example:

```json
{
  "apiKey": "your-debox-api-key-here",
  "defaultGroupUrl": "https://m.debox.pro/group?id=your-group-id",
  "defaultChainId": 1,
  "defaultBatchDelayMs": 650
}
```

`defaultGroupId` is still accepted for backward compatibility, but `defaultGroupUrl` is the preferred setting.

# Command Mapping

- Group lookup: `node scripts/debox-community.js info --url "<group-url>"`
- Member check: `node scripts/debox-community.js check-member --wallet "<wallet>" --group-url "<group-url>"`
- User lookup: `node scripts/debox-community.js user-info --user-id "<user-id>"`
- Vote stats: `node scripts/debox-community.js vote-stats --wallet "<wallet>" --group-url "<group-url>"`
- Lottery stats: `node scripts/debox-community.js lottery-stats --wallet "<wallet>" --group-url "<group-url>"`
- Praise stats: `node scripts/debox-community.js praise-info --wallet "<wallet>"`
- Profile report: `node scripts/debox-community.js profile --user-id "<user-id>" [--image] [--output profile.png]`
- Verification: `node scripts/debox-community.js verify --wallet "<wallet>" --group-url "<group-url>" [--min-votes N] [--min-lotteries N]`
- Batch verification: `node scripts/debox-community.js batch-verify --file wallets.txt --group-url "<group-url>" [--min-votes N] [--min-lotteries N] [--delay-ms 650]`

# Automation Output

- Default output is human-readable text.
- Add `--json` for structured JSON output.
- JSON mode is preferred for OpenClaw or other automation.

# Failure Handling

- If `config.json` is invalid, the script returns a readable config error instead of crashing.
- If DeBox returns wrapped data like `{ code, data }`, the script normalizes it before making decisions.
- Batch verification stays serial and uses a delay to stay under conservative rate limits.
- If vote or lottery APIs report no active items, the script normalizes that to a zero-count result.

# Fallback Rules

- If only `groupId` is available, the script converts it to a DeBox group URL.
- If `profile --image` cannot load an avatar, it renders a placeholder avatar instead.
- If praise stats fail during `profile`, the profile still returns user data with zeroed praise counts.

# Environment

Install dependencies inside the skill directory:

```bash
cd ~/.openclaw/workspace/skills/debox-community
npm install
```
