# Security: Handling Secrets

This document describes secure methods for passing API keys and secrets to thepopebot containers. **Never commit secrets to your repository.**

## Option 1: Environment Variables (Recommended for CI/CD)

Pass API keys as environment variables and generate `auth.json` at runtime.

### Modified entrypoint.sh

Add this before running Pi:

```bash
# Generate auth.json from environment variables
if [ -n "$ANTHROPIC_API_KEY" ] || [ -n "$OPENAI_API_KEY" ] || [ -n "$GROQ_API_KEY" ]; then
  cat > /job/auth.json << EOF
{
  "anthropic": { "type": "api_key", "key": "${ANTHROPIC_API_KEY:-}" },
  "openai": { "type": "api_key", "key": "${OPENAI_API_KEY:-}" },
  "groq": { "type": "api_key", "key": "${GROQ_API_KEY:-}" }
}
EOF
  echo "Generated auth.json from environment variables"
fi
```

### Usage

```bash
docker run -e ANTHROPIC_API_KEY="sk-ant-xxxxx" \
           -e GH_TOKEN="ghp_xxxxx" \
           -e REPO_URL="https://github.com/user/repo" \
           -e BRANCH="main" \
           thepopebot
```

### GitHub Actions Example

```yaml
jobs:
  run-agent:
    runs-on: ubuntu-latest
    steps:
      - name: Run thepopebot
        run: |
          docker run \
            -e ANTHROPIC_API_KEY=${{ secrets.ANTHROPIC_API_KEY }} \
            -e GH_TOKEN=${{ secrets.GH_TOKEN }} \
            -e REPO_URL=${{ github.server_url }}/${{ github.repository }} \
            -e BRANCH=${{ github.ref_name }} \
            thepopebot
```

## Option 2: Mount Secret File (Recommended for Local Development)

Keep `auth.json` outside the repository and mount it as a read-only volume.

### Setup

1. Create a secrets directory outside your repo:
   ```bash
   mkdir -p ~/.thepopebot-secrets
   ```

2. Create your auth.json there:
   ```bash
   cat > ~/.thepopebot-secrets/auth.json << 'EOF'
   {
     "anthropic": { "type": "api_key", "key": "sk-ant-xxxxx" },
     "openai": { "type": "api_key", "key": "sk-xxxxx" },
     "groq": { "type": "api_key", "key": "xxxxx" }
   }
   EOF
   chmod 600 ~/.thepopebot-secrets/auth.json
   ```

### Usage

```bash
docker run -v ~/.thepopebot-secrets/auth.json:/job/auth.json:ro \
           -e GH_TOKEN="ghp_xxxxx" \
           -e REPO_URL="https://github.com/user/repo" \
           -e BRANCH="main" \
           thepopebot
```

The `:ro` flag mounts the file as read-only.

## Option 3: Docker Secrets (For Docker Compose/Swarm)

Use Docker's built-in secrets management for production deployments.

### docker-compose.yml

```yaml
version: '3.8'

services:
  thepopebot:
    build: .
    environment:
      - REPO_URL=https://github.com/user/repo
      - BRANCH=main
    secrets:
      - anthropic_key
      - github_token

secrets:
  anthropic_key:
    file: ./secrets/anthropic_key.txt
  github_token:
    file: ./secrets/github_token.txt
```

### Modified entrypoint.sh for Docker Secrets

```bash
# Read from Docker secrets if available
if [ -f /run/secrets/anthropic_key ]; then
  ANTHROPIC_API_KEY=$(cat /run/secrets/anthropic_key)
fi

if [ -f /run/secrets/github_token ]; then
  GH_TOKEN=$(cat /run/secrets/github_token)
fi

# Generate auth.json
cat > /job/auth.json << EOF
{
  "anthropic": { "type": "api_key", "key": "${ANTHROPIC_API_KEY}" }
}
EOF
```

### Setup

```bash
mkdir -p secrets
echo "sk-ant-xxxxx" > secrets/anthropic_key.txt
echo "ghp_xxxxx" > secrets/github_token.txt
chmod 600 secrets/*.txt
```

### Usage

```bash
docker compose up
```

## Best Practices

1. **Never commit secrets** - Ensure `auth.json` and any secret files are in `.gitignore`
2. **Use least privilege** - Create API keys with minimal required permissions
3. **Rotate keys regularly** - Especially after any potential exposure
4. **Audit access** - Monitor API key usage through provider dashboards
5. **Use read-only mounts** - When mounting secret files, use `:ro` flag

## Verifying .gitignore

Ensure your `.gitignore` includes:

```
auth.json
secrets/
*.key
*.pem
```
