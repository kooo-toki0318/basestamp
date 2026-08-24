import { FilePreview } from "../FilePreview";
import { useI18n, type MessageKey } from "../../i18n-context";
import {
  CONTENT_TYPES,
  PURPOSES,
  type ContentType,
  type Purpose
} from "../../lib/metadata";
import { CreateJourney } from "./CreateJourney";

const PURPOSE_LABEL_KEYS = {
  deliverable: "metadata.purpose.deliverable",
  release: "metadata.purpose.release",
  report: "metadata.purpose.report",
  specification: "metadata.purpose.specification",
  "meeting-record": "metadata.purpose.meetingRecord"
} satisfies Record<Purpose, MessageKey>;

type CreatePreparationPanelProperties = {
  file: File | undefined;
  contentType: ContentType;
  purpose: Purpose;
  busy: boolean;
  activeStep?: 1 | 2;
  onChooseFile: (file: File | undefined) => void;
  onContentTypeChange: (value: ContentType) => void;
  onPurposeChange: (value: Purpose) => void;
  onPrepare: () => void;
};

export function CreatePreparationPanel({
  file,
  contentType,
  purpose,
  busy,
  onChooseFile,
  onContentTypeChange,
  onPurposeChange,
  onPrepare
}: CreatePreparationPanelProperties) {
  const { locale, t } = useI18n();
  const changeFileLabel = locale === "ja" ? "ファイルを変更" : "Change file";
  const preparedFileLabel = locale === "ja" ? "記録するファイル" : "File to record";

  return (
    <section className="panel create-primary-panel">
      <CreateJourney activeStep={1} />

      <div className="create-prepare-form">
        <span className="step-label">{t("create.step1")}</span>
        <label className="field create-file-field">
          <span>{t("create.fileLabel")}</span>
          <input
            type="file"
            onChange={(event) => {
              onChooseFile(event.target.files?.[0]);
            }}
            disabled={busy}
          />
        </label>

        {file !== undefined && (
          <FilePreview
            key={`${file.name}:${String(file.size)}:${String(file.lastModified)}`}
            file={file}
          />
        )}

        <label className="field">
          <span>{t("create.purpose")}</span>
          <select
            value={purpose}
            onChange={(event) => {
              onPurposeChange(event.target.value as Purpose);
            }}
            disabled={busy}
          >
            {PURPOSES.map((value) => (
              <option key={value} value={value}>
                {t(PURPOSE_LABEL_KEYS[value])}
              </option>
            ))}
          </select>
        </label>

        <details className="preparation-options">
          <summary>{t("create.contentType")}</summary>
          <select
            className="preparation-option-select"
            aria-label={t("create.contentType")}
            value={contentType}
            onChange={(event) => {
              onContentTypeChange(event.target.value as ContentType);
            }}
            disabled={busy}
          >
            {CONTENT_TYPES.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </details>

        <button
          type="button"
          className="create-continue-action"
          onClick={onPrepare}
          disabled={busy || file === undefined}
        >
          {t("create.calculate")}
        </button>
      </div>

      {file !== undefined && (
        <div className="create-prepared-summary">
          <div className="create-prepared-copy">
            <span>{preparedFileLabel}</span>
            <strong title={file.name}>{file.name}</strong>
            <small>{t(PURPOSE_LABEL_KEYS[purpose])}</small>
          </div>
          <button
            type="button"
            className="secondary compact create-change-file"
            onClick={() => {
              onChooseFile(undefined);
            }}
            disabled={busy}
          >
            {changeFileLabel}
          </button>
        </div>
      )}
    </section>
  );
}
