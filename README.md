# @entroute/mcp-server

MCP Server for AI agents to discover and call pay-per-request APIs via [EntRoute](https://entroute.com).

Give Claude, Cursor, Windsurf, or any MCP-compatible agent access to 350+ verified x402 API endpoints across 110+ capabilities — DeFi prices, web search, prediction markets, news, and more.

## Install

### Claude Code
```bash
claude mcp add entroute -- npx @entroute/mcp-server
```

### Claude Desktop
Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "entroute": {
      "command": "npx",
      "args": ["@entroute/mcp-server"],
      "env": {
        "ENTROUTE_API_URL": "https://api.entroute.com"
      }
    }
  }
}
```

### Cursor / Windsurf
Add to your MCP settings with command `npx @entroute/mcp-server`.

## Tools

### `discover_paid_api`
Find ranked, verified API endpoints for any capability. Supports natural language intent or explicit capability IDs.

```
"Find me an API to get the current price of ETH"
→ Returns ranked endpoints with pricing, success rates, and latency metrics
```

### `list_capabilities`
Browse all available capability types. Filter by tag or search by keyword.

### `call_paid_api`
Execute a discovered endpoint. Optionally handles x402 payments automatically when a wallet is configured.

## Payment (Optional)

To enable automatic x402 payments, set these environment variables:

```bash
EVM_PRIVATE_KEY=0x...          # Wallet private key for USDC payments on Base
MAX_PAYMENT_PER_REQUEST=0.05   # Max USD per request (default: $0.05)
```

Without a wallet, the server still discovers endpoints — you just can't auto-pay for 402-protected ones.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENTROUTE_API_URL` | `https://api.entroute.com` | EntRoute API base URL |
| `EVM_PRIVATE_KEY` | — | Hex private key for x402 payments |
| `MAX_PAYMENT_PER_REQUEST` | `0.05` | Spending cap per request in USD |

## Example Usage

Once installed, ask your agent:

- *"What APIs are available for DeFi?"*
- *"Find me a web search API"*
- *"Get the current price of ETH using a paid API"*
- *"Search the news for AI agent developments"*

The agent will use `discover_paid_api` to find endpoints, show you the options with pricing, and call the best one.

## Capabilities

EntRoute indexes 110+ capabilities across categories including:

- **Finance/DeFi** — token prices, swap quotes, portfolio tracking, yield data
- **Web** — search, scraping, URL shortening
- **Identity** — wallet profiles, ENS resolution
- **AI** — text generation, image generation
- **News** — search, trending topics
- **Security** — contract audits, threat intelligence
- **Prediction** — market data, odds

Browse all capabilities at [entroute.com/capabilities](https://entroute.com/capabilities).

## Links

- [Documentation](https://entroute.com/docs)
- [TypeScript SDK](https://www.npmjs.com/package/@entroute/sdk-agent-ts)
- [API Reference](https://entroute.com/docs/api)
- [npm](https://www.npmjs.com/package/@entroute/mcp-server)

## License

MIT
