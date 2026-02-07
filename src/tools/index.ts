import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AttackStore } from "../store/attackStore.js";
import type { AttackMcpConfig } from "../config.js";
import type { EmbeddingProvider } from "../matching/embeddings.js";
import { hybridMatch } from "../matching/hybrid.js";

export type ToolResponse<T> = {
  status: "ok" | "warning" | "error";
  message: string;
  data?: T;
};

export type LookupResult = {
  id: string;
  confidence: number;
  ruleScore: number;
  embeddingScore: number;
  matchedTokens: string[];
};

export type AnnotatedChunk = {
  chunk: string;
  startOffset: number;
  endOffset: number;
  matches: LookupResult[];
};

type StixObject = {
  type?: string;
  id?: string;
  name?: string;
  description?: string;
  external_references?: Array<{ source_name?: string; external_id?: string; url?: string }>;
  kill_chain_phases?: Array<{ kill_chain_name?: string; phase_name?: string }>;
  x_mitre_aliases?: string[];
  x_mitre_platforms?: string[];
  x_mitre_detection?: string;
  x_mitre_version?: string;
};

export async function lookupAttackId(options: {
  text: string;
  topN: number;
  store: AttackStore;
  embeddings: Map<string, number[]>;
  embeddingProvider?: EmbeddingProvider;
  config: AttackMcpConfig;
}): Promise<ToolResponse<LookupResult[]>> {
  const { text, topN, store, embeddings, embeddingProvider, config } = options;
  const data = store.getData();

  if (data.techniques.length === 0) {
    return {
      status: "error",
      message: "No ATT&CK data loaded. Run update or import first."
    };
  }

  const matches = await hybridMatch({
    text,
    techniques: data.techniques,
    embeddings,
    embeddingProvider,
    limit: topN,
    ruleWeight: config.ruleWeight,
    embeddingWeight: config.embeddingWeight
  });

  const results = matches
    .filter((match) => match.score >= config.confidenceThreshold)
    .map((match) => ({
      id: match.id,
      confidence: match.score,
      ruleScore: match.ruleScore,
      embeddingScore: match.embeddingScore,
      matchedTokens: match.matchedTokens
    }));

  return {
    status: "ok",
    message: results.length ? "ok" : "No matches above threshold.",
    data: results
  };
}

export async function searchAttack(options: {
  text: string;
  topN: number;
  store: AttackStore;
  embeddings: Map<string, number[]>;
  embeddingProvider?: EmbeddingProvider;
  config: AttackMcpConfig;
}): Promise<ToolResponse<LookupResult[]>> {
  return lookupAttackId(options);
}

export function getAttack(options: { id: string; store: AttackStore }): ToolResponse<unknown> {
  const { id, store } = options;
  const technique = store.getTechniqueById(id);

  if (!technique) {
    return {
      status: "error",
      message: `Technique not found: ${id}`
    };
  }

  return {
    status: "ok",
    message: "ok",
    data: technique
  };
}

function chunkText(text: string, maxChunkSize: number): Array<{ chunk: string; start: number; end: number }> {
  const chunks: Array<{ chunk: string; start: number; end: number }> = [];
  const paragraphs = text.split(/\n\n+/g);
  let offset = 0;

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    const start = text.indexOf(paragraph, offset);
    const end = start + paragraph.length;
    offset = end;

    if (!trimmed) continue;

    if (trimmed.length <= maxChunkSize) {
      chunks.push({ chunk: trimmed, start, end });
      continue;
    }

    let cursor = 0;
    while (cursor < trimmed.length) {
      const slice = trimmed.slice(cursor, cursor + maxChunkSize);
      const sliceStart = start + cursor;
      const sliceEnd = sliceStart + slice.length;
      chunks.push({ chunk: slice, start: sliceStart, end: sliceEnd });
      cursor += maxChunkSize;
    }
  }

  return chunks;
}

export async function annotateReport(options: {
  text: string;
  topN: number;
  store: AttackStore;
  embeddings: Map<string, number[]>;
  embeddingProvider?: EmbeddingProvider;
  config: AttackMcpConfig;
}): Promise<ToolResponse<AnnotatedChunk[]>> {
  const { text, topN, store, embeddings, embeddingProvider, config } = options;

  const chunks = chunkText(text, config.maxChunkSize);
  const annotations: AnnotatedChunk[] = [];

  for (const chunk of chunks) {
    const matchResponse = await lookupAttackId({
      text: chunk.chunk,
      topN,
      store,
      embeddings,
      embeddingProvider,
      config
    });

    annotations.push({
      chunk: chunk.chunk,
      startOffset: chunk.start,
      endOffset: chunk.end,
      matches: matchResponse.data ?? []
    });
  }

  return {
    status: "ok",
    message: "ok",
    data: annotations
  };
}

export async function updateAttackFromTaxii(): Promise<ToolResponse<null>> {
  return {
    status: "error",
    message: "Not implemented: update from TAXII."
  };
}

export async function importAttackFile(options: {
  path?: string;
  dataDir: string;
}): Promise<ToolResponse<null>> {
  if (!options.path) {
    return { status: "error", message: "Missing required path." };
  }

  try {
    const raw = readFileSync(options.path, "utf8");
    const parsed = JSON.parse(raw) as { objects?: StixObject[] };

    const objects = parsed.objects ?? [];
    const techniques = objects
      .filter((obj) => obj.type === "attack-pattern")
      .map((obj) => {
        const externalId =
          obj.external_references?.find((ref) => ref.source_name === "mitre-attack")?.external_id ??
          obj.external_references?.find((ref) => ref.external_id)?.external_id ??
          obj.id ??
          "unknown";

        const tactics = (obj.kill_chain_phases ?? [])
          .filter((phase) => phase.kill_chain_name?.includes("mitre"))
          .map((phase) => phase.phase_name ?? "")
          .filter(Boolean);

        const references = (obj.external_references ?? [])
          .map((ref) => ref.url)
          .filter((url): url is string => Boolean(url));

        return {
          id: externalId,
          name: obj.name ?? "unknown",
          description: obj.description ?? "",
          tactics,
          platforms: obj.x_mitre_platforms ?? [],
          detection: obj.x_mitre_detection ?? "",
          references,
          aliases: obj.x_mitre_aliases ?? []
        };
      });

    const tactics = Array.from(
      new Set(
        objects
          .filter((obj) => obj.type === "x-mitre-tactic")
          .map((obj) => obj.name ?? "")
          .filter(Boolean)
      )
    );

    const dataDir = resolve(process.cwd(), options.dataDir);
    mkdirSync(dataDir, { recursive: true });

    writeFileSync(resolve(dataDir, "attack.json"), JSON.stringify({ techniques, tactics }, null, 2));
    writeFileSync(resolve(dataDir, "embeddings.jsonl"), JSON.stringify({ _meta: { model: "none" } }) + "\\n");
    writeFileSync(
      resolve(dataDir, "meta.json"),
      JSON.stringify(
        {
          source: options.path,
          importedAt: new Date().toISOString(),
          version:
            objects.find((obj) => obj.x_mitre_version)?.x_mitre_version ??
            "unknown"
        },
        null,
        2
      )
    );

    return { status: "ok", message: `Imported ${techniques.length} techniques.` };
  } catch (error) {
    return {
      status: "error",
      message: "Failed to import STIX bundle.",
      data: { error: (error as Error).message }
    };
  }
}
