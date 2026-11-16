/** Why the Mac app refused to start. Each one ends in a dialog and a quit: there is no degraded mode. */
export type StartupFailureKind = 'platform' | 'macos' | 'chip';

export interface StartupFailure {
  kind: StartupFailureKind;
  /** The dialog's message line. */
  title: string;
  /** What is wrong and what to do about it. */
  detail: string;
}

/** The text a failure is logged as, and what `--startup-check` prints. */
export function formatStartupFailure(failure: StartupFailure): string {
  return `${failure.title}\n\n${failure.detail}`;
}
