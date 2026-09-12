# Project and execution identity

An explicit project ID in instructions takes precedence. Otherwise derive it
from the lowercase repository name in Git's origin, removing `.git`. Normalize
runs outside `a-z0-9._-` to `-` and remove leading punctuation.
For example, `git@github.com:rhymiz/agent-memory.git` becomes `agent-memory`.

Without an origin, use the primary checkout directory name. Resolve Git's common
directory to locate the primary checkout when in a worktree. Outside Git, use
the established project directory. Keep the ID stable across branches, worktrees,
and clients; use an explicit namespaced ID for distinct same-named repositories.

Generate one execution ID, retain it for resumed work, and never reuse another
agent's identity. Agent IDs are cooperative caller labels, not authentication.
