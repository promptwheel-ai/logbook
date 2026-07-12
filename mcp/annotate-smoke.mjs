import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";

const repo = process.argv[2];
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [new URL("./server.mjs", import.meta.url).pathname],
});
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

const tools = (await client.listTools()).tools.map((t) => t.name);
console.log("tools:", tools.join(", "));

const sha = execFileSync("git", ["-C", repo, "log", "--format=%H", "--grep=Revert"], { encoding: "utf8" }).trim().split("\n")[0];
const r1 = await client.callTool({ name: "logbook_annotate", params: {}, arguments: { repo, sha, why: "guard missed React Native where window exists but window.top does not", by: "smoke-model" } });
console.log("annotate:", r1.content[0].text);

const r2 = await client.callTool({ name: "logbook_digest", arguments: { repo } });
const hit = r2.content[0].text.split("\n").filter((l) => l.includes("why (inferred"));
console.log("digest why lines:", hit.length, "|", hit[0] || "NONE");

const bad = await client.callTool({ name: "logbook_annotate", arguments: { repo, sha: "deadbeef123", why: "x" } });
console.log("bad sha isError:", bad.isError === true, "|", bad.content[0].text);
await client.close();
