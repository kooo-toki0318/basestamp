export type HandoffRole = "create" | "verify";

export function isHandoffStepActive(
  stepRole: HandoffRole | undefined,
  activeRole: HandoffRole | undefined
): boolean {
  return activeRole !== undefined && stepRole === activeRole;
}
