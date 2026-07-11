import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const transport = new StdioClientTransport({ command: "node", args: ["server.mjs"] });
const client = new Client({ name: "retime", version: "0" });
await client.connect(transport);
const repo = process.env.HOME + "/fleet-clones/qbittorrent__qBittorrent";
for (const label of ["cold", "warm", "warm2-audit"]) {
  const t0 = Date.now();
  const name = label === "warm2-audit" ? "logbook_audit" : "logbook_query";
  await client.callTool({ name, arguments: { repo, ...(name === "logbook_query" ? { revert: true } : {}) } });
  console.log(`${label}: ${Date.now() - t0}ms`);
}
process.exit(0);
