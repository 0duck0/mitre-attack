import { createInterface } from "node:readline";
import { loadConfig } from "./config.js";
import { AttackStore } from "./store/attackStore.js";
import type { JsonRpcRequest, JsonRpcResponse, McpTool, McpToolCall, McpToolResult } from "./mcp/protocol.js";
import {
  lookupAttackId,
  searchAttack,
  getAttack,
  annotateReport,
  updateAttackFromTaxii,
  importAttackFile
} from "./tools/index.js";

const config = loadConfig(process.env.ATTACK_MCP_CONFIG);
const store = new AttackStore(config.dataDir);
store.load();

const embeddings = new Map<string, number[]>();
const embeddingProvider = undefined;

const tools: McpTool[] = [
  {
    name: "lookup_attack_id",
    description: "Find ATT&CK technique IDs for a behavior description.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        topN: { type: "number" }
      },
      required: ["text"]
    }
  },
  {
    name: "search_attack",
    description: "Search ATT&CK techniques by description and return candidates.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        topN: { type: "number" }
      },
      required: ["text"]
    }
  },
  {
    name: "get_attack",
    description: "Fetch canonical ATT&CK technique data by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }
      },
      required: ["id"]
    }
  },
  {
    name: "update_attack_from_taxii",
    description: "Download the latest ATT&CK release from TAXII and rebuild data.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "import_attack_file",
    description: "Import a local ATT&CK STIX/JSON file and rebuild data.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" }
      },
      required: ["path"]
    }
  },
  {
    name: "annotate_report",
    description: "Chunk and annotate a report with candidate ATT&CK IDs.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        topN: { type: "number" }
      },
      required: ["text"]
    }
  }
];

function writeResponse(response: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function asToolResult(payload: unknown): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

async function handleToolCall(call: McpToolCall): Promise<McpToolResult> {
  const topN = typeof call.arguments?.topN === "number" ? call.arguments.topN : config.topNDefault;

  switch (call.name) {
    case "lookup_attack_id":
      return asToolResult(
        await lookupAttackId({
          text: String(call.arguments?.text ?? ""),
          topN,
          store,
          embeddings,
          embeddingProvider,
          config
        })
      );
    case "search_attack":
      return asToolResult(
        await searchAttack({
          text: String(call.arguments?.text ?? ""),
          topN,
          store,
          embeddings,
          embeddingProvider,
          config
        })
      );
    case "get_attack":
      return asToolResult(getAttack({ id: String(call.arguments?.id ?? ""), store }));
    case "update_attack_from_taxii":
      return asToolResult(await updateAttackFromTaxii());
    case "import_attack_file":
      {
        const result = await importAttackFile({
          path: String(call.arguments?.path ?? ""),
          dataDir: config.dataDir
        });
        if (result.status === "ok") {
          store.load();
        }
        return asToolResult(result);
      }
    case "annotate_report":
      return asToolResult(
        await annotateReport({
          text: String(call.arguments?.text ?? ""),
          topN,
          store,
          embeddings,
          embeddingProvider,
          config
        })
      );
    default:
      return asToolResult({ status: "error", message: `Unknown tool: ${call.name}` });
  }
}

async function handleRequest(request: JsonRpcRequest): Promise<void> {
  if (request.method === "initialize") {
    writeResponse({
      jsonrpc: "2.0",
      id: request.id ?? null,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "mitre-attack-mcp", version: "0.1.0" }
      }
    });
    return;
  }

  if (request.method === "tools/list") {
    writeResponse({
      jsonrpc: "2.0",
      id: request.id ?? null,
      result: { tools }
    });
    return;
  }

  if (request.method === "tools/call") {
    const params = request.params as { name?: string; arguments?: Record<string, unknown> };
    const result = await handleToolCall({
      name: String(params?.name ?? ""),
      arguments: params?.arguments
    });

    writeResponse({
      jsonrpc: "2.0",
      id: request.id ?? null,
      result
    });
    return;
  }

  if (request.id !== undefined) {
    writeResponse({
      jsonrpc: "2.0",
      id: request.id ?? null,
      error: { code: -32601, message: `Method not found: ${request.method}` }
    });
  }
}

function startServer(): void {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  rl.on("line", (line) => {
    if (!line.trim()) return;

    try {
      const request = JSON.parse(line) as JsonRpcRequest;
      void handleRequest(request);
    } catch (error) {
      const response: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: "Parse error",
          data: (error as Error).message
        }
      };
      writeResponse(response);
    }
  });
}

startServer();
