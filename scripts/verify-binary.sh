#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
case "$(uname -s)" in
  Darwin) exec bun run scripts/verify-binary.ts ;;
  Linux)
    command -v bwrap >/dev/null 2>&1 || {
      echo 'Install bubblewrap and curl to run the Linux offline packaging check.' >&2
      exit 1
    }
    # Keep the test client and daemon together on an isolated loopback network.
    exec bwrap --die-with-parent --unshare-net --bind / / \
      --dev-bind /dev /dev --proc /proc -- bun run scripts/verify-binary.ts ;;
  *) echo 'Offline packaging verification supports macOS and Linux.' >&2; exit 1 ;;
esac
