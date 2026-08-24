import { useI18n } from "../../i18n-context";

type CreateStatusBarProperties = {
  busy: boolean;
  success: boolean;
  status: string;
};

export function CreateStatusBar({
  busy,
  success,
  status
}: CreateStatusBarProperties) {
  const { t } = useI18n();
  const idleStatuses = new Set([
    t("create.status.chooseFile"),
    t("create.status.ready"),
    t("create.status.valuesReady")
  ]);
  const errorStatuses = new Set([
    t("create.status.fileTooLarge"),
    t("create.status.preparationFailed"),
    t("create.status.signInRequired"),
    t("create.status.localRecordMissing"),
    t("create.status.turnstileRequired"),
    t("create.status.turnstileFailed"),
    t("create.status.recordingFailed")
  ]);
  const isError = errorStatuses.has(status);

  if (!busy && !success && !isError && idleStatuses.has(status)) return null;

  return (
    <div
      className={
        "operation-status" +
        (busy ? " is-busy" : "") +
        (success ? " is-success" : "") +
        (isError ? " is-error" : "")
      }
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <span className="operation-status-dot" aria-hidden="true" />
      <div>
        <span>{t("create.statusLabel")}</span>
        <p>{status}</p>
      </div>
    </div>
  );
}
