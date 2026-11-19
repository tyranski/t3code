import { describe, expect, it } from "vite-plus/test";

import {
  buildDevContainerSshConfig,
  devContainerAlias,
  parseDevContainerUpOutput,
} from "./devContainerSsh.ts";

describe("parseDevContainerUpOutput", () => {
  it.each([
    {
      name: "reads the result line after log output",
      stdout: [
        "[2026-11-19T10:00:00.000Z] Start: Run: docker build",
        '{"outcome":"success","containerId":"abc123","remoteUser":"vscode","remoteWorkspaceFolder":"/workspaces/app"}',
        "",
      ].join("\n"),
      expected: {
        outcome: "success",
        containerId: "abc123",
        remoteUser: "vscode",
        remoteWorkspaceFolder: "/workspaces/app",
      },
    },
    {
      name: "treats a missing remote user as root",
      stdout: '{"outcome":"success","containerId":"abc123","remoteWorkspaceFolder":"/work"}',
      expected: {
        outcome: "success",
        containerId: "abc123",
        remoteUser: "root",
        remoteWorkspaceFolder: "/work",
      },
    },
    {
      name: "joins the error message and description",
      stdout:
        '{"outcome":"error","message":"Command failed","description":"An error occurred building the image."}',
      expected: {
        outcome: "error",
        message: "Command failed: An error occurred building the image.",
      },
    },
    {
      name: "returns null without a result line",
      stdout: "Error: spawn docker ENOENT",
      expected: null,
    },
  ])("$name", ({ stdout, expected }) => {
    expect(parseDevContainerUpOutput(stdout)).toEqual(expected);
  });
});

describe("devContainerAlias", () => {
  it("is stable per folder and differs between folders with the same name", () => {
    const alias = devContainerAlias("/home/me/work/My App");
    expect(alias).toMatch(/^t3-devcontainer-my-app-[0-9a-f]{8}$/);
    expect(devContainerAlias("/home/me/work/My App")).toBe(alias);
    expect(devContainerAlias("/home/me/other/My App")).not.toBe(alias);
  });
});

describe("buildDevContainerSshConfig", () => {
  it("reaches sshd through docker exec and quotes paths with spaces", () => {
    expect(
      buildDevContainerSshConfig({
        alias: "t3-devcontainer-app-1234abcd",
        user: "vscode",
        identityFile: "/home/me/T3 State/devcontainers/id_ed25519",
        docker: "docker",
        containerId: "abc123",
        sshdPath: "/usr/sbin/sshd",
        nullDevice: "/dev/null",
      }),
    ).toBe(
      [
        "Host t3-devcontainer-app-1234abcd",
        "  HostName t3-devcontainer-app-1234abcd",
        "  User vscode",
        '  IdentityFile "/home/me/T3 State/devcontainers/id_ed25519"',
        "  IdentitiesOnly yes",
        "  StrictHostKeyChecking no",
        "  UserKnownHostsFile /dev/null",
        "  LogLevel ERROR",
        "  ProxyCommand docker exec -i -u root abc123 /usr/sbin/sshd -i",
        "",
      ].join("\n"),
    );
  });
});
