import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export type EmbeddingsMeta = {
  model: string;
  dimensions?: number;
  createdAt?: string;
};

export type EmbeddingsLoadResult = {
  meta: EmbeddingsMeta | null;
  vectors: Map<string, number[]>;
};

const EMBEDDINGS_FILE = "embeddings.jsonl";

export function loadEmbeddings(dataDir: string): EmbeddingsLoadResult {
  const embeddingsPath = resolve(dataDir, EMBEDDINGS_FILE);
  const vectors = new Map<string, number[]>();

  if (!existsSync(embeddingsPath)) {
    return { meta: null, vectors };
  }

  const raw = readFileSync(embeddingsPath, "utf8");
  const lines = raw.split(/\r?\n/).filter((line: string) => line.trim().length > 0);

  let meta: EmbeddingsMeta | null = null;

  for (const line of lines) {
    const parsed = JSON.parse(line) as {
      _meta?: EmbeddingsMeta;
      id?: string;
      vector?: number[];
    };

    if (parsed._meta) {
      meta = parsed._meta;
      continue;
    }

    if (parsed.id && Array.isArray(parsed.vector)) {
      vectors.set(parsed.id, parsed.vector);
    }
  }

  return { meta, vectors };
}

export function saveEmbeddings(options: {
  dataDir: string;
  vectors: Map<string, number[]>;
  meta: EmbeddingsMeta;
}): void {
  const embeddingsPath = resolve(options.dataDir, EMBEDDINGS_FILE);
  const lines: string[] = [];

  lines.push(JSON.stringify({ _meta: options.meta }));

  for (const [id, vector] of options.vectors.entries()) {
    lines.push(JSON.stringify({ id, vector }));
  }

  writeFileSync(embeddingsPath, lines.join("\n"));
}
