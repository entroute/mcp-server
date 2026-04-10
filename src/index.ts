#!/usr/bin/env node
/**
 * EntRoute MCP Server
 *
 * Model Context Protocol server for agent integration.
 * Provides tools for discovering and calling pay-per-request APIs.
 *
 * Tools:
 * - discover_paid_api: Find endpoints for a capability
 * - list_capabilities: Browse available capability types
 * - call_paid_api: Execute a discovered endpoint (with x402 v2 payment handling)
 *
 * Environment variables:
 * - EVM_PRIVATE_KEY: Hex private key (0x...) for automatic x402 payments
 * - MAX_PAYMENT_PER_REQUEST: Max USD per request (default: 0.05)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  EntRouteClient,
  PaymentRequiredError,
  PaymentExceedsLimitError,
  type RankedEndpoint,
} from '@entroute/sdk-agent-ts';

// Payment configuration from environment
const evmPrivateKey = process.env.EVM_PRIVATE_KEY;
const maxPaymentPerRequest = process.env.MAX_PAYMENT_PER_REQUEST
  ? parseFloat(process.env.MAX_PAYMENT_PER_REQUEST)
  : 0.05;
const paymentConfigured = !!evmPrivateKey;

// Initialize client with optional payment support
const client = new EntRouteClient({
  baseUrl: 'https://api.entroute.com',
  clientId: 'mcp-server',
  autoReportOutcomes: true,
  evmPrivateKey: evmPrivateKey,
  maxPaymentPerRequest,
});

if (paymentConfigured) {
  console.error(`Payment enabled: wallet ${client.walletAddress}, max $${maxPaymentPerRequest}/request`);
} else {
  console.error('Payment not configured. Set EVM_PRIVATE_KEY to enable automatic x402 payments.');
}

// Store discovered endpoints for call_paid_api
const endpointCache = new Map<string, RankedEndpoint>();

const server = new Server(
  {
    name: 'entroute',
    version: '0.1.6',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Build dynamic tool description for call_paid_api based on payment config
const callApiDescription = paymentConfigured
  ? `Call a previously discovered API endpoint.

Use this after discover_paid_api to execute the request.
Automatically handles x402 payments up to $${maxPaymentPerRequest.toFixed(2)} per request using the configured wallet.

IMPORTANT: You must first use discover_paid_api to find an endpoint.
Then use the endpoint_id from the discovery result.

Trust & safety:
- Payments are capped at $${maxPaymentPerRequest.toFixed(2)} per request. Calls exceeding this are rejected.
- Private keys never leave this machine. Payment signatures are created locally.
- EntRoute verifies that endpoints return valid 402 responses every 10 minutes, but does not guarantee response quality or accuracy. Treat results like any third-party API.
- Prefer endpoints with high success rates (>95%) and recent verification timestamps.`
  : `Call a previously discovered API endpoint.

Use this after discover_paid_api to execute the request.
Payment-required endpoints (402) will return an error with payment details since no wallet is configured.

IMPORTANT: You must first use discover_paid_api to find an endpoint.
Then use the endpoint_id from the discovery result.

Trust & safety:
- No wallet is configured, so paid endpoints will return payment details without executing.
- EntRoute verifies that endpoints return valid 402 responses every 10 minutes, but does not guarantee response quality or accuracy.`;

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'discover_paid_api',
        description: `Discover pay-per-request API endpoints for a given capability.

Returns ranked, verified endpoints with pricing and reliability metrics.
Use this to find APIs before calling them. The results include:
- Endpoint URL and method
- Price per call and payment network
- Success rate and latency metrics
- Provider information

After discovering, you can use call_paid_api to execute the endpoint.

Trust & safety:
- "Verified" means the endpoint returns a valid x402 402 response -- it does not guarantee the quality or accuracy of the data returned after payment.
- Endpoints are probed every 10 minutes. Check last_verified and success_rate to gauge reliability.
- Fallback endpoints (unverified) have failed recent verification checks -- use with caution.
- Prefer endpoints with success_rate >95% and verification within the last 24 hours.`,
        inputSchema: {
          type: 'object',
          properties: {
            intent: {
              type: 'string',
              description: 'Natural language description of what you want to do (e.g., "get current weather for London", "translate text to Spanish"). Provide this or capability_id.',
            },
            capability_id: {
              type: 'string',
              description: 'Explicit capability ID if known (e.g., "weather.current", "translate.text"). Alternative to intent for precise matching.',
            },
            max_price: {
              type: 'number',
              description: 'Maximum price per request in USD (e.g., 0.01 for 1 cent)',
            },
            network: {
              type: 'string',
              description: 'Required blockchain network for payment',
              enum: ['base', 'ethereum', 'solana', 'polygon', 'arbitrum'],
            },
            ranking_preset: {
              type: 'string',
              description: 'Ranking preference preset',
              enum: ['default', 'reliability', 'speed', 'budget', 'balanced'],
            },
            limit: {
              type: 'number',
              description: 'Maximum number of endpoints to return (default: 5)',
            },
          },
          required: ['intent'],
        },
      },
      {
        name: 'list_capabilities',
        description: `List available API capability types.

Use this to explore what kinds of APIs are available in the registry.
You can filter by tag (e.g., "weather", "translation") or search by keyword.

Note: A capability existing does not mean verified endpoints are available for it. Use discover_paid_api to check for live endpoints.`,
        inputSchema: {
          type: 'object',
          properties: {
            tag: {
              type: 'string',
              description: 'Filter by tag (e.g., "weather", "translation", "finance")',
            },
            search: {
              type: 'string',
              description: 'Search capabilities by keyword',
            },
          },
        },
      },
      {
        name: 'call_paid_api',
        description: callApiDescription,
        inputSchema: {
          type: 'object',
          properties: {
            endpoint_id: {
              type: 'string',
              description: 'The endpoint_id from a previous discover_paid_api result',
            },
            method: {
              type: 'string',
              description: 'HTTP method (defaults to endpoint method)',
              enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
            },
            headers: {
              type: 'object',
              description: 'Additional headers to include in the request',
              additionalProperties: { type: 'string' },
            },
            body: {
              type: 'object',
              description: 'Request body (for POST/PUT/PATCH)',
              additionalProperties: true,
            },
            query_params: {
              type: 'object',
              description: 'Query parameters to append to URL',
              additionalProperties: { type: 'string' },
            },
          },
          required: ['endpoint_id'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'discover_paid_api':
      return handleDiscover(args as {
        intent?: string;
        capability_id?: string;
        max_price?: number;
        network?: string;
        ranking_preset?: string;
        limit?: number;
      });

    case 'list_capabilities':
      return handleListCapabilities(args as {
        tag?: string;
        search?: string;
      });

    case 'call_paid_api':
      return handleCallApi(args as {
        endpoint_id: string;
        method?: string;
        headers?: Record<string, string>;
        body?: Record<string, unknown>;
        query_params?: Record<string, string>;
      });

    default:
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
        isError: true,
      };
  }
});

async function handleDiscover(args: {
  intent?: string;
  capability_id?: string;
  max_price?: number;
  network?: string;
  ranking_preset?: string;
  limit?: number;
}) {
  try {
    const result = args.intent
      ? await client.discoverByIntent(args.intent, {
          constraints: {
            max_price: args.max_price,
            network: args.network as 'base' | 'ethereum' | 'solana' | 'polygon' | 'arbitrum',
          },
          preferences: {
            ranking_preset: args.ranking_preset as 'default' | 'reliability' | 'speed' | 'budget' | 'balanced',
            limit: args.limit,
            include_fallbacks: true,
          },
        })
      : await client.discoverByCapability(args.capability_id!, undefined, {
          constraints: {
            max_price: args.max_price,
            network: args.network as 'base' | 'ethereum' | 'solana' | 'polygon' | 'arbitrum',
          },
          preferences: {
            ranking_preset: args.ranking_preset as 'default' | 'reliability' | 'speed' | 'budget' | 'balanced',
            limit: args.limit,
            include_fallbacks: true,
          },
        });

    // Cache endpoints for later use with call_paid_api
    for (const ep of result.ranked_endpoints) {
      endpointCache.set(ep.endpoint_id, ep);
    }
    if (result.fallback_endpoints) {
      for (const ep of result.fallback_endpoints) {
        endpointCache.set(ep.endpoint_id, ep);
      }
    }

    // Format response for the model
    const endpoints = result.ranked_endpoints.map((ep) => formatEndpoint(ep));
    const fallbacks = result.fallback_endpoints?.map((ep) => ({
      ...formatEndpoint(ep),
      exclusion_reasons: ep.exclusion_reasons,
    }));

    const response = {
      capability: result.resolved.capability_id,
      confidence: result.resolved.confidence,
      candidates: result.resolved.candidates,
      endpoints,
      fallbacks: fallbacks?.length ? fallbacks : undefined,
      ranking: result.ranking_info,
      ttl_seconds: result.ttl_seconds,
      payment_enabled: paymentConfigured,
      usage_hint: endpoints.length > 0
        ? `Use call_paid_api with endpoint_id "${endpoints[0]!.endpoint_id}" to call the top result.`
        : 'No endpoints found. Try broadening your search or using a fallback.',
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Discovery failed';
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
      isError: true,
    };
  }
}

async function handleListCapabilities(args: { tag?: string; search?: string }) {
  try {
    const result = await client.listCapabilities({
      tag: args.tag,
      search: args.search,
    });

    const capabilities = result.capabilities.map((cap) => ({
      id: cap.id,
      title: cap.title,
      description: cap.description,
      tags: cap.tags,
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              version: result.version,
              count: capabilities.length,
              capabilities,
              usage_hint: 'Use discover_paid_api with a capability_id to find endpoints.',
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list capabilities';
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
      isError: true,
    };
  }
}

async function handleCallApi(args: {
  endpoint_id: string;
  method?: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  query_params?: Record<string, string>;
}) {
  const endpoint = endpointCache.get(args.endpoint_id);

  if (!endpoint) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'Endpoint not found in cache. Use discover_paid_api first to find endpoints.',
            hint: 'The endpoint_id must come from a recent discover_paid_api result.',
          }),
        },
      ],
      isError: true,
    };
  }

  try {
    const method = args.method || endpoint.method;
    let requestBody = args.body;
    const effectiveEndpoint = { ...endpoint };

    if (args.query_params && Object.keys(args.query_params).length > 0) {
      if (method === 'GET') {
        // For GET, merge into body so SDK's buildRequestUrl appends them as query params
        requestBody = { ...requestBody, ...args.query_params };
      } else {
        // For non-GET, append query params to URL directly
        const params = new URLSearchParams(args.query_params);
        effectiveEndpoint.url += (effectiveEndpoint.url.includes('?') ? '&' : '?') + params.toString();
      }
    }

    // Use SDK's callEndpoint which handles x402 v2 payments automatically
    const result = await client.callEndpoint(effectiveEndpoint, {
      buildRequest: (ep) => ({
        method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...args.headers,
        },
        body: args.body ? JSON.stringify(args.body) : undefined,
      }),
      body: requestBody,
      timeout: 30000,
      autoPay: paymentConfigured,
    });

    const response: Record<string, unknown> = {
      status: result.status,
      data: result.data,
      latency_ms: result.latencyMs,
      endpoint: {
        url: endpoint.url,
        provider: endpoint.provider_name,
      },
    };

    // Include payment receipt if payment was made
    if (result.payment) {
      response.payment = {
        amount: result.payment.amount,
        asset: result.payment.asset,
        network: result.payment.network,
        recipient: result.payment.recipient,
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  } catch (error) {
    // Handle payment-specific errors with helpful messages
    if (error instanceof PaymentRequiredError) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 402,
              message: 'Payment required but no wallet configured',
              payment_info: {
                payTo: error.paymentChallenge.payTo,
                amount: error.paymentChallenge.maxAmountRequired,
                network: error.paymentChallenge.network,
                asset: error.paymentChallenge.asset,
                endpoint_price: endpoint.payment.price_per_call,
              },
              hint: 'Set EVM_PRIVATE_KEY environment variable to enable automatic payments.',
            }),
          },
        ],
        isError: true,
      };
    }

    if (error instanceof PaymentExceedsLimitError) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 402,
              message: `Payment of $${error.requestedAmount.toFixed(4)} exceeds limit of $${error.maxAllowed.toFixed(2)}`,
              hint: 'Increase MAX_PAYMENT_PER_REQUEST or choose a cheaper endpoint.',
            }),
          },
        ],
        isError: true,
      };
    }

    const message = error instanceof Error ? error.message : 'API call failed';

    // Report failure
    client.reportOutcome({
      endpoint_id: endpoint.endpoint_id,
      success: false,
      error_code: 'call_failed',
    }).catch(() => {});

    return {
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
      isError: true,
    };
  }
}

function formatEndpoint(ep: RankedEndpoint) {
  return {
    endpoint_id: ep.endpoint_id,
    url: ep.url,
    method: ep.method,
    provider: ep.provider_name,
    price: `$${ep.payment.price_per_call}`,
    payment: {
      assets: ep.payment.accepted_assets,
      network: ep.payment.network,
    },
    metrics: {
      success_rate: ep.observed.success_rate_7d
        ? `${(ep.observed.success_rate_7d * 100).toFixed(1)}%`
        : 'unknown',
      latency: ep.observed.p95_latency_ms
        ? `${ep.observed.p95_latency_ms}ms p95`
        : 'unknown',
      last_verified: ep.observed.last_verified_at || 'never',
    },
    score: ep.score?.toFixed(3),
  };
}

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('EntRoute MCP server running on stdio');
  console.error('API URL: https://api.entroute.com');
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
