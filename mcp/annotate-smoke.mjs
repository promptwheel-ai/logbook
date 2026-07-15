import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

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
const subject = execFileSync("git", ["-C", repo, "show", "-s", "--format=%s", sha], { encoding: "utf8" }).trim();
const r1 = await client.callTool({ name: "logbook_annotate", params: {}, arguments: { repo, sha,
  why: "guard missed React Native where window exists but window.top does not",
  span: subject, side: "message", by: "smoke-model" } });
console.log("annotate:", r1.content[0].text);

const r2 = await client.callTool({ name: "logbook_digest", arguments: { repo } });
console.log("digest bytes:", Buffer.byteLength(r2.content[0].text));
console.log("local inert drafts:", readdirSync(join(repo, ".logbook", "drafts")).filter((f) => f.endsWith(".json")).length);

const bad = await client.callTool({ name: "logbook_annotate", arguments: {
  repo, sha: "deadbeef123", why: "x", span: "x", side: "message",
} });
console.log("bad sha isError:", bad.isError === true, "|", bad.content[0].text);
await client.close();
