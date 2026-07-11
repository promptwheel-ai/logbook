// End-to-end MCP smoke test: real client ↔ real server over stdio,
// asking the experiment's exact question.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["server.mjs"] });
const client = new Client({ name: "smoke", version: "0.0.1" });
await client.connect(transport);

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

const repo = process.env.HOME + "/fleet-clones/expressjs__express";
const q = await client.callTool({ name: "logbook_query", arguments: { repo, file: "lib/response.js", revert: true } });
const rows = q.content[0].text.trim().split("\n");
console.log("query reverts:", rows.length, "(expect 5)");

const a = await client.callTool({ name: "logbook_audit", arguments: { repo } });
console.log("audit:", a.content[0].text.split("\n")[0]);

process.exit(rows.length === 5 ? 0 : 1);
