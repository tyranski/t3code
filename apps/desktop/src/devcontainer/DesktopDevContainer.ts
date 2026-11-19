import type { DesktopDevContainerConnection } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import {
  AUTHORIZE_KEY_SCRIPT,
  buildDevContainerSshConfig,
  devContainerAlias,
  ENSURE_SSHD_SCRIPT,
  parseDevContainerUpOutput,
} from "./devContainerSsh.ts";

const DevContainerStep = Schema.Literals(["cli", "up", "sshd", "key", "config"]);

export class DesktopDevContainerError extends Schema.TaggedError<DesktopDevContainerError>()(
  "DesktopDevContainerError",
  {
    step: DevContainerStep,
    detail: Schema.String,
  },
) {
  override get message() {
    return this.detail;
  }
}

export class DesktopDevContainer extends Context.Service<
  DesktopDevContainer,
  {
    /** Starts the folder's dev container and returns an SSH target that reaches it. */
    readonly open: (
      workspaceFolder: string,
    ) => Effect.Effect<DesktopDevContainerConnection, DesktopDevContainerError>;
  }
>()("@t3tools/desktop/devcontainer/DesktopDevContainer") {}

// A first build pulls and builds the image, which can take a long time.
const UP_TIMEOUT = Duration.minutes(30);
const SSHD_TIMEOUT = Duration.minutes(10);
const SHORT_TIMEOUT = Duration.minutes(1);
const OUTPUT_TAIL_CHARS = 2_000;

const tail = (text: string) => text.trim().slice(-OUTPUT_TAIL_CHARS);

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const platform = yield* HostProcess.Platform;
  const fileSystem = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const { path } = environment;
  const stateDir = path.join(environment.stateDir, "devcontainers");

  const run = (
    step: typeof DevContainerStep.Type,
    command: string,
    args: ReadonlyArray<string>,
    timeout: Duration.Duration,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        const child = yield* spawner.spawn(
          ChildProcess.make(command, args, { stdin: "ignore", stdout: "pipe", stderr: "pipe" }),
        );
        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            Stream.mkString(Stream.decodeText(child.stdout)),
            Stream.mkString(Stream.decodeText(child.stderr)),
            child.exitCode,
          ],
          { concurrency: 3 },
        );
        return { stdout, stderr, exitCode };
      }),
    ).pipe(
      Effect.timeoutOption(timeout),
      Effect.mapError(
        (cause) =>
          new DesktopDevContainerError({
            step,
            detail:
              command === "devcontainer" && cause.reason._tag === "NotFound"
                ? "The Dev Containers CLI is not installed. Install it with `npm install -g @devcontainers/cli`, then try again."
                : `Could not run ${command}: ${cause.message}`,
          }),
      ),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new DesktopDevContainerError({
                step,
                detail: `${command} did not finish in ${Duration.format(timeout)}.`,
              }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );

  const open = Effect.fn("desktop.devContainer.open")(function* (workspaceFolder: string) {
    const up = yield* run(
      "up",
      "devcontainer",
      ["up", "--workspace-folder", workspaceFolder],
      UP_TIMEOUT,
    );
    const result = parseDevContainerUpOutput(up.stdout);
    if (result === null || result.outcome === "error") {
      return yield* new DesktopDevContainerError({
        step: "up",
        detail:
          result?.message ??
          `The dev container did not start${up.stderr.trim() ? `:\n${tail(up.stderr)}` : "."}`,
      });
    }
    const { containerId, remoteUser, remoteWorkspaceFolder } = result;

    const sshd = yield* run(
      "sshd",
      "docker",
      ["exec", "-u", "root", containerId, "sh", "-c", ENSURE_SSHD_SCRIPT],
      SSHD_TIMEOUT,
    );
    const sshdPath = sshd.stdout.trim().split("\n").at(-1)?.trim() ?? "";
    if (sshd.exitCode !== 0 || !sshdPath.startsWith("/")) {
      return yield* new DesktopDevContainerError({
        step: "sshd",
        detail: `Could not set up an SSH server in the dev container:\n${tail(sshd.stderr)}`,
      });
    }

    const configError = (cause: { readonly message: string }) =>
      new DesktopDevContainerError({ step: "config", detail: cause.message });
    yield* fileSystem
      .makeDirectory(stateDir, { recursive: true })
      .pipe(Effect.mapError(configError));
    const keyPath = path.join(stateDir, "id_ed25519");
    if (!(yield* fileSystem.exists(keyPath).pipe(Effect.mapError(configError)))) {
      const keygen = yield* run(
        "key",
        "ssh-keygen",
        ["-q", "-t", "ed25519", "-N", "", "-C", "t3code-devcontainer", "-f", keyPath],
        SHORT_TIMEOUT,
      );
      if (keygen.exitCode !== 0) {
        return yield* new DesktopDevContainerError({
          step: "key",
          detail: `Could not create an SSH key for dev containers:\n${tail(keygen.stderr)}`,
        });
      }
    }
    const publicKey = (yield* fileSystem
      .readFileString(`${keyPath}.pub`)
      .pipe(Effect.mapError(configError))).trim();
    const authorize = yield* run(
      "key",
      "docker",
      [
        "exec",
        "-u",
        remoteUser,
        "-e",
        `T3_DEVCONTAINER_KEY=${publicKey}`,
        containerId,
        "sh",
        "-c",
        AUTHORIZE_KEY_SCRIPT,
      ],
      SHORT_TIMEOUT,
    );
    if (authorize.exitCode !== 0) {
      return yield* new DesktopDevContainerError({
        step: "key",
        detail: `Could not authorize T3 Code in the dev container:\n${tail(authorize.stderr)}`,
      });
    }

    const alias = devContainerAlias(workspaceFolder);
    const sshConfigPath = path.join(stateDir, `${alias}.ssh_config`);
    yield* fileSystem
      .writeFileString(
        sshConfigPath,
        buildDevContainerSshConfig({
          alias,
          user: remoteUser,
          identityFile: keyPath,
          docker: "docker",
          containerId,
          sshdPath,
          nullDevice: platform === "win32" ? "NUL" : "/dev/null",
        }),
      )
      .pipe(Effect.mapError(configError));

    return {
      target: {
        alias,
        hostname: alias,
        username: remoteUser,
        port: null,
        sshConfigPath,
        devContainerFolder: workspaceFolder,
      },
      remoteWorkspaceFolder,
    };
  });

  return DesktopDevContainer.of({ open });
});

export const layer = Layer.effect(DesktopDevContainer, make);
