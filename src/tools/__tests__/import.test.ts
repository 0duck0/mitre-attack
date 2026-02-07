import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { importAttackFile } from "../../tools/index.js";

const tempDir = join(process.cwd(), "tmp-test-data");

function cleanup(): void {
  rmSync(tempDir, { recursive: true, force: true });
}

test("importAttackFile normalizes STIX 2.1 bundle", async () => {
  cleanup();
  mkdirSync(tempDir, { recursive: true });

  const stix = {
    objects: [
      {
        type: "attack-pattern",
        name: "Command and Scripting Interpreter",
        description: "Adversaries may abuse command interpreters.",
        external_references: [{ source_name: "mitre-attack", external_id: "T1059" }],
        kill_chain_phases: [{ kill_chain_name: "mitre-attack", phase_name: "execution" }]
      },
      {
        type: "x-mitre-tactic",
        name: "Execution"
      }
    ]
  };

  const stixPath = join(tempDir, "attack.json");
  writeFileSync(stixPath, JSON.stringify(stix, null, 2));

  const result = await importAttackFile({
    path: stixPath,
    dataDir: tempDir,
    embeddingModel: "test",
    embeddingProvider: undefined
  });

  assert.equal(result.status, "warning");

  const attackRaw = readFileSync(join(tempDir, "attack.json"), "utf8");
  const attackData = JSON.parse(attackRaw) as { techniques: Array<{ id: string }>; tactics: string[] };

  assert.equal(attackData.techniques[0].id, "T1059");
  assert.deepEqual(attackData.tactics, ["Execution"]);

  cleanup();
});
