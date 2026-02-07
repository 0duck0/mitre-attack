# MITRE ATT&CK MCP

A local MCP server that helps LLMs identify behaviors by MITRE ATT&CK technique ID and keeps definitions current. It runs over stdio for LM Studio and supports both online TAXII updates and air‑gapped imports.

## Features
- Hybrid matching: rule prefilter + embedding re‑rank.
- `lookup_attack_id`, `search_attack`, `get_attack`, `annotate_report` tools.
- `update_attack_from_taxii` for online refresh.
- `import_attack_file` for air‑gapped systems.
- Local CLI for testing.

## Requirements
- Node.js 18+.
- Optional: an OpenAI‑compatible embeddings endpoint (LM Studio works).

## Quick Start
1. Install dependencies.
```
# from repo root
npm install
```

2. Copy the example config.
```
cp config/attack-mcp.example.json config/attack-mcp.json
```

3. (Optional) Point embeddings at LM Studio.
Edit `config/attack-mcp.json`:
```
{
  "embeddingEndpoint": "http://localhost:1234",
  "embeddingModel": "bge-small-en"
}
```

4. Build.
```
npm run build
```

## LM Studio Setup (MCP over stdio)
1. Add a new MCP server in LM Studio.
2. Set the command to run:
```
node /absolute/path/to/mitre_attack/dist/index.js
```
3. If you use a custom config location, set the env var:
```
ATTACK_MCP_CONFIG=/absolute/path/to/mitre_attack/config/attack-mcp.json
```
4. Save and connect.

## Air‑Gapped Import
1. Download the MITRE ATT&CK STIX 2.1 bundle on a connected system.
2. Transfer the file to the air‑gapped machine.
3. Run the import:
```
node dist/cli.js import --path /path/to/attack.json
```
This writes `data/enterprise/attack.json`, `data/enterprise/embeddings.jsonl`, and `data/enterprise/meta.json`.

## Online Update (TAXII)
```
node dist/cli.js update --domain enterprise
node dist/cli.js update --domains enterprise,mobile,ics
```
Domains: `enterprise` (default), `mobile`, `ics`.

## CLI Lookup
```
node dist/cli.js lookup --text "PowerShell download cradle"
node dist/cli.js lookup --file /path/to/report.txt
node dist/cli.js lookup --text "Credential dumping" --domains enterprise,ics
```

## MCP Tools
- `lookup_attack_id(text, topN?)` → best‑match technique IDs with confidence.
- `search_attack(text, topN?)` → broader candidate search.
- `get_attack(id)` → canonical technique data.
- `annotate_report(text, topN?)` → chunk and annotate a report.
- `update_attack_from_taxii(domain?, domains?)` → download latest ATT&CK STIX.
- `import_attack_file(path, domain?)` → ingest local STIX/JSON.

## Data Layout
- `data/<domain>/attack.json` – normalized techniques and tactics.
- `data/<domain>/embeddings.jsonl` – line‑delimited embedding vectors.
- `data/<domain>/meta.json` – source, version, timestamps.

## Notes
- If no embedding endpoint is configured, the MCP falls back to rule‑only matching.
- Embeddings are rebuilt on import/update.

## Troubleshooting
- If `lookup` returns no matches, lower `confidenceThreshold` in config.
- If embeddings fail, verify the endpoint supports OpenAI‑compatible `/v1/embeddings`.
