import type { Ref } from 'react';

/** The admin camera/rep readout on the stage; the watchdog fills its text in place through `ref`. */
export function StageDiagnostics({ visible, ref }: { visible: boolean; ref?: Ref<HTMLPreElement> }) {
  return visible ? <pre ref={ref} className="stage__diag" aria-hidden="true" /> : null;
}
