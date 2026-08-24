import type { Address, Hex } from "viem";
import { useI18n } from "../../i18n-context";
import { localeTag } from "../../locale";

type PreparedTechnicalDetails = {
  fileSize: number;
  contentCommitment: Hex;
  metadataHash: Hex;
};

type CreateTechnicalDetailsProperties = {
  prepared: PreparedTechnicalDetails | undefined;
  registryAvailable: boolean;
  registryAddress: Address;
};

function shortHex(value: string): string {
  return value.slice(0, 10) + "…" + value.slice(-8);
}

export function CreateTechnicalDetails({
  prepared,
  registryAvailable,
  registryAddress
}: CreateTechnicalDetailsProperties) {
  const { locale, t } = useI18n();

  return (
    <details className="panel create-technical-disclosure">
      <summary>{t("create.step2")}</summary>

      <div className="create-public-record-note">
        <strong>{t("create.warningTitle")}</strong>
        <p>{t("create.warning")}</p>
      </div>

      {prepared === undefined ? (
        <p className="muted">{t("create.reviewEmpty")}</p>
      ) : (
        <dl className="technical-list">
          <div>
            <dt>{t("create.fileSize")}</dt>
            <dd>
              {prepared.fileSize.toLocaleString(localeTag(locale))} {t("common.bytes")}
            </dd>
          </div>
          <div>
            <dt>{t("create.commitment")}</dt>
            <dd title={prepared.contentCommitment}>
              {shortHex(prepared.contentCommitment)}
            </dd>
          </div>
          <div>
            <dt>{t("create.metadataHash")}</dt>
            <dd title={prepared.metadataHash}>{shortHex(prepared.metadataHash)}</dd>
          </div>
          <div>
            <dt>{t("create.registry")}</dt>
            <dd>
              {registryAvailable
                ? shortHex(registryAddress)
                : t("common.notDeployed")}
            </dd>
          </div>
        </dl>
      )}

      <p className="muted">{t("create.saltWarning")}</p>
    </details>
  );
}
