import { useEffect } from "react";
import { useI18n, type MessageKey } from "../i18n-context";
import {
  EXPECTED_SECURITY_ADVISORY_URL,
  hasVerifiedSecurityContact,
  type PublicInformationPage
} from "../public-pages";

const PROJECT_ISSUES_URL =
  "https://github.com/kooo-toki0318/basestamp/issues";
const SECURITY_CONTACT_CONFIGURED = hasVerifiedSecurityContact(
  import.meta.env.VITE_SECURITY_CONTACT_URL
);
const SECURITY_ADVISORY_URL = SECURITY_CONTACT_CONFIGURED
  ? EXPECTED_SECURITY_ADVISORY_URL
  : undefined;

type InformationSection = {
  title: MessageKey;
  paragraphs?: readonly MessageKey[];
  items?: readonly MessageKey[];
};

type InformationPageCopy = {
  eyebrow: MessageKey;
  title: MessageKey;
  lede: MessageKey;
  meta: MessageKey;
  noticeTitle?: MessageKey;
  noticeBody?: MessageKey;
  sections: readonly InformationSection[];
};

const PAGE_COPY: Record<PublicInformationPage, InformationPageCopy> = {
  legal: {
    eyebrow: "legal.eyebrow",
    title: "legal.title",
    lede: "legal.lede",
    meta: "legal.meta",
    noticeTitle: "legal.noticeTitle",
    noticeBody: "legal.noticeBody",
    sections: [
      {
        title: "legal.scopeTitle",
        paragraphs: ["legal.scopeBody"],
        items: ["legal.scopeItem1", "legal.scopeItem2", "legal.scopeItem3"]
      },
      {
        title: "legal.publicTitle",
        paragraphs: ["legal.publicBody"],
        items: ["legal.publicItem1", "legal.publicItem2"]
      },
      {
        title: "legal.responsibilityTitle",
        paragraphs: ["legal.responsibilityBody"],
        items: [
          "legal.responsibilityItem1",
          "legal.responsibilityItem2",
          "legal.responsibilityItem3"
        ]
      },
      {
        title: "legal.releaseTitle",
        paragraphs: ["legal.releaseBody"]
      }
    ]
  },
  privacy: {
    eyebrow: "privacy.eyebrow",
    title: "privacy.title",
    lede: "privacy.lede",
    meta: "privacy.meta",
    noticeTitle: "privacy.noticeTitle",
    noticeBody: "privacy.noticeBody",
    sections: [
      {
        title: "privacy.localTitle",
        paragraphs: ["privacy.localBody"],
        items: [
          "privacy.localItem1",
          "privacy.localItem2",
          "privacy.localItem3"
        ]
      },
      {
        title: "privacy.serviceTitle",
        paragraphs: ["privacy.serviceBody"],
        items: [
          "privacy.serviceItem1",
          "privacy.serviceItem2",
          "privacy.serviceItem3",
          "privacy.serviceItem4"
        ]
      },
      {
        title: "privacy.externalTitle",
        paragraphs: ["privacy.externalBody"],
        items: [
          "privacy.externalItem1",
          "privacy.externalItem2",
          "privacy.externalItem3"
        ]
      },
      {
        title: "privacy.retentionTitle",
        paragraphs: ["privacy.retentionBody"],
        items: [
          "privacy.retentionItem1",
          "privacy.retentionItem2",
          "privacy.retentionItem3",
          "privacy.retentionItem4"
        ]
      },
      {
        title: "privacy.controlsTitle",
        paragraphs: ["privacy.controlsBody", "privacy.contactBody"]
      }
    ]
  },
  terms: {
    eyebrow: "terms.eyebrow",
    title: "terms.title",
    lede: "terms.lede",
    meta: "terms.meta",
    noticeTitle: "terms.noticeTitle",
    noticeBody: "terms.noticeBody",
    sections: [
      {
        title: "terms.useTitle",
        paragraphs: ["terms.useBody"],
        items: ["terms.useItem1", "terms.useItem2", "terms.useItem3"]
      },
      {
        title: "terms.prohibitedTitle",
        paragraphs: ["terms.prohibitedBody"],
        items: [
          "terms.prohibitedItem1",
          "terms.prohibitedItem2",
          "terms.prohibitedItem3",
          "terms.prohibitedItem4"
        ]
      },
      {
        title: "terms.transactionsTitle",
        paragraphs: ["terms.transactionsBody"],
        items: [
          "terms.transactionsItem1",
          "terms.transactionsItem2",
          "terms.transactionsItem3"
        ]
      },
      {
        title: "terms.warrantyTitle",
        paragraphs: ["terms.warrantyBody", "terms.liabilityBody"]
      },
      {
        title: "terms.lawTitle",
        paragraphs: ["terms.lawBody", "terms.contactBody"]
      },
      {
        title: "terms.changesTitle",
        paragraphs: ["terms.changesBody"]
      }
    ]
  },
  security: {
    eyebrow: "security.eyebrow",
    title: "security.title",
    lede: SECURITY_CONTACT_CONFIGURED
      ? "security.ledeActive"
      : "security.lede",
    meta: SECURITY_CONTACT_CONFIGURED
      ? "security.metaActive"
      : "security.meta",
    noticeTitle: "security.noticeTitle",
    noticeBody: SECURITY_CONTACT_CONFIGURED
      ? "security.noticeBodyActive"
      : "security.noticeBody",
    sections: [
      {
        title: "security.reportTitle",
        paragraphs: ["security.reportBody"],
        items: [
          "security.reportItem1",
          "security.reportItem2",
          "security.reportItem3"
        ]
      },
      {
        title: "security.scopeTitle",
        paragraphs: [
          SECURITY_CONTACT_CONFIGURED
            ? "security.scopeBodyActive"
            : "security.scopeBody"
        ],
        items: [
          "security.scopeItem1",
          "security.scopeItem2",
          "security.scopeItem3"
        ]
      },
      {
        title: "security.testingTitle",
        paragraphs: ["security.testingBody"],
        items: [
          "security.testingItem1",
          "security.testingItem2",
          "security.testingItem3",
          SECURITY_CONTACT_CONFIGURED
            ? "security.testingItem4Active"
            : "security.testingItem4"
        ]
      },
      {
        title: "security.safeHarborTitle",
        paragraphs: ["security.safeHarborBody"]
      },
      {
        title: "security.responseTitle",
        paragraphs: [
          SECURITY_CONTACT_CONFIGURED
            ? "security.responseBodyActive"
            : "security.responseBody",
          SECURITY_CONTACT_CONFIGURED
            ? "security.pgpBodyActive"
            : "security.pgpBody"
        ]
      }
    ]
  }
};

