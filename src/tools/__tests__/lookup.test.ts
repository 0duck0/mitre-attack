import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { AttackStore } from "../../store/attackStore.js";
import { lookupAttackId } from "../../tools/index.js";
import { loadConfig } from "../../config.js";

const tempDir = join(process.cwd(), "tmp-test-data-lookup");

function cleanup(): void {
  rmSync(tempDir, { recursive: true, force: true });
}

test("lookupAttackId returns matches from rule prefilter", async () => {
  cleanup();
  mkdirSync(tempDir, { recursive: true });

  const data = {
    techniques: [
      {
        id: "T1059",
        name: "Command and Scripting Interpreter",
        description: "Adversaries may abuse command interpreters.",
        tactics: ["execution"],
        aliases: ["powershell"]
      }
    ],
    tactics: ["Execution"]
  };

  const dataDir = join(tempDir, "enterprise");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, "attack.json"), JSON.stringify(data, null, 2));

  const store = new AttackStore(dataDir);
  store.load();

  const config = loadConfig(undefined);
  const result = await lookupAttackId({
    text: "powershell download cradle",
    topN: 5,
    store,
    embeddings: new Map(),
    embeddingProvider: undefined,
    config
  });

  assert.equal(result.status, "ok");
  assert.ok(result.data?.length);
  assert.equal(result.data?.[0].id, "T1059");

  cleanup();
});
