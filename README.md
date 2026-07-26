# gemini-openai-proxy

OpenAI-compatible proxy for Gemini Code Assist with multi-account OAuth rotation.

## Quick Start

```bash
# 1. Login with one or more Google accounts
npx ts-node bin/gemini-multi-auth.js login <label>

# 2. Start proxy
./start.sh

# 3. Use it
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-2.5-pro","messages":[{"role":"user","content":"Hello"}]}'
```

## CLI Commands

```bash
# Add account (opens browser for OAuth)
npx ts-node bin/gemini-multi-auth.js login <label>

# For workspace accounts (auto-discovers project):
npx ts-node bin/gemini-multi-auth.js login <label>

# Or specify project explicitly:
npx ts-node bin/gemini-multi-auth.js login <label> --project <project-id>

# Show account pool status
npx ts-node bin/gemini-multi-auth.js status

# Pin/unpin account for rotation
npx ts-node bin/gemini-multi-auth.js switch <account-id>

# Remove account
npx ts-node bin/gemini-multi-auth.js remove <account-id>
```

## Proxy Management

```bash
# Start (background)
./start.sh

# Start (foreground, for debugging)
./start.sh --foreground

# Check status
cat .proxy.pid && kill -0 $(cat .proxy.pid) && echo "Running"

# Stop
kill $(cat .proxy.pid)

# View logs
tail -f proxy.log
```

## How It Works

- **Multi-account rotation**: When pool has accounts, requests rotate between them with error-aware scoring (cooldown, error rate, LRU)
- **Legacy fallback**: When pool is empty, falls back to single account from `~/.gemini/`
- **Retry on errors**: Max 1 retry per request on 429/401/403 with different account
- **Token management**: Tokens stored in `~/.gemini-multi-auth/tokens/`, pool in `~/.gemini-multi-auth/pool.json`

## Models

- `gemini-2.5-pro` (default)
- Set `MODEL=gemini-2.5-flash` env var to override
