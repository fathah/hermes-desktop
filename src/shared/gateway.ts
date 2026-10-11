export type RemoteGatewayAction = "start" | "stop" | "restart";

export type RemoteGatewayActionResult =
  | { success: true }
  | {
      success: false;
      error: string;
      failureKind: "failed" | "unconfirmed";
    };

export type RemoteGatewayCommandStatus = {
  pending: boolean;
  failure?: { error: string };
};
