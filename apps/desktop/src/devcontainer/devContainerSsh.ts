/** What `devcontainer up` reports on its last stdout line. */
export type DevContainerUpResult =
  | {
      readonly outcome: "success";
      readonly containerId: string;
      readonly remoteUser: string;
      readonly remoteWorkspaceFolder: string;
    }
  | { readonly outcome: "error"; readonly message: string };

export function parseDevContainerUpOutput(stdout: string): DevContainerUpResult | null {
  const lines = stdout.split("\n").map((line) => line.trim());
  for (const line of lines.toReversed()) {
    if (!line.startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || !("outcome" in parsed)) continue;
    const record = parsed as Record<string, unknown>;
    if (record.outcome === "success") {
      const { containerId, remoteUser, remoteWorkspaceFolder } = record;
      if (typeof containerId !== "string" || typeof remoteWorkspaceFolder !== "string") return null;
      return {
        outcome: "success",
        containerId,
        // The CLI omits remoteUser when the image runs as root.
        remoteUser: typeof remoteUser === "string" && remoteUser !== "" ? remoteUser : "root",
        remoteWorkspaceFolder,
      };
    }
    const message = [record.message, record.description]
      .filter((part): part is string => typeof part === "string" && part.trim() !== "")
      .join(": ");
    return { outcome: "error", message: message || "The dev container did not start." };
  }
  return null;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Stable per folder, so reopening a project reuses its saved environment. */
export function devContainerAlias(workspaceFolder: string): string {
  const name =
    workspaceFolder
      .split(/[\\/]/)
      .findLast((part) => part !== "")
      ?.toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "project";
  return `t3-devcontainer-${name}-${fnv1a(workspaceFolder)}`;
}

function quoteSshConfigValue(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/**
 * ssh reaches the container through `docker exec`, so nothing listens on a port
 * and the container needs no network setup. Host keys change on every rebuild.
 */
export function buildDevContainerSshConfig(input: {
  readonly alias: string;
  readonly user: string;
  readonly identityFile: string;
  readonly docker: string;
  readonly containerId: string;
  readonly sshdPath: string;
  readonly nullDevice: string;
}): string {
  return [
    `Host ${input.alias}`,
    `  HostName ${input.alias}`,
    `  User ${input.user}`,
    `  IdentityFile ${quoteSshConfigValue(input.identityFile)}`,
    "  IdentitiesOnly yes",
    "  StrictHostKeyChecking no",
    `  UserKnownHostsFile ${input.nullDevice}`,
    "  LogLevel ERROR",
    `  ProxyCommand ${quoteSshConfigValue(input.docker)} exec -i -u root ${input.containerId} ${input.sshdPath} -i`,
    "",
  ].join("\n");
}

/** Prints the sshd path, installing openssh-server first when the image lacks it. */
export const ENSURE_SSHD_SCRIPT = `set -eu
find_sshd() {
  for candidate in /usr/sbin/sshd /usr/bin/sshd /sbin/sshd; do
    if [ -x "$candidate" ]; then printf '%s\\n' "$candidate"; return 0; fi
  done
  command -v sshd 2>/dev/null
}
if ! find_sshd >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update >&2
    apt-get install -y --no-install-recommends openssh-server >&2
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache openssh-server >&2
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y openssh-server >&2
  elif command -v microdnf >/dev/null 2>&1; then
    microdnf install -y openssh-server >&2
  elif command -v yum >/dev/null 2>&1; then
    yum install -y openssh-server >&2
  else
    echo "The container has no apt, apk, dnf or yum to install openssh-server." >&2
    exit 3
  fi
fi
SSHD="$(find_sshd || true)"
if [ -z "$SSHD" ]; then
  echo "openssh-server is installed but sshd was not found." >&2
  exit 3
fi
mkdir -p /run/sshd
ssh-keygen -A >&2
printf '%s\\n' "$SSHD"
`;

/** Runs as the container user with the public key in T3_DEVCONTAINER_KEY. */
export const AUTHORIZE_KEY_SCRIPT = `set -eu
umask 077
mkdir -p "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
grep -qxF "$T3_DEVCONTAINER_KEY" "$HOME/.ssh/authorized_keys" || printf '%s\\n' "$T3_DEVCONTAINER_KEY" >> "$HOME/.ssh/authorized_keys"
`;
