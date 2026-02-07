import type { AttackMcpConfig } from "../config.js";
import type { EmbeddingProvider, EmbeddingVector } from "./embeddings.js";

export function createEmbeddingProvider(config: AttackMcpConfig): EmbeddingProvider | undefined {
  if (!config.embeddingEndpoint) return undefined;

  return {
    async embed(text: string): Promise<EmbeddingVector> {
      const response = await fetch(config.embeddingEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: config.embeddingModel, input: text })
      });

      if (!response.ok) {
        throw new Error(`Embedding request failed: ${response.status}`);
      }

      const payload = (await response.json()) as {
        data?: Array<{ embedding?: number[] }>;
        embedding?: number[];
      };

      if (payload.embedding) {
        return payload.embedding;
      }

      const embedding = payload.data?.[0]?.embedding;
      if (!embedding) {
        throw new Error("Embedding response missing embedding vector.");
      }

      return embedding;
    }
  };
}
