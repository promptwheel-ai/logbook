// MCP fleet smoke: N repos through the real client; query count must match direct CLI.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";

const CL = process.env.HOME + "/fleet-clones";
const repos = readdirSync(CL).filter((d) => existsSync(`${CL}/${d}/events.jsonl`));
// deterministic sample of 25 + one known monster for timing
const pick = repos.filter((_, i) => i % Math.floor(repos.length / 24) === 0).slice(0, 24);
pick.push("qbittorrent__qBittorrent");

const transport = new StdioClientTransport({ command: "node", args: ["server.mjs"] });
const client = new Client({ name: "fleet-smoke", version: "0.0.1" });
await client.connect(transport);

let ok = 0, bad = 0, slowest = ["", 0];
for (const d of pick) {
  const repo = `${CL}/${d}`;
  const t0 = Date.now();
  try {
    const q = await client.callTool({ name: "logbook_query", arguments: { repo, revert: true, limit: 10000 } });
    const ms = Date.now() - t0;
    if (ms > slowest[1]) slowest = [d, ms];
    const text = q.content[0].text.trim();
    const mcpCount = text === "no matching events" ? 0 : text.split("\n").length;
    const cli = execFileSync("node", ["../bin/logbook.mjs", "query", repo, "--revert", "--limit", "10000"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const cliCount = cli ? cli.split("\n").length : 0;
    if (mcpCount === cliCount) ok++;
    else { bad++; console.log(`  MISMATCH ${d}: mcp=${mcpCount} cli=${cliCount}`); }
  } catch (e) { bad++; console.log(`  ERROR ${d}: ${String(e.message).slice(0, 60)}`); }
}
console.log(`MCP FLEET: ${ok}/${pick.length} consistent · slowest ${slowest[0]} ${slowest[1]}ms`);
process.exit(bad ? 1 : 0);
