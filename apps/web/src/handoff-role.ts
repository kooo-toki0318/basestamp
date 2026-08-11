export type HandoffRole = "create" | "verify";
export type HandoffStep = 1 | 2 | 3 | 4;

export function isHandoffStepActive(
  step: HandoffStep,
  stepRole: HandoffRole | undefined,
  activeRole: HandoffRole | undefined,
  activeStep?: HandoffStep
): boolean {
  if (activeStep !== undefined) return step === activeStep;
  return activeRole !== undefined && stepRole === activeRole;
}

export function getCreateHandoffStep(
  authenticated: boolean,
  hasVerificationPackage: boolean
): HandoffStep {
  if (hasVerificationPackage) return 3;
  return authenticated ? 2 : 1;
}
