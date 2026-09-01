#!/usr/bin/env sh
set -eu

REPO="cniska/acolyte"

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  else
    sha256sum "$1" | cut -d ' ' -f 1
  fi
}

# `|` delimits the substitution below and `&` and `\` are replacement metacharacters, so a home
# directory holding any of them would corrupt the path written into the launcher rather than fail.
escape_replacement() {
  printf '%s' "$1" | sed -e 's/[\\|&]/\\&/g'
}

fetch_verified() {
  url="$1"
  sha_url="$2"
  dest="$3"

  curl -fsSL "$url" -o "$dest"
  curl -fsSL "$sha_url" -o "${dest}.sha256"

  expected="$(cut -d ' ' -f 1 "${dest}.sha256")"
  actual="$(sha256_of "$dest")"
  if [ "$expected" != "$actual" ]; then
    echo "Checksum mismatch for ${url}: expected ${expected}, got ${actual}" >&2
    exit 1
  fi
}

main() {
  if [ -z "${HOME:-}" ]; then
    echo "HOME is not set; cannot choose an install directory." >&2
    exit 1
  fi

  if ! command -v shasum >/dev/null 2>&1 && ! command -v sha256sum >/dev/null 2>&1; then
    echo "Neither shasum nor sha256sum is available; cannot verify the download." >&2
    exit 1
  fi

  platform="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$platform" in
    darwin) ;;
    linux) ;;
    *) echo "Unsupported platform: $platform" >&2; exit 1 ;;
  esac

  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
  esac

  case "${platform}-${arch}" in
    linux-x64|darwin-arm64) ;;
    *) echo "No prebuilt binary for ${platform}-${arch}. Build from source with Bun (see README)." >&2; exit 1 ;;
  esac

  INSTALL_DIR="${HOME}/.local/bin"
  LIB_DIR="${HOME}/.local/lib/acolyte"

  asset="acolyte-${platform}-${arch}.tar.gz"

  echo "Fetching latest release..."
  tag="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | cut -d '"' -f 4)"

  if [ -z "$tag" ]; then
    echo "Failed to fetch latest release" >&2
    exit 1
  fi

  version="${tag#v}"
  base_url="https://github.com/${REPO}/releases/download/${tag}"
  echo "Downloading ${tag} for ${platform}/${arch}..."

  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT

  fetch_verified "${base_url}/${asset}" "${base_url}/${asset%.tar.gz}.sha256" "${tmpdir}/${asset}"
  fetch_verified "${base_url}/launcher.sh" "${base_url}/launcher.sha256" "${tmpdir}/launcher.sh"

  tar xzf "${tmpdir}/${asset}" -C "$tmpdir"

  mkdir -p "$LIB_DIR"
  mv "${tmpdir}/acolyte" "${LIB_DIR}/acolyte"
  chmod +x "${LIB_DIR}/acolyte"

  sed -e "s|__BASELINE_BIN__|$(escape_replacement "${LIB_DIR}/acolyte")|" \
    -e "s|__BASELINE_VERSION__|$(escape_replacement "${version}")|" \
    "${tmpdir}/launcher.sh" > "${tmpdir}/launcher"
  mkdir -p "$INSTALL_DIR"
  chmod +x "${tmpdir}/launcher"
  mv "${tmpdir}/launcher" "${INSTALL_DIR}/acolyte"

  if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
    shell_config=""
    case "${SHELL:-}" in
      */zsh) shell_config="${HOME}/.zshrc" ;;
      */bash)
        if [ -f "${HOME}/.bashrc" ]; then
          shell_config="${HOME}/.bashrc"
        elif [ -f "${HOME}/.bash_profile" ]; then
          shell_config="${HOME}/.bash_profile"
        fi
        ;;
    esac

    if [ -n "$shell_config" ]; then
      if ! grep -q "${INSTALL_DIR}" "$shell_config" 2>/dev/null; then
        printf '\nexport PATH="%s:$PATH"\n' "$INSTALL_DIR" >> "$shell_config"
        echo "Added ${INSTALL_DIR} to PATH in ${shell_config}"
      fi
    else
      echo "Add ${INSTALL_DIR} to your PATH manually."
    fi
  fi

  echo ""
  echo "Acolyte ${tag} installed to ${LIB_DIR}/acolyte, launched from ${INSTALL_DIR}/acolyte"
  echo ""
  echo "Run 'acolyte auth' to get started."
}

main
