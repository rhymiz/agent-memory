import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/server";
import type { Application } from "../application";
import { projectInput, type ProjectInput } from "../domain/contracts";
import { parseInput, publicError } from "../domain/errors";

export function registerResources(server: McpServer, app: Application): void {
  const views: { name: string; read: (input: ProjectInput) => unknown }[] = [
    { name: "context", read: (input) => app.context.get(input) },
    { name: "activity", read: (input) => app.activity.recent(input) },
    { name: "decisions", read: (input) => app.decisions.list(input) },
    { name: "claims", read: (input) => app.claims.list(input) },
  ];
  for (const view of views) {
    server.registerResource(
      `project-${view.name}`,
      new ResourceTemplate(`memory://projects/{projectId}/${view.name}`, {
        list: undefined,
      }),
      {
        mimeType: "application/json",
        description: `Project ${view.name}, from the shared application service.`,
      },
      (uri, variables) => {
        let data: unknown;
        try {
          data = view.read(
            parseInput(projectInput, { projectId: variables.projectId }),
          );
        } catch (error) {
          data = publicError(error).toJSON();
        }
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(data),
            },
          ],
        };
      },
    );
  }
}
