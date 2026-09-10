import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type { Application } from "../application";
import packageInfo from "../../package.json";
import { registerResources } from "./resources";
import { registerTools } from "./tools";

export function createMcpServer(app: Application): McpServer {
  const server = new McpServer(
    { name: "agent-memory", version: packageInfo.version },
    {
      supportedProtocolVersions: ["2026-07-28"],
      instructions:
        "Before significant project work: read context, recent activity and relevant memories; check and acquire claims. Renew claims during long work. Record reusable discoveries and explicit decisions. Record results and release claims when finished. Agent IDs identify callers but are not authentication.",
    },
  );
  registerTools(server, app);
  registerResources(server, app);
  return server;
}
export function createMcpHttpHandler(app: Application) {
  return createMcpHandler(() => createMcpServer(app), { legacy: "reject" });
}
