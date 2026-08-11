import { useI18n, type MessageKey } from "../i18n-context";

import {
  isHandoffStepActive,
  type HandoffRole
} from "../handoff-role";

type HandoffStoryProperties = {
  activeRole?: HandoffRole;
  compact?: boolean;
};

const STEPS = [
  {
    number: "01",
    role: "create",
    title: "handoff.step1Title",
    body: "handoff.step1Body"
  },
  {
    number: "02",
    title: "handoff.step2Title",
    body: "handoff.step2Body"
  },
  {
    number: "03",
    title: "handoff.step3Title",
    body: "handoff.step3Body"
  },
  {
    number: "04",
    role: "verify",
    title: "handoff.step4Title",
    body: "handoff.step4Body"
  }
] as const satisfies readonly {
  number: string;
  role?: HandoffRole;
  title: MessageKey;
  body: MessageKey;
}[];

function StepIcon({ index }: { index: number }) {
  if (index === 0) {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M7 3.75h7l3 3V20.25H7z" />
        <path d="M14 3.75v3h3M9.5 12h5M9.5 15h3.5" />
      </svg>
    );
  }
  if (index === 1) {
    return (
      <svg viewBox="0 0 24 24">
        <path d="M12 3.75v10.5M8.5 11l3.5 3.5 3.5-3.5" />
        <path d="M5.5 16.75v3.5h13v-3.5" />
      </svg>
    );
  }
  if (index === 2) {
    return (
      <svg viewBox="0 0 24 24">
        <path d="m4 11.25 16-7-6.5 15-2.25-6z" />
        <path d="m11.25 13.25 4.75-5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 3.5 19 6v5.25c0 4.15-2.75 7.55-7 9.25-4.25-1.7-7-5.1-7-9.25V6z" />
      <path d="m8.75 12 2.1 2.1 4.5-4.7" />
    </svg>
  );
}

export function HandoffStory({
  activeRole,
  compact = false
}: HandoffStoryProperties) {
  const { t } = useI18n();
  const headingId = compact ? "handoff-context-heading" : "handoff-heading";

  return (
    <section
      className={`handoff-story${compact ? " compact" : ""}`}
      aria-labelledby={headingId}
    >
      <div className={compact ? "handoff-inner" : "shell"}>
        <div className="section-heading">
          <p className="eyebrow">
            {t(compact ? "handoff.contextEyebrow" : "handoff.eyebrow")}
          </p>
          <h2 id={headingId}>
            {t(compact ? "handoff.contextTitle" : "handoff.title")}
          </h2>
          {!compact && <p>{t("handoff.intro")}</p>}
        </div>

        <ol className="handoff-steps">
          {STEPS.map((step, index) => {
            const role = "role" in step ? step.role : undefined;
            const active = isHandoffStepActive(role, activeRole);
            return (
              <li
                key={step.number}
                className={active ? "is-active" : undefined}
                aria-current={active ? "step" : undefined}
              >
                <span className="flow-icon" aria-hidden="true">
                  <StepIcon index={index} />
                </span>
                <span className="step-number">{step.number}</span>
                {active && (
                  <span className="current-page-marker">
                    {t("handoff.currentPage")}
                  </span>
                )}
                <h3>{t(step.title)}</h3>
                {!compact && <p>{t(step.body)}</p>}
              </li>
            );
          })}
        </ol>
        {!compact && (
          <nav
            className="handoff-route-actions"
            aria-label={t("handoff.actionsAria")}
          >
            <a href="/create">
              <span>{t("handoff.senderRole")}</span>
              <strong>{t("handoff.createCta")}</strong>
              <span aria-hidden="true">→</span>
            </a>
            <a href="/verify">
              <span>{t("handoff.recipientRole")}</span>
              <strong>{t("handoff.verifyCta")}</strong>
              <span aria-hidden="true">→</span>
            </a>
          </nav>
        )}
      </div>
    </section>
  );
}
