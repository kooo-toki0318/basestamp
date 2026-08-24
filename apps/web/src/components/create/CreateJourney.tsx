import { useI18n } from "../../i18n-context";

type CreateJourneyProperties = {
  activeStep: 1 | 2 | 3;
};

export function CreateJourney({ activeStep }: CreateJourneyProperties) {
  const { t } = useI18n();
  const steps = [
    { number: 1 as const, label: t("create.step1") },
    { number: 2 as const, label: t("create.step3") },
    { number: 3 as const, label: t("create.shareTitle") }
  ];

  return (
    <ol className="create-journey" aria-label={t("home.previewAria")}>
      {steps.map((step) => (
        <li
          key={step.number}
          className={
            step.number < activeStep
              ? "is-complete"
              : step.number === activeStep
                ? "is-active"
                : undefined
          }
        >
          <span>{step.number < activeStep ? "✓" : step.number}</span>
          <strong>{step.label}</strong>
        </li>
      ))}
    </ol>
  );
}
