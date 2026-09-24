import type { JourneyStep } from '../lib/sessionFlow';

export function Stepper({ steps, activeKey }: { steps: JourneyStep[]; activeKey: string }) {
  const activeIndex = Math.max(0, steps.findIndex((step) => step.key === activeKey));
  return (
    <ol className="stepper" aria-label="Session progress">
      {steps.map((step, index) => {
        const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'todo';
        return (
          <li key={step.key} className={`stepper__item stepper__item--${state}`} aria-current={state === 'active' ? 'step' : undefined}>
            <span className="stepper__dot">{index + 1}</span>
            <span className="stepper__label">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
