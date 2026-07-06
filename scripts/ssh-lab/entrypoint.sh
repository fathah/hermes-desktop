#!/bin/sh
set -eu

if [ ! -s /lab/authorized_keys ]; then
  echo "Missing /lab/authorized_keys" >&2
  exit 1
fi

cp /lab/authorized_keys /home/hermes/.ssh/authorized_keys
chown -R hermes:hermes /home/hermes/.ssh
chmod 600 /home/hermes/.ssh/authorized_keys

cat >/etc/ssh/sshd_config <<'EOF'
Port 22
ListenAddress 0.0.0.0
PasswordAuthentication no
PubkeyAuthentication yes
PermitRootLogin no
AllowUsers hermes
AllowTcpForwarding yes
PermitOpen any
GatewayPorts no
X11Forwarding no
PrintMotd no
Subsystem sftp internal-sftp
EOF

socat TCP-LISTEN:8642,bind=127.0.0.1,fork,reuseaddr TCP:proxy:8080 &

exec /usr/sbin/sshd -D -e
