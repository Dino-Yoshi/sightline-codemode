#!/usr/bin/env node
/**
 * hr fixture MCP server.
 *
 * Transport: stdio. It is a private (HR-only) sink, so private payroll values
 * are allowed to reach it. Posted summaries are kept in memory and exposed via
 * `call_log` so Seam A tests can confirm what was received.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const callLog: { tool: string; args: unknown }[] = [];

const server = new McpServer({ name: 'hr', version: '1.0.0' });

server.registerTool(
  'post_summary',
  {
    title: 'Post summary',
    description: 'Record an HR-only summary (a private sink).',
    inputSchema: { text: z.string() },
  },
  async ({ text }) => {
    callLog.push({ tool: 'post_summary', args: { text } });
    return { content: [{ type: 'text', text: `stored (${callLog.length})` }] };
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
