import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const transport = new StdioClientTransport({ command: "node", args: ["server.mjs"],
  env: { ...process.env, LOGBOOK_NO_CACHE: "1", LOGBOOK_WINDOW: "500" } });
const client = new Client({ name: "psmoke", version: "0" });
await client.connect(transport);
let pings = 0;
const repo = process.env.HOME + "/fleet-clones/pallets__flask";
const t0 = Date.now();
try {
  const r = await client.callTool(
    { name: "logbook_query", arguments: { repo, revert: true } },
    undefined,
    { onprogress: () => { pings++; }, timeout: 120000, resetTimeoutOnProgress: true }
  );
  console.log("isError:", r.isError ?? false, "| first 160:", JSON.stringify(r.content?.[0]?.text)?.slice(0, 160));
} catch (e) {
  console.log("CALL THREW:", String(e.message).slice(0, 200));
}
process.exitCode = pings >= 2 ? 0 : 1;
console.log(`pings: ${pings} · ${Date.now() - t0}ms`);

process.exit(process.exitCode ?? 1);
