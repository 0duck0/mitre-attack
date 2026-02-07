import { createInterface } from "node:readline";
import { resolve as resolvePath } from "node:path";
import { loadConfig } from "./config.js";
import { AttackStore } from "./store/attackStore.js";
import { loadEmbeddings } from "./store/embeddingsStore.js";
import type { JsonRpcRequest, JsonRpcResponse, McpTool, McpToolCall, McpToolResult } from "./mcp/protocol.js";
import {
  lookupAttackId,
  searchAttack,
  getAttack,
  annotateReport,
  updateAttackFromTaxii,
  importAttackFile
} from "./tools/index.js";
import { createEmbeddingProvider } from "./matching/provider.js";

const config = loadConfig(process.env.ATTACK_MCP_CONFIG);
type Domain = "enterprise" | "mobile" | "ics";

const embeddingProvider = createEmbeddingProvider(config);

const domainState = new Map<Domain, { store: AttackStore; embeddings: Map<string, number[]> }>();

function resolveDomainDataDir(domain: Domain): string {
  return resolvePath(config.dataDir, domain);
}

function ensureDomainState(domain: Domain): { store: AttackStore; embeddings: Map<string, number[]> } {
  const existing = domainState.get(domain);
  if (existing) return existing;

  const dataDir = resolveDomainDataDir(domain);
  const store = new AttackStore(dataDir);
  store.load();
  const embeddings = loadEmbeddings(dataDir).vectors;

  const state = { store, embeddings };
  domainState.set(domain, state);
  return state;
}

function refreshDomain(domain: Domain): void {
  const state = ensureDomainState(domain);
  state.store.load();
  const latest = loadEmbeddings(resolveDomainDataDir(domain)).vectors;
  state.embeddings.clear();
  for (const [id, vector] of latest.entries()) {
    state.embeddings.set(id, vector);
  }
}

function parseDomains(args?: Record<string, unknown>): Domain[] {
  const single = args?.domain;
  const multiple = args?.domains;
  const valid: Domain[] = ["enterprise", "mobile", "ics"];

  if (Array.isArray(multiple)) {
    return multiple.filter((item): item is Domain => typeof item === "string" && valid.includes(item as Domain));
  }

  if (typeof single === "string" && valid.includes(single as Domain)) {
    return [single as Domain];
  }

  return ["enterprise"];
}

