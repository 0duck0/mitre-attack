import { loadConfig } from "./config.js";
import { createEmbeddingProvider } from "./matching/provider.js";
import { importAttackFile, updateAttackFromTaxii } from "./tools/index.js";

type ParsedArgs = {
  command?: string;
  path?: string;
  domain?: "enterprise" | "mobile" | "ics";
  domains?: Array<"enterprise" | "mobile" | "ics">;
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
      default:
        break;
    }
  }

  return args;
}

function printUsage(): void {
  const text = [
    "Usage:",
    "  npm run data -- update [--domain enterprise|mobile|ics] [--domains enterprise,mobile,ics]",
    "  npm run data -- import --path <stix.json> [--domain enterprise|mobile|ics]"
  ].join("\n");

  process.stdout.write(`${text}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(process.env.ATTACK_MCP_CONFIG);
  const embeddingProvider = createEmbeddingProvider(config);

  switch (args.command) {
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
    default:
      printUsage();
      process.exitCode = 1;
  }
}

void main();
