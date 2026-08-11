import { useI18n } from "../i18n-context";
import { HandoffStory } from "../components/HandoffStory";

export function HomePage() {
  const { t } = useI18n();
  return (
    <>
      <section className="shell hero">
        <div>
          <p className="eyebrow">{t("home.eyebrow")}</p>
          <h1>{t("home.title")}</h1>
          <p className="lede">{t("home.lede")}</p>
          <div className="actions">
            <a className="button-link" href="/create">
              {t("home.createCta")}
            </a>
            <a className="button-link secondary" href="/verify">
              {t("home.verifyCta")}
            </a>
          </div>
        </div>

        <aside className="preview" aria-label={t("home.previewAria")}>
          <span className="preview-label">{t("home.previewLabel")}</span>
          <h2>{t("home.previewTitle")}</h2>
          <ol>
            <li><span>01</span> {t("home.previewStep1")}</li>
            <li><span>02</span> {t("home.previewStep2")}</li>
            <li><span>03</span> {t("home.previewStep3")}</li>
          </ol>
          <p>{t("home.legalBoundary")}</p>
        </aside>
      </section>
      <HandoffStory />

      <section className="shell use-cases" aria-labelledby="use-cases-heading">
        <div className="section-heading compact-heading">
          <p className="eyebrow">{t("home.useCasesEyebrow")}</p>
          <h2 id="use-cases-heading">{t("home.useCasesTitle")}</h2>
        </div>
        <div className="use-case-grid">
          <article>
            <span aria-hidden="true">01</span>
            <h3>{t("home.useCase1Title")}</h3>
            <p>{t("home.useCase1Body")}</p>
          </article>
          <article>
            <span aria-hidden="true">02</span>
            <h3>{t("home.useCase2Title")}</h3>
            <p>{t("home.useCase2Body")}</p>
          </article>
          <article>
            <span aria-hidden="true">03</span>
            <h3>{t("home.useCase3Title")}</h3>
            <p>{t("home.useCase3Body")}</p>
          </article>
        </div>
        <p className="proof-boundary">{t("home.proofBoundary")}</p>
      </section>

      <section className="technical-story">
        <div className="shell section-heading technical-heading">
          <p className="eyebrow">{t("home.technicalEyebrow")}</p>
          <h2>{t("home.technicalTitle")}</h2>
          <p>{t("home.technicalIntro")}</p>
        </div>
        <div className="shell principles">
          <article>
            <p className="number">01</p>
            <h3>{t("home.principle1Title")}</h3>
            <p>{t("home.principle1Body")}</p>
          </article>
          <article>
            <p className="number">02</p>
            <h3>{t("home.principle2Title")}</h3>
            <p>{t("home.principle2Body")}</p>
          </article>
          <article>
            <p className="number">03</p>
            <h3>{t("home.principle3Title")}</h3>
            <p>{t("home.principle3Body")}</p>
          </article>
        </div>
      </section>
    </>
  );
}
