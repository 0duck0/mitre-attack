# MITRE ATT&CK MCP Design

## Goals
- Help a local LLM identify behaviors by MITRE ATT&CK ID with higher accuracy.
- Keep ATT&CK definitions updated when new framework versions are released.
- Remain compatible with LM Studio via MCP over stdio.
- Support air-gapped use via local file import.

## Non-Goals
- Build a full CTI platform or SOC workflow.
- Replace analyst judgment or provide automated response actions.

## Approach Summary
Use a hybrid matching pipeline:
- Rule-based prefilter to shortlist candidate techniques.
- Embedding similarity to re-rank candidates for higher semantic accuracy.

Store canonical ATT&CK data as JSON files for simplicity and air-gap use. Cache embeddings locally. Expose a small set of MCP tools for lookup, updates, and optional report annotation.

## Architecture
**Server**: Node.js/TypeScript MCP server over stdio.

**Data**:
- `data/attack.json`: normalized canonical techniques, tactics, and relationships.
- `data/embeddings.json`: technique ID to vector map for the configured embedding model.
- `data/meta.json`: dataset version, source, import time, model name.

**Indices**:
- In-memory rule index built on startup (tokens, aliases, tactic/technique mappings).
- Optional in-memory embedding cache loaded from `embeddings.json`.

## Tooling (MCP)
- `lookup_attack_id(text: string, topN?: number)`
  - Returns Top-N techniques with confidence and rationale.
- `search_attack(text: string, topN?: number)`
  - Broader search variant that can include lower-confidence candidates.
- `get_attack(id: string)`
  - Returns canonical technique data (name, tactics, description, platforms, detection, mitigations).
- `update_attack_from_taxii()`
  - Downloads latest ATT&CK STIX, normalizes, rebuilds embeddings and indices.
- `import_attack_file(path: string)`
  - Ingests a local STIX/JSON file and rebuilds embeddings and indices.
- `annotate_report(text: string, topN?: number)`
  - Best-effort chunking + technique mapping per chunk; returns structured annotations.

All tools return a consistent envelope: `status`, `message`, and `data`.

## Hybrid Matching Flow
1. Tokenize and normalize input text.
2. Rule prefilter:
   - Keyword/alias matches against technique name, description, examples.
   - Tactic and platform hints.
   - Score and shortlist Top-N (e.g., 50).
3. Embedding re-rank:
   - Embed input text with configured model.
   - Compute cosine similarity with cached technique embeddings for the shortlist.
4. Return Top-N with confidence and rationale (matched tokens + top ATT&CK fields).

## Report Annotation Flow
`annotate_report(text)`:
- Split by headings, bullets, and paragraphs.
- For large chunks, split by sentence length to fit embedding limits.
- Run hybrid matching per chunk.
- Return chunk offsets, original text, matched technique IDs, confidence, and rationales.
- Do not rewrite the document; let the LLM render annotations.

## Updates and Air-Gapped Support
- Online: `update_attack_from_taxii()` pulls latest STIX and rebuilds local data.
- Air-gapped: `import_attack_file(path)` ingests local STIX/JSON.
- `meta.json` records the last successful version and source.

## Configuration
Single config file, e.g. `config/attack-mcp.json`:
- `dataDir`
- `embeddingModel` (default: BGE/E5 family)
- `embeddingEndpoint` (optional local inference server)
- `topNDefault`
- `confidenceThreshold`
- `ruleWeight`, `embeddingWeight`
- `maxChunkSize`

## Error Handling
- Never overwrite last-known-good data on failed import.
- If embeddings fail, fall back to rule-only matching with a warning.
- Return structured errors for invalid IDs and malformed inputs.
- Truncate oversized chunks and report truncation in `message`.

## Testing
- Unit tests for STIX normalization, rule scoring, and confidence thresholds.
- Golden-file tests for `attack.json` and `meta.json` outputs from known ATT&CK releases.
- Integration tests for both update methods and end-to-end matching.
- MCP stdio smoke test: one call per tool.

## Open Questions
- Exact STIX fields to normalize and expose in `get_attack`.
- Target embedding runtime (local model, local server, or LM Studio embeddings).
- Thresholds for “no match” vs low-confidence candidates.
