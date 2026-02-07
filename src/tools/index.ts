import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AttackStore } from "../store/attackStore.js";
import type { AttackMcpConfig } from "../config.js";
import type { EmbeddingProvider } from "../matching/embeddings.js";
import { hybridMatch } from "../matching/hybrid.js";
import { saveEmbeddings } from "../store/embeddingsStore.js";

export type ToolResponse<T> = {
  status: "ok" | "warning" | "error";
  message: string;
  data?: T;
};

export type LookupResult = {
  id: string;
  domain?: string;
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

function buildTechniqueText(technique: {
  name: string;
  description: string;
  tactics: string[];
  aliases?: string[];
  examples?: string[];
}): string {
  return [
    technique.name,
    technique.description,
    technique.tactics.join(", "),
    ...(technique.aliases ?? []),
    ...(technique.examples ?? [])
  ]
    .filter(Boolean)
    .join("\n");
}

async function rebuildEmbeddings(options: {
  techniques: Array<{
    id: string;
    name: string;
    description: string;
    tactics: string[];
    aliases?: string[];
    examples?: string[];
  }>;
  embeddingProvider?: EmbeddingProvider;
  dataDir: string;
  modelName: string;
}): Promise<{ status: "ok" | "warning"; message: string }> {
  if (!options.embeddingProvider) {
    saveEmbeddings({
      dataDir: options.dataDir,
      vectors: new Map(),
      meta: { model: "none", createdAt: new Date().toISOString() }
    });
    return { status: "warning", message: "No embedding endpoint configured. Skipped embedding rebuild." };
  }

  const vectors = new Map<string, number[]>();
  let dimensions: number | undefined;

  for (const technique of options.techniques) {
    const text = buildTechniqueText(technique);
    try {
      const vector = await options.embeddingProvider.embed(text);
      if (!dimensions) {
        dimensions = vector.length;
      }
      vectors.set(technique.id, vector);
    } catch {
      // Skip failed embeddings; keep partial progress.
    }
  }

  saveEmbeddings({
    dataDir: options.dataDir,
    vectors,
    meta: {
      model: options.modelName,
      dimensions,
      createdAt: new Date().toISOString()
    }
  });

  return { status: "ok", message: `Embedded ${vectors.size} techniques.` };
}

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

type NormalizedAttackData = {
  techniques: Array<{
    id: string;
    name: string;
    description: string;
    tactics: string[];
    platforms?: string[];
    detection?: string;
    references?: string[];
    aliases?: string[];
    examples?: string[];
  }>;
  tactics: string[];
  version?: string;
};

function normalizeStixObjects(objects: StixObject[]): NormalizedAttackData {
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

  const version = objects.find((obj) => obj.x_mitre_version)?.x_mitre_version;

  return { techniques, tactics, version };
}

export async function lookupAttackId(options: {
  text: string;
  topN: number;
  store: AttackStore;
  embeddings: Map<string, number[]>;
  embeddingProvider?: EmbeddingProvider;
  config: AttackMcpConfig;
  domain?: string;
}): Promise<ToolResponse<LookupResult[]>> {
  const { text, topN, store, embeddings, embeddingProvider, config, domain } = options;
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
      domain,
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
  domain?: string;
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
  domain?: string;
}): Promise<ToolResponse<AnnotatedChunk[]>> {
  const { text, topN, store, embeddings, embeddingProvider, config, domain } = options;

  const chunks = chunkText(text, config.maxChunkSize);
  const annotations: AnnotatedChunk[] = [];

  for (const chunk of chunks) {
    const matchResponse = await lookupAttackId({
      text: chunk.chunk,
      topN,
      store,
      embeddings,
      embeddingProvider,
      config,
      domain
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

const TAXII_BASE_URL = "https://attack-taxii.mitre.org/";

async function taxiiGet(url: string): Promise<unknown> {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/taxii+json;version=2.1" }
  });

  if (!response.ok) {
    throw new Error(`TAXII request failed: ${response.status}`);
  }

  return response.json();
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

async function discoverApiRoot(baseUrl: string): Promise<string> {
  const discoveryUrl = new URL("taxii2/", ensureTrailingSlash(baseUrl)).toString();
  const discovery = (await taxiiGet(discoveryUrl)) as {
    api_roots?: string[];
    default?: string;
  };

  const root = discovery.default ?? discovery.api_roots?.[0];
  if (!root) {
    throw new Error("No TAXII API roots discovered.");
  }

  return new URL(ensureTrailingSlash(root), ensureTrailingSlash(baseUrl)).toString();
}

async function findCollectionId(apiRoot: string, domain: "enterprise" | "mobile" | "ics"): Promise<string> {
  const collectionsUrl = new URL("collections/", ensureTrailingSlash(apiRoot)).toString();
  const payload = (await taxiiGet(collectionsUrl)) as {
    collections?: Array<{ id?: string; title?: string }>;
  };

  const titleMap: Record<"enterprise" | "mobile" | "ics", string> = {
    enterprise: "Enterprise ATT&CK",
    mobile: "Mobile ATT&CK",
    ics: "ICS ATT&CK"
  };

  const title = titleMap[domain];
  const collection = payload.collections?.find((item) => item.title?.includes(title));
  if (collection?.id) {
    return collection.id;
  }

  if (domain === "enterprise") {
    return "x-mitre-collection--1f5f1533-f617-4ca8-9ab4-6a02367fa019";
  }

  throw new Error(`No collection found for ${domain}.`);
}

async function fetchCollectionObjects(apiRoot: string, collectionId: string): Promise<StixObject[]> {
  const objects: StixObject[] = [];
  const baseUrl = new URL(`collections/${collectionId}/objects/`, ensureTrailingSlash(apiRoot));
  baseUrl.searchParams.set("limit", "1000");

  let next: string | undefined;
  let more = true;

  while (more) {
    const url = new URL(baseUrl.toString());
    if (next) {
      url.searchParams.set("next", next);
    }

    const payload = (await taxiiGet(url.toString())) as {
      objects?: StixObject[];
      more?: boolean;
      next?: string;
    };

    objects.push(...(payload.objects ?? []));
    more = Boolean(payload.more);
    next = payload.next;
    if (!more) break;
  }

  return objects;
}

export async function updateAttackFromTaxii(options: {
  dataDir: string;
  embeddingProvider?: EmbeddingProvider;
  embeddingModel: string;
  domain?: "enterprise" | "mobile" | "ics";
}): Promise<ToolResponse<null>> {
  try {
    const domain = options.domain ?? "enterprise";
    const apiRoot = await discoverApiRoot(TAXII_BASE_URL);
    const collectionId = await findCollectionId(apiRoot, domain);
    const objects = await fetchCollectionObjects(apiRoot, collectionId);

    const normalized = normalizeStixObjects(objects);
    const dataDir = resolve(process.cwd(), options.dataDir, domain);
    mkdirSync(dataDir, { recursive: true });

    writeFileSync(
      resolve(dataDir, "attack.json"),
      JSON.stringify({ techniques: normalized.techniques, tactics: normalized.tactics }, null, 2)
    );

    const embedResult = await rebuildEmbeddings({
      techniques: normalized.techniques,
      embeddingProvider: options.embeddingProvider,
      dataDir,
      modelName: options.embeddingModel
    });

    writeFileSync(
      resolve(dataDir, "meta.json"),
      JSON.stringify(
        {
          source: TAXII_BASE_URL,
          apiRoot,
          collectionId,
          domain,
          importedAt: new Date().toISOString(),
          version: normalized.version ?? "unknown"
        },
        null,
        2
      )
    );

    const status = embedResult.status === "warning" ? "warning" : "ok";
    return {
      status,
      message: `Updated ${normalized.techniques.length} techniques from TAXII. ${embedResult.message}`
    };
  } catch (error) {
    return {
      status: "error",
      message: "Failed to update from TAXII.",
      data: { error: (error as Error).message }
    };
  }
}

export async function importAttackFile(options: {
  path?: string;
  dataDir: string;
  embeddingProvider?: EmbeddingProvider;
  embeddingModel: string;
  domain?: "enterprise" | "mobile" | "ics";
}): Promise<ToolResponse<null>> {
  if (!options.path) {
    return { status: "error", message: "Missing required path." };
  }

  try {
    const raw = readFileSync(options.path, "utf8");
    const parsed = JSON.parse(raw) as { objects?: StixObject[] };

    const objects = parsed.objects ?? [];
    const normalized = normalizeStixObjects(objects);

    const domain = options.domain ?? "enterprise";
    const dataDir = resolve(process.cwd(), options.dataDir, domain);
    mkdirSync(dataDir, { recursive: true });

    writeFileSync(
      resolve(dataDir, "attack.json"),
      JSON.stringify({ techniques: normalized.techniques, tactics: normalized.tactics }, null, 2)
    );
    const embedResult = await rebuildEmbeddings({
      techniques: normalized.techniques,
      embeddingProvider: options.embeddingProvider,
      dataDir,
      modelName: options.embeddingModel
    });
    writeFileSync(
      resolve(dataDir, "meta.json"),
      JSON.stringify(
        {
          source: options.path,
          domain,
          importedAt: new Date().toISOString(),
          version: normalized.version ?? "unknown"
        },
        null,
        2
      )
    );

    const status = embedResult.status === "warning" ? "warning" : "ok";
    return {
      status,
      message: `Imported ${normalized.techniques.length} techniques. ${embedResult.message}`
    };
  } catch (error) {
    return {
      status: "error",
      message: "Failed to import STIX bundle.",
      data: { error: (error as Error).message }
    };
  }
}
