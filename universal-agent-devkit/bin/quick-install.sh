#!/usr/bin/env bash
# quick-install.sh — One-liner Remote Bootstrapper for Universal Agent DevKit
# Usage: curl -fsSL https://.../bin/quick-install.sh | bash
set -euo pipefail

INSTALL_DIR="${HOME}/.universal-agent-devkit"
BIN_DIR="${HOME}/.local/bin"
REPO_URL="https://github.com/ToanMobile/universal-agent-devkit.git"

echo "================================================================="
echo "  🚀 Bootstrapping Universal Agent DevKit"
echo "================================================================="

# 1. Clone or update devkit
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "Updating existing DevKit at $INSTALL_DIR..."
  # Never `reset --hard`: local edits (also made through project symlinks) would be lost.
  if [ -n "$(git -C "$INSTALL_DIR" status --porcelain)" ]; then
    echo "⚠ $INSTALL_DIR has local changes — skipping update (commit/stash them, then re-run)." >&2
  else
    git -C "$INSTALL_DIR" pull --ff-only --quiet origin main \
      || echo "⚠ Could not fast-forward $INSTALL_DIR to origin/main — left as is." >&2
  fi
else
  echo "Cloning Universal Agent DevKit into $INSTALL_DIR..."
  if git ls-remote "$REPO_URL" > /dev/null 2>&1; then
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR" --quiet
  else
    # Offline fallback: an explicit local checkout (DEVKIT_LOCAL_SOURCE=/path/to/universal-agent-devkit)
    LOCAL_SOURCE="${DEVKIT_LOCAL_SOURCE:-}"
    if [ -n "$LOCAL_SOURCE" ] && [ -d "$LOCAL_SOURCE" ]; then
      cp -RL "$LOCAL_SOURCE" "$INSTALL_DIR"
    else
      echo "✖ Cannot reach $REPO_URL and DEVKIT_LOCAL_SOURCE is not set — nothing installed." >&2
      exit 1
    fi
  fi
fi

# 2. Link CLI to ~/.local/bin
mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/bin/agent-kit" "$BIN_DIR/agent-kit"
ln -sf "$INSTALL_DIR/bin/install.sh" "$BIN_DIR/agent-install"
ln -sf "$INSTALL_DIR/bin/profile" "$BIN_DIR/agent-profile"
ln -sf "$INSTALL_DIR/bin/agent-health.py" "$BIN_DIR/agent-health"
ln -sf "$INSTALL_DIR/bin/postfix-gate" "$BIN_DIR/postfix-gate"

# 3. Ensure PATH contains ~/.local/bin
export PATH="$BIN_DIR:$PATH"

echo "✓ 'agent-kit' successfully installed to $BIN_DIR/agent-kit"
echo "✓ 'agent-profile' successfully installed to $BIN_DIR/agent-profile"
echo "✓ 'agent-health' successfully installed to $BIN_DIR/agent-health"
echo "✓ 'postfix-gate' successfully installed to $BIN_DIR/postfix-gate"
echo

# 4. If current directory is a project, launch agent setup
if [ -d ".git" ] || [ -f "package.json" ] || [ -f "build.gradle" ] || [ -f "build.gradle.kts" ] || [ -f "pyproject.toml" ]; then
  echo "Detected active project in current directory: $PWD"
  if (exec 3</dev/tty) 2>/dev/null; then
    bash "$INSTALL_DIR/bin/install.sh" --target="$PWD" < /dev/tty
  else
    bash "$INSTALL_DIR/bin/install.sh" --target="$PWD"
  fi
fi

echo
echo "================================================================="
echo "  ✨ Setup Complete! You can now run 'agent-kit init' anywhere."
echo "================================================================="
