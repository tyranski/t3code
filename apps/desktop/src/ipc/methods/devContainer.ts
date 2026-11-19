import { DesktopDevContainerConnectionSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopDevContainer from "../../devcontainer/DesktopDevContainer.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const openDevContainer = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.OPEN_DEV_CONTAINER_CHANNEL,
  payload: Schema.String,
  result: DesktopDevContainerConnectionSchema,
  handler: Effect.fn("desktop.ipc.devContainer.open")(function* (workspaceFolder) {
    const devContainer = yield* DesktopDevContainer.DesktopDevContainer;
    return yield* devContainer.open(workspaceFolder);
  }),
});
