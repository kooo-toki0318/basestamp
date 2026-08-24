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

  return (
    <div
      className={
        "operation-status" +
        (busy ? " is-busy" : "") +
        (success ? " is-success" : "")
      }
      role="status"
      aria-live="polite"
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