const tools: McpTool[] = [
  {
    name: "lookup_attack_id",
    description: "Find ATT&CK technique IDs for a behavior description.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        topN: { type: "number" },
        domain: { type: "string", enum: ["enterprise", "mobile", "ics"] },
        domains: {
          type: "array",
          items: { type: "string", enum: ["enterprise", "mobile", "ics"] }
        }
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
        topN: { type: "number" },
        domain: { type: "string", enum: ["enterprise", "mobile", "ics"] },
        domains: {
          type: "array",
          items: { type: "string", enum: ["enterprise", "mobile", "ics"] }
        }
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
        id: { type: "string" },
        domain: { type: "string", enum: ["enterprise", "mobile", "ics"] },
        domains: {
          type: "array",
          items: { type: "string", enum: ["enterprise", "mobile", "ics"] }
        }
      },
      required: ["id"]
    }
  },
  {
    name: "update_attack_from_taxii",
    description: "Download the latest ATT&CK release from TAXII and rebuild data.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", enum: ["enterprise", "mobile", "ics"] },
        domains: {
          type: "array",
          items: { type: "string", enum: ["enterprise", "mobile", "ics"] }
        }
      }
    }
  },
  {
    name: "import_attack_file",
    description: "Import a local ATT&CK STIX/JSON file and rebuild data.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        domain: { type: "string", enum: ["enterprise", "mobile", "ics"] }
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
        topN: { type: "number" },
        domain: { type: "string", enum: ["enterprise", "mobile", "ics"] },
        domains: {
          type: "array",
          items: { type: "string", enum: ["enterprise", "mobile", "ics"] }
        }
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
  const domains = parseDomains(call.arguments);

  switch (call.name) {
    case "lookup_attack_id":
      {
        const text = String(call.arguments?.text ?? "");
        const results: Array<Awaited<ReturnType<typeof lookupAttackId>>> = [];

        for (const domain of domains) {
          const state = ensureDomainState(domain);
          results.push(
            await lookupAttackId({
              text,
              topN,
              store: state.store,
              embeddings: state.embeddings,
              embeddingProvider,
              config,
              domain
            })
          );
        }

        const merged = results.flatMap((res) => res.data ?? []);
        merged.sort((a, b) => b.confidence - a.confidence);
        const data = merged.slice(0, topN);

        return asToolResult({
          status: results.some((res) => res.status === "warning") ? "warning" : "ok",
          message: data.length ? "ok" : "No matches above threshold.",
          data
        });
      }
    case "search_attack":
      {
        const text = String(call.arguments?.text ?? "");
        const results: Array<Awaited<ReturnType<typeof searchAttack>>> = [];

        for (const domain of domains) {
          const state = ensureDomainState(domain);
          results.push(
            await searchAttack({
              text,
              topN,
              store: state.store,
              embeddings: state.embeddings,
              embeddingProvider,
              config,
              domain
            })
          );
        }

        const merged = results.flatMap((res) => res.data ?? []);
        merged.sort((a, b) => b.confidence - a.confidence);
        const data = merged.slice(0, topN);

        return asToolResult({
          status: results.some((res) => res.status === "warning") ? "warning" : "ok",
          message: data.length ? "ok" : "No matches above threshold.",
          data
        });
      }
    case "get_attack":
      {
        const id = String(call.arguments?.id ?? "");
        const matches: Array<{ domain: Domain; result: ReturnType<typeof getAttack> }> = [];

        for (const domain of domains) {
          const state = ensureDomainState(domain);
          const result = getAttack({ id, store: state.store });
          if (result.status === "ok") {
            matches.push({ domain, result });
          }
        }

        if (matches.length === 0) {
          return asToolResult({ status: "error", message: `Technique not found: ${id}` });
        }

        if (matches.length > 1) {
          return asToolResult({
            status: "warning",
            message: `Technique found in multiple domains: ${matches.map((m) => m.domain).join(", ")}`,
            data: matches.map((match) => ({
              domain: match.domain,
              ...(match.result.data as Record<string, unknown>)
            }))
          });
        }

        return asToolResult({ status: "ok", message: "ok", data: matches[0].result.data });
      }
    case "update_attack_from_taxii":
      {
        const results: Array<{ domain: Domain; result: Awaited<ReturnType<typeof updateAttackFromTaxii>> }> = [];
        for (const domain of domains) {
          const result = await updateAttackFromTaxii({
            dataDir: config.dataDir,
            embeddingProvider,
            embeddingModel: config.embeddingModel,
            domain
          });
          results.push({ domain, result });
          if (result.status === "ok" || result.status === "warning") {
            refreshDomain(domain);
          }
        }

        if (results.length === 1) {
          return asToolResult(results[0].result);
        }

        return asToolResult({
          status: results.some((item) => item.result.status === "warning") ? "warning" : "ok",
          message: "Update completed.",
          data: results.map((item) => ({ domain: item.domain, ...item.result }))
        });
      }
    case "import_attack_file":
      {
        const result = await importAttackFile({
          path: String(call.arguments?.path ?? ""),
          dataDir: config.dataDir,
          embeddingProvider,
          embeddingModel: config.embeddingModel,
          domain: call.arguments?.domain as "enterprise" | "mobile" | "ics" | undefined
        });
        if (result.status === "ok") {
          const domain = (call.arguments?.domain as Domain | undefined) ?? "enterprise";
          refreshDomain(domain);
        }
        return asToolResult(result);
      }
    case "annotate_report":
      {
        const text = String(call.arguments?.text ?? "");
        const results: Array<Awaited<ReturnType<typeof annotateReport>>> = [];

        for (const domain of domains) {
          const state = ensureDomainState(domain);
          results.push(
            await annotateReport({
              text,
              topN,
              store: state.store,
              embeddings: state.embeddings,
              embeddingProvider,
              config,
              domain
            })
          );
        }

        if (results.length === 1) {
          return asToolResult(results[0]);
        }

        const merged = results.reduce((acc, current) => {
          const chunks = current.data ?? [];
          chunks.forEach((chunk, index) => {
            const target = acc[index];
            if (!target) {
              acc[index] = { ...chunk };
              return;
            }

            const mergedMatches = [...target.matches, ...chunk.matches];
            mergedMatches.sort((a, b) => b.confidence - a.confidence);
            target.matches = mergedMatches.slice(0, topN);
          });
          return acc;
        }, [] as Array<{ chunk: string; startOffset: number; endOffset: number; matches: Array<{ confidence: number }> }>);

        return asToolResult({
          status: "ok",
          message: "ok",
          data: merged
        });
      }
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

  rl.on("line", (line: string) => {
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
