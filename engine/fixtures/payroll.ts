#!/usr/bin/env node
/**
 * payroll fixture MCP server.
 *
 * Transport: stdio. Sensitivity: private, trusted.
 * `get_salaries` returns 214 private monthly payroll rows that must never reach
 * a public sink or the model's context. `call_log` exposes the recorded calls
 * so Seam A tests can inspect what the server actually received.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const ROW_COUNT = 214;
const callLog: { tool: string; args: unknown }[] = [];

/** Deterministic payroll rows so tests can assert exact totals (no randomness). */
function salariesFor(month: string): { name: string; gross: number }[] {
  const seed = [...month].reduce((s, c) => s + c.charCodeAt(0), 0);
  return Array.from({ length: ROW_COUNT }, (_, i) => ({
    name: `Employee ${i + 1}`,
    gross: 6000 + ((seed + i * 137) % 4000),
  }));
}

const server = new McpServer({ name: 'payroll', version: '1.0.0' });

server.registerTool(
  'get_salaries',
  {
    title: 'Get salaries',
    description: 'Return the private payroll rows for a given month (YYYY-MM).',
    inputSchema: { month: z.string() },
  },
  async ({ month }) => {
    callLog.push({ tool: 'get_salaries', args: { month } });
    return { content: [{ type: 'text', text: JSON.stringify(salariesFor(month)) }] };
  },
);

server.registerTool(
  'call_log',
  {
    title: 'Call log',
    description: 'Return every call this server received (for inspection and tests).',
    inputSchema: {},
  },
  async () => ({ content: [{ type: 'text', text: JSON.stringify(callLog) }] }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
