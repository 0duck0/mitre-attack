import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const ConfigSchema = z.object({
  dataDir: z.string().default("./data"),
  embeddingModel: z.string().default("bge-small-en"),
  embeddingEndpoint: z.string().default(""),
  topNDefault: z.number().int().min(1).max(20).default(5),
  confidenceThreshold: z.number().min(0).max(1).default(0.35),
  ruleWeight: z.number().min(0).max(1).default(0.35),
  embeddingWeight: z.number().min(0).max(1).default(0.65),
  maxChunkSize: z.number().int().min(200).max(5000).default(1200)
}).refine(
  (cfg) => Math.abs(cfg.ruleWeight + cfg.embeddingWeight - 1) < 1e-6,
  { message: "ruleWeight and embeddingWeight must sum to 1" }
);

export type AttackMcpConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(pathFromEnv?: string): AttackMcpConfig {
  const configPath = resolve(pathFromEnv ?? "./config/attack-mcp.json");
  if (!existsSync(configPath)) {
    return ConfigSchema.parse({});
  }

  const raw = readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return ConfigSchema.parse(parsed);
}
