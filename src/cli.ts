import { readFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import { AttackStore } from "./store/attackStore.js";
import { loadEmbeddings } from "./store/embeddingsStore.js";
import { createEmbeddingProvider } from "./matching/provider.js";
import { importAttackFile, updateAttackFromTaxii, lookupAttackId } from "./tools/index.js";

type ParsedArgs = {
  command?: string;
  path?: string;
  domain?: "enterprise" | "mobile" | "ics";
  domains?: Array<"enterprise" | "mobile" | "ics">;
  text?: string;
  file?: string;
  topN?: number;
};

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {};
  const [command, ...rest] = argv;
  args.command = command;

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    switch (token) {
      case "--path":
        args.path = rest[i + 1];
        i += 1;
        break;
      case "--domain":
        args.domain = rest[i + 1] as ParsedArgs["domain"];
        i += 1;
        break;
      case "--domains": {
        const value = rest[i + 1] ?? "";
        args.domains = value.split(",").map((item) => item.trim()) as ParsedArgs["domains"];
        i += 1;
        break;
      }
      case "--text":
        args.text = rest[i + 1];
        i += 1;
        break;
      case "--file":
        args.file = rest[i + 1];
        i += 1;
        break;
      case "--topN":
        args.topN = Number(rest[i + 1]);
        i += 1;
        break;
      default:
        break;
    }
  }

  return args;
}

function printUsage(): void {
  const text = [
    "Usage:",
    "  node dist/cli.js import --path <stix.json>",
    "  node dist/cli.js update [--domain enterprise|mobile|ics] [--domains enterprise,mobile,ics]",
    "  node dist/cli.js lookup --text <text> [--topN 5]",
    "  node dist/cli.js lookup --file <path> [--topN 5]",
    "  node dist/cli.js lookup --text <text> --domains enterprise,mobile"
  ].join("\n");

  process.stdout.write(`${text}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(process.env.ATTACK_MCP_CONFIG);
  const store = new AttackStore(config.dataDir);
  store.load();

  const embeddings = loadEmbeddings(config.dataDir).vectors;
  const embeddingProvider = createEmbeddingProvider(config);

  switch (args.command) {
    case "import": {
      if (!args.path) {
        printUsage();
        process.exitCode = 1;
        return;
      }

      const result = await importAttackFile({
        path: args.path,
        dataDir: config.dataDir,
        embeddingProvider,
        embeddingModel: config.embeddingModel,
        domain: args.domain
      });

      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    case "update": {
      const domains = args.domains && args.domains.length > 0 ? args.domains : [args.domain ?? "enterprise"];
      const results = [];

      for (const domain of domains) {
        const result = await updateAttackFromTaxii({
          dataDir: config.dataDir,
          embeddingProvider,
          embeddingModel: config.embeddingModel,
          domain
        });
        results.push({ domain, ...result });
      }

      process.stdout.write(`${JSON.stringify(results.length === 1 ? results[0] : results, null, 2)}\n`);
      return;
    }
    case "lookup": {
      let text = args.text ?? "";
      if (args.file) {
        text = readFileSync(args.file, "utf8");
      }

      if (!text) {
        printUsage();
        process.exitCode = 1;
        return;
      }

      const domains = args.domains && args.domains.length > 0 ? args.domains : [args.domain ?? "enterprise"];
      const results = [];

      for (const domain of domains) {
        const domainStore = new AttackStore(`${config.dataDir}/${domain}`);
        domainStore.load();
        const domainEmbeddings = loadEmbeddings(`${config.dataDir}/${domain}`).vectors;
        const result = await lookupAttackId({
          text,
          topN: args.topN ?? config.topNDefault,
          store: domainStore,
          embeddings: domainEmbeddings,
          embeddingProvider,
          config,
          domain
        });
        results.push({ domain, ...result });
      }

      process.stdout.write(`${JSON.stringify(results.length === 1 ? results[0] : results, null, 2)}\n`);
      return;
    }
    default:
      printUsage();
      process.exitCode = 1;
  }
}

void main();
