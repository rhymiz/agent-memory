import { z } from "zod";
import { identifier } from "./contracts";
import { AppError } from "./errors";

export const accessLevel = z.enum(["read", "write"]);
export type AccessLevel = z.infer<typeof accessLevel>;
export const grant = z.strictObject({
  projects: z.union([z.literal("all"), z.array(identifier).min(1).max(100)]),
  access: accessLevel,
});
export type Grant = z.infer<typeof grant>;

// The projects and operations one caller may use. The daemon serves trusted
// local processes with full access; the hosted service derives access from the
// authenticated key. Client-supplied projectId and agentId never grant access.
export class ProjectAccess {
  static readonly full = new ProjectAccess({
    projects: "all",
    access: "write",
  });
  constructor(private readonly grant: Grant) {}
  get projects(): "all" | readonly string[] {
    return this.grant.projects;
  }
  allows(projectId: string): boolean {
    return (
      this.grant.projects === "all" || this.grant.projects.includes(projectId)
    );
  }
  require(projectId: string, level: AccessLevel): void {
    if (!this.allows(projectId))
      throw new AppError(
        "FORBIDDEN",
        "This credential does not grant access to the project.",
        403,
        { projectId },
      );
    if (level === "write" && this.grant.access === "read")
      throw new AppError(
        "FORBIDDEN",
        "This credential grants read-only access.",
        403,
        { projectId },
      );
  }
}
