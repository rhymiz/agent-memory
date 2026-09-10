import { AppError } from "./errors";

export function normalizeResource(resource: string): string {
  const separator = resource.indexOf(":");
  const kind = resource.slice(0, separator).trim().toLowerCase();
  const value = resource.slice(separator + 1).trim();
  if (
    separator < 1 ||
    !/^[a-z][a-z0-9-]*$/.test(kind) ||
    !value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new AppError(
      "INVALID_REQUEST",
      "Resource must use kind:name with no control characters.",
    );
  }
  if (kind !== "file" && kind !== "directory") return `${kind}:${value}`;
  const path = value.replaceAll("\\", "/");
  if (path.startsWith("/") || /^[a-zA-Z]:/.test(path) || path.startsWith("~")) {
    throw new AppError(
      "INVALID_REQUEST",
      "File and directory resources must use project-relative paths.",
    );
  }
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length)
        throw new AppError(
          "INVALID_REQUEST",
          "Resource path must stay inside the project.",
        );
      segments.pop();
    } else segments.push(segment);
  }
  if (!segments.length)
    throw new AppError(
      "INVALID_REQUEST",
      "Resource must name a project-relative path.",
    );
  return `${kind}:${segments.join("/")}`;
}
