export type RediscoveryAction =
  | "skip_in_progress"
  | "skip_connected"
  | "retry"
  | "reconnect_same_ip"
  | "reconnect_new_ip";

export interface RediscoveryDecisionInput {
  rediscoveryInProgress: boolean;
  clientConnected: boolean;
  previousIp: string;
  discoveredIp: string;
}

export interface RediscoveryDecision {
  action: RediscoveryAction;
  targetIp: string;
}

export function decideRediscovery(
  input: RediscoveryDecisionInput
): RediscoveryDecision {
  if (input.rediscoveryInProgress) {
    return {
      action: "skip_in_progress",
      targetIp: input.previousIp,
    };
  }

  if (input.clientConnected) {
    return {
      action: "skip_connected",
      targetIp: input.previousIp,
    };
  }

  const discoveredIp = input.discoveredIp.trim();

  if (!discoveredIp) {
    return {
      action: "retry",
      targetIp: input.previousIp,
    };
  }

  if (discoveredIp === input.previousIp) {
    return {
      action: "reconnect_same_ip",
      targetIp: discoveredIp,
    };
  }

  return {
    action: "reconnect_new_ip",
    targetIp: discoveredIp,
  };
}
