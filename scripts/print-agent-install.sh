#!/usr/bin/env bash
# Installs the BFK print agent as a system service on a small Linux box in the
# kitchen (Raspberry Pi OS, Ubuntu, Debian). Run once, as root, from a folder
# holding print-agent.mjs and a filled print-agent.env:
#
#   sudo bash print-agent-install.sh
#
# Afterwards the agent starts at boot and restarts on failure; nobody needs
# to log in. Logs: journalctl -u bfk-print-agent -f
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEST=/opt/bfk-print-agent
UNIT=/etc/systemd/system/bfk-print-agent.service

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo."; exit 1; }
[ -f "$HERE/print-agent.mjs" ] || { echo "print-agent.mjs not found next to this script."; exit 1; }
[ -f "$HERE/print-agent.env" ] || { echo "print-agent.env not found: copy print-agent.env.example, fill it in, then run again."; exit 1; }
grep -q 'PASTE_THE_SECRET_HERE\|bfk_sk_\.\.\.' "$HERE/print-agent.env" && { echo "print-agent.env still has a placeholder: fill in API_SECRET."; exit 1; }

# Node 18+ (Raspberry Pi OS and Debian ship older versions: install from NodeSource).
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  echo "Installing Node.js 22…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

mkdir -p "$DEST"
install -m 644 "$HERE/print-agent.mjs" "$DEST/print-agent.mjs"
install -m 600 "$HERE/print-agent.env" "$DEST/print-agent.env"

cat > "$UNIT" <<UNIT
[Unit]
Description=BFK print agent (kitchen receipt printer)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$(command -v node) $DEST/print-agent.mjs $DEST/print-agent.env
Restart=always
RestartSec=5
User=root
WorkingDirectory=$DEST

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now bfk-print-agent
sleep 2
systemctl --no-pager --lines=3 status bfk-print-agent || true
echo
echo "Done. The agent runs at every boot. Logs: journalctl -u bfk-print-agent -f"
