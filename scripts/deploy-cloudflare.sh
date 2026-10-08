#!/bin/sh
# Deploys the hosted service. The production hostname and Cloudflare account
# stay out of the repository: set AGENT_MEMORY_DOMAIN and CLOUDFLARE_ACCOUNT_ID
# in the environment or an uncommitted .env file.
set -eu
: "${AGENT_MEMORY_DOMAIN:?Set AGENT_MEMORY_DOMAIN to the service hostname.}"
exec wrangler deploy --domain "$AGENT_MEMORY_DOMAIN" "$@"
