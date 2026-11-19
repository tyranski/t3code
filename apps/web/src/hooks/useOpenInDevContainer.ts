import { inferProjectTitleFromPath } from "@t3tools/client-runtime/state/projects";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { useGT } from "gt-react";

import { formatDesktopSshConnectionError } from "../components/settings/ConnectionsSettings.logic";
import { toastManager } from "../components/ui/toast";
import { connectSshEnvironment as connectSshEnvironmentAtom } from "../connection/onboarding";
import { newProjectId } from "../lib/utils";
import { waitForProject, waitForProjectAtPath } from "../state/entities";
import { waitForEnvironmentConnected } from "../state/environments";
import { projectEnvironment } from "../state/projects";
import { useAtomCommand } from "../state/use-atom-command";
import { useNewThreadHandler } from "./useHandleNewThread";

/**
 * Desktop only: starts a local project's dev container, connects it as an SSH
 * environment, and opens the project there in a new thread.
 */
export function useOpenInDevContainer() {
  const gt = useGT();
  const connectSshEnvironment = useAtomCommand(connectSshEnvironmentAtom, {
    reportFailure: false,
  });
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const openThread = useNewThreadHandler();
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;

  const open = async (workspaceRoot: string) => {
    if (!bridge) return;
    const title = inferProjectTitleFromPath(workspaceRoot);
    const fail = (description: string) =>
      toastManager.add({
        type: "error",
        title: gt("Could not open {project} in its dev container", { project: title }),
        description,
      });
    const pending = toastManager.add({
      type: "loading",
      title: gt("Starting the {project} dev container…", { project: title }),
      description: gt("The first start builds the image and can take several minutes."),
      timeout: 0,
    });
    const run = async () => {
      const connection = await bridge.openDevContainer(workspaceRoot).catch((error: unknown) => {
        fail(formatDesktopSshConnectionError(error));
        return null;
      });
      if (connection === null) return;
      const connected = await connectSshEnvironment({
        target: connection.target,
        label: gt("{project} (dev container)", { project: title }),
      });
      if (connected._tag === "Failure") {
        fail(formatDesktopSshConnectionError(squashAtomCommandFailure(connected)));
        return;
      }
      const environmentId = connected.value;
      // Registering returns before the socket is up, and commands sent earlier fail.
      if (!(await waitForEnvironmentConnected(environmentId))) {
        fail(gt("The T3 server in the dev container did not connect. Try again."));
        return;
      }
      const projectId = newProjectId();
      const created = await createProject({
        environmentId,
        input: {
          projectId,
          title,
          workspaceRoot: connection.remoteWorkspaceFolder,
          createWorkspaceRootIfMissing: false,
          defaultModelSelection: null,
        },
      });
      let projectRef = scopeProjectRef(environmentId, projectId);
      if (created._tag === "Failure") {
        const message = formatDesktopSshConnectionError(squashAtomCommandFailure(created));
        // Opened before: start the new thread in the project already there.
        const existing = message.includes("already exists")
          ? await waitForProjectAtPath(environmentId, connection.remoteWorkspaceFolder)
          : null;
        if (existing === null) {
          fail(message);
          return;
        }
        projectRef = scopeProjectRef(environmentId, existing.id);
      }
      await waitForProject(projectRef);
      await openThread(projectRef);
    };
    await run().finally(() => toastManager.close(pending));
  };

  return { available: bridge !== undefined, open };
}
