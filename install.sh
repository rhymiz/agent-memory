#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Install the Linux agent-memory daemon from a GitHub release.

Usage: sh install.sh [--version VERSION] [--bin-dir DIRECTORY]

  --version VERSION    Release tag (v0.6.0 or 0.6.0); default: latest release
  --bin-dir DIRECTORY  Install memd here; default: $HOME/.local/bin
  -h, --help           Show this help

Requires Linux x64 or ARM64 with glibc, curl, and sha256sum.
Installs the binary only. Run memd to start the daemon.
EOF
}

fail() { printf 'agent-memory: %s\n' "$*" >&2; exit 1; }

main() {
  version=latest
  bin_dir=${HOME:?HOME must be set}/.local/bin
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version|--bin-dir)
        [ "$#" -ge 2 ] || fail "$1 requires a value"
        [ -n "$2" ] || fail "$1 requires a value"
        case "$1" in
          --version) version=$2 ;;
          --bin-dir) bin_dir=$2 ;;
        esac
        shift 2 ;;
      -h|--help) usage; return ;;
      *) fail "Unknown option: $1 (use --help)" ;;
    esac
  done

  [ "$(uname -s)" = Linux ] || fail "This installer supports Linux only."
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) fail "Unsupported architecture: $(uname -m)" ;;
  esac
  for command in curl sha256sum getconf awk mktemp chmod mv mkdir cp rm; do
    command -v "$command" >/dev/null 2>&1 || fail "Required command not found: $command"
  done
  getconf GNU_LIBC_VERSION >/dev/null 2>&1 || fail "glibc is required; musl/Alpine releases are not available."

  repository=https://github.com/rhymiz/agent-memory
  if [ "$version" = latest ]; then
    release_url=$(curl --fail --silent --show-error --location --retry 3 \
      --proto '=https' --proto-redir '=https' --output /dev/null --write-out '%{url_effective}' \
      "$repository/releases/latest") || fail "Could not resolve the latest release."
    case "$release_url" in
      "$repository"/releases/tag/*) version=${release_url##*/} ;;
      *) fail "Unexpected release URL: $release_url" ;;
    esac
  fi
  case "$version" in v*) ;; *) version=v$version ;; esac
  printf '%s\n' "$version" | LC_ALL=C awk '
    !/^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/ { invalid=1 }
    END { exit (NR != 1 || invalid) }
  ' || fail "Invalid release version: $version"

  asset=memd-linux-$arch
  download_url=$repository/releases/download/$version
  work_dir=$(mktemp -d)
  staged_binary=
  trap 'rm -rf -- "$work_dir"; if [ -n "$staged_binary" ]; then rm -f -- "$staged_binary"; fi' EXIT
  trap 'exit 1' HUP INT TERM
  printf 'Downloading agent-memory %s (%s)...\n' "$version" "$arch"
  curl --fail --silent --show-error --location --retry 3 \
    --proto '=https' --proto-redir '=https' \
    "$download_url/SHA256SUMS" --output "$work_dir/SHA256SUMS" || fail "Could not download release checksums."
  curl --fail --silent --show-error --location --retry 3 \
    --proto '=https' --proto-redir '=https' \
    "$download_url/$asset" --output "$work_dir/$asset" || fail "Could not download $asset."
  # Check exactly this asset, rejecting missing, duplicate or malformed entries.
  LC_ALL=C awk -v asset="$asset" '
    $2 == asset {
      if (NF != 2 || length($1) != 64 || $1 ~ /[^0-9a-fA-F]/) exit 1
      print $1 "  " asset
      count++
    }
    END { if (count != 1) exit 1 }
  ' "$work_dir/SHA256SUMS" > "$work_dir/checksum" || fail "Invalid checksum entry for $asset."
  (cd "$work_dir" && sha256sum --check checksum) || fail "Checksum verification failed. Existing installation was preserved."

  case "$bin_dir" in /*) ;; *) bin_dir=$PWD/$bin_dir ;; esac
  mkdir -p -- "$bin_dir"
  [ ! -d "$bin_dir/memd" ] || fail "$bin_dir/memd is a directory."
  # Stage on the destination filesystem so an upgrade uses one atomic rename.
  staged_binary=$(mktemp "$bin_dir/.memd.XXXXXX")
  cp -- "$work_dir/$asset" "$staged_binary"
  chmod 755 "$staged_binary"
  mv -f -- "$staged_binary" "$bin_dir/memd"
  staged_binary=
  printf 'Installed %s\nRun %s to start the daemon.\n' "$bin_dir/memd" "$bin_dir/memd"
  case ":${PATH:-}:" in
    *":$bin_dir:"*) ;;
    *) printf 'Add %s to your PATH to run memd by name.\n' "$bin_dir" ;;
  esac
}

main "$@"
