# MITRE ATT&CK MCP Server -- LM Studio Setup Guide

A step-by-step guide for setting up the MITRE ATT&CK MCP server in LM Studio. No prior coding experience required.

---

## What This Does

This server gives your AI model in LM Studio the ability to look up real cybersecurity attack techniques from the MITRE ATT&CK framework. Instead of the model guessing from memory, it can search an actual database of 800+ documented attack techniques and return accurate IDs, names, and descriptions.

---

## Prerequisites

Before you begin, you need two things installed on your Mac:

### 1. LM Studio

Download and install LM Studio from [lmstudio.ai](https://lmstudio.ai). This is the app that runs AI models locally on your computer.

### 2. Node.js

Node.js is what runs the MCP server. To check if you already have it:

1. Open **Terminal** (press `Cmd + Space`, type "Terminal", press Enter).
2. Type the following and press Enter:
   ```
   node --version
   ```
3. If you see a version number (e.g. `v20.12.0`), you're good. If you see "command not found", download Node.js from [nodejs.org](https://nodejs.org) -- choose the **LTS** version.

---

## Step 1: Open Terminal and Navigate to the Project

1. Open **Terminal** (press `Cmd + Space`, type "Terminal", press Enter).
2. Type the following command and press Enter:
   ```
   cd /Users/timduckworth/LLM_Automation/MCP-Servers/mitre_attack
   ```
   This tells Terminal to "go to" the project folder.

---

## Step 2: Install Dependencies

Still in Terminal, type the following and press Enter:

```
npm install
```

This downloads the small set of libraries the project needs. You should see some output scrolling by. Wait until it finishes and you see your command prompt again.

---

## Step 3: Create the Config File

Type the following and press Enter:

```
cp config/attack-mcp.example.json config/attack-mcp.json
```

This creates your personal configuration file from the included template. You don't need to edit anything in it for basic usage.

---

## Step 4: Build the Project

Type the following and press Enter:

```
npm run build
```

This compiles the source code into a runnable form. Wait for it to finish (you should see no errors).

---

## Step 5: Download the ATT&CK Data

The server needs a copy of the MITRE ATT&CK database. Type the following and press Enter:

```
curl -L -o /tmp/enterprise-attack.json https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json
```

This downloads the latest ATT&CK data (about 40 MB). Wait for it to finish.

Then import it by typing:

```
node dist/cli.js import --path /tmp/enterprise-attack.json --domain enterprise
```

You should see output like:

```
{
  "status": "ok",
  "message": "Imported 835 techniques. Embedded 0 techniques."
}
```

This means it worked. The "Embedded 0 techniques" part is normal -- it just means you're using basic matching mode, which works fine.

---

## Step 6: Test That It Works

Before connecting to LM Studio, verify the server works by running a test lookup:

```
node dist/cli.js lookup --text "PowerShell download cradle"
```

You should see results with technique IDs like `T1059.001` and confidence scores. If you see matches, everything is working correctly.

---

## Step 7: Add the MCP Server to LM Studio

This is where you tell LM Studio about the server.

1. Open **LM Studio**.
2. Click the **Developer** tab on the left sidebar (the `<>` icon).
3. In the top toolbar, look for the **MCP** dropdown or icon and click it to open the MCP server panel.
4. Click **Add** (or the `+` button) to add a new MCP server.
5. You should see a JSON configuration editor. Add the following entry inside the `"mcpServers"` section:

```json
{
  "mcpServers": {
    "mitre-attack": {
      "command": "node",
      "args": [
        "/Users/timduckworth/LLM_Automation/MCP-Servers/mitre_attack/dist/index.js"
      ],
      "env": {
        "ATTACK_MCP_CONFIG": "/Users/timduckworth/LLM_Automation/MCP-Servers/mitre_attack/config/attack-mcp.json"
      }
    }
  }
}
```

> **Note:** If you already have other MCP servers configured (like `cyber-threat-hunter`), just add the `"mitre-attack"` block alongside them, separated by a comma:
>
> ```json
> {
>   "mcpServers": {
>     "cyber-threat-hunter": {
>       "command": "node",
>       "args": [
>         "/Users/timduckworth/LLM_Automation/cyber-threat-hunter/mcp-server/build/index.js"
>       ]
>     },
>     "mitre-attack": {
>       "command": "node",
>       "args": [
>         "/Users/timduckworth/LLM_Automation/MCP-Servers/mitre_attack/dist/index.js"
>       ],
>       "env": {
>         "ATTACK_MCP_CONFIG": "/Users/timduckworth/LLM_Automation/MCP-Servers/mitre_attack/config/attack-mcp.json"
>       }
>     }
>   }
> }
> ```

6. Save the configuration.
7. Make sure the toggle next to `mitre-attack` is switched **on** (green). You should see a status indicator showing it's connected.

---

## Step 8: Set Up the System Prompt

A system prompt tells the AI model how to behave and when to use the MCP tools. Without it, the model may not know the tools exist.

1. In LM Studio, go to the **Chat** tab (the speech bubble icon on the left).
2. Look for the **System Prompt** text box at the top of the chat area. It may be collapsed -- click on "System Prompt" to expand it.
3. Paste the following into the System Prompt box:

```
You are a cybersecurity analyst with access to MITRE ATT&CK MCP tools.

Tool selection:
- annotate_report: Analyzes text against ATT&CK techniques. Returns technique IDs AND names for each paragraph. Send the COMPLETE user text as-is in the "text" parameter. The tool handles chunking internally.
- lookup_attack_id: Use for SHORT descriptions (1-3 sentences). Example: "credential dumping from LSASS memory".
- get_attack: Retrieves full details for a specific technique by ID.
- search_attack: Broad exploratory search for techniques related to a topic.

Workflow for annotating reports:
1. Call annotate_report ONCE with the full text. The response already includes technique IDs and names.
2. Reproduce the original text with [TXXXX] tags inline after relevant sentences.
3. Append a summary table: Technique ID | Name | Confidence.

Rules:
- NEVER invent technique IDs or names. Only use what the tool returned.
- Only tag sentences where the tool returned a match.
- Ignore low-confidence matches (confidence below 3.0).
- Pass topN as a number (e.g. 5), not a string.
```

4. Make sure you have a model loaded (click **Select a model to load** at the top and pick one -- models like `Qwen2.5-7B`, `Llama-3`, or `Mistral` work well).

---

## Step 9: Start Using It

You're all set. Try typing prompts like these in the chat:

- **"What ATT&CK technique involves stealing credentials from LSASS memory?"**
- **"Look up the ATT&CK ID for phishing with malicious attachments."**
- **"Get details on technique T1059.001."**
- **"Annotate this incident report with ATT&CK IDs:"** followed by pasting a report.

The model will call the MCP tools automatically and return technique IDs, names, and confidence scores.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| MCP server won't connect in LM Studio | Make sure Node.js is installed. Open Terminal and run `node --version` to check. |
| "No ATT&CK data loaded" error | You skipped Step 5. Go back and run the import command. |
| Lookup returns no matches | The confidence threshold may be too high. Open `config/attack-mcp.json` and change `"confidenceThreshold"` from `0.35` to `0.2`. |
| Model doesn't use the tools | Make sure the system prompt from Step 8 is set. Also verify the MCP server toggle is on (green) in LM Studio. |
| "Embedded 0 techniques" during import | This is normal. It means you're using rule-only matching. To enable embedding-based matching, you would need to load an embedding model in LM Studio and set `"embeddingEndpoint": "http://localhost:1234"` in your config file, then re-run the import. |

---

## Quick Reference: Available Tools

| Tool Name | What to Ask For |
|---|---|
| `lookup_attack_id` | "What ATT&CK technique is this behavior?" |
| `search_attack` | "Search for techniques related to ___" |
| `get_attack` | "Get details on T1059.001" |
| `annotate_report` | "Tag this report with ATT&CK IDs" |
| `update_attack_from_taxii` | "Update the ATT&CK database" |
| `import_attack_file` | "Import an ATT&CK data file from ___" |
