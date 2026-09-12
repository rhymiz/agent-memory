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
        "Shared project knowledge and cooperative leases. Retrieve task-relevant context; claim before shared edits. Agent IDs are not authentication.",
    },
  );
  registerTools(server, app);
  registerResources(server, app);
  return server;
}
export function createMcpHttpHandler(app: Application) {
  return createMcpHandler(() => createMcpServer(app), { legacy: "reject" });
}