export function InformationPage({
  page
}: {
  page: PublicInformationPage;
}) {
  const { t } = useI18n();
  const copy = PAGE_COPY[page];

  useEffect(() => {
    document.title = `${t(copy.title)} · BaseStamp`;
    return () => {
      document.title = "BaseStamp";
    };
  }, [copy.title, t]);

  return (
    <section className="shell information-page" aria-labelledby="information-title">
      <header className="information-hero">
        <p className="eyebrow">{t(copy.eyebrow)}</p>
        <h1 id="information-title">{t(copy.title)}</h1>
        <p className="lede">{t(copy.lede)}</p>
        <p className="information-meta">{t(copy.meta)}</p>
      </header>

      {copy.noticeTitle !== undefined && copy.noticeBody !== undefined && (
        <aside className="information-notice">
          <strong>{t(copy.noticeTitle)}</strong>
          <p>{t(copy.noticeBody)}</p>
        </aside>
      )}

      {page === "security" && (
        <div className="information-actions" aria-label={t("security.actionsAria")}>
          {SECURITY_ADVISORY_URL === undefined ? (
            <p className="information-contact" role="status">
              {t("security.contactPending")}
            </p>
          ) : (
            <>
              <a
                className="button-link"
                href={SECURITY_ADVISORY_URL}
                target="_blank"
                rel="noreferrer"
              >
                {t("security.reportAction")} <span aria-hidden="true">↗</span>
              </a>
              <a className="text-link" href="/.well-known/security.txt">
                {t("security.machineReadableAction")}
              </a>
            </>
          )}
        </div>
      )}

      <div className="information-sections">
        {copy.sections.map((section) => (
          <article key={section.title}>
            <h2>{t(section.title)}</h2>
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph}>{t(paragraph)}</p>
            ))}
            {section.items !== undefined && (
              <ul>
                {section.items.map((item) => (
                  <li key={item}>{t(item)}</li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>

      {(page === "privacy" || page === "terms") && (
        <p className="information-contact">
          {t("information.publicContactPrefix")}{" "}
          <a href={PROJECT_ISSUES_URL} target="_blank" rel="noreferrer">
            {t("information.projectIssues")}
          </a>
          {" "}{t("information.publicContactSuffix")}
        </p>
      )}
    </section>
  );
}
