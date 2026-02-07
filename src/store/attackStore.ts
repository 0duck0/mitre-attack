import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export type AttackTechnique = {
  id: string;
  name: string;
  description: string;
  tactics: string[];
  platforms?: string[];
  detection?: string;
  mitigations?: string[];
  references?: string[];
  aliases?: string[];
  examples?: string[];
};

export type AttackData = {
  techniques: AttackTechnique[];
  tactics: string[];
  version?: string;
};

export class AttackStore {
  private data: AttackData | null = null;

  constructor(private readonly dataDir: string) {}

  load(): AttackData {
    const attackPath = resolve(this.dataDir, "attack.json");
    if (!existsSync(attackPath)) {
      this.data = { techniques: [], tactics: [] };
      return this.data;
    }

    const raw = readFileSync(attackPath, "utf8");
    this.data = JSON.parse(raw) as AttackData;
    return this.data;
  }

  getData(): AttackData {
    return this.data ?? this.load();
  }

  getTechniqueById(id: string): AttackTechnique | undefined {
    return this.getData().techniques.find((technique) => technique.id === id);
  }
}
