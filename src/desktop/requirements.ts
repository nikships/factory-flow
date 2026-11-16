import type { StartupFailure } from './startup-failure.js';

/** The oldest macOS the app runs on. Keep `mac.minimumSystemVersion` in electron-builder.yml in step. */
export const MIN_MACOS = 14;
/** The Darwin kernel major version that ships as `MIN_MACOS`: what `os.release()` reports, and what electron-updater compares `minimumSystemVersion` against. */
export const MIN_DARWIN = 23;

/** The Darwin kernel's major version from `os.release()` ("25.0.0" is 25), or undefined when it can't be read. */
export function darwinMajor(release: string): number | undefined {
  const major = Number.parseInt(release, 10);
  return Number.isFinite(major) ? major : undefined;
}

export interface Machine {
  platform: NodeJS.Platform;
  arch: string;
  /** `os.release()`. */
  release: string;
}

/**
 * What the Mac app needs: macOS 14 or later on arm64. LSMinimumSystemVersion
 * only stops Finder launches, so this runs again at startup. Returns the reason to refuse, or undefined to go on.
 * The chip comes last so an old Mac is told about macOS first.
 */
export function checkRequirements(machine: Machine): StartupFailure | undefined {
  if (machine.platform !== 'darwin') {
    return { kind: 'platform', title: 'Factory Flow is a Mac app', detail: `This build runs on macOS only (it is running on ${machine.platform}).` };
  }
  const darwin = darwinMajor(machine.release);
  if (darwin === undefined || darwin < MIN_DARWIN) {
    return {
      kind: 'macos',
      title: `Factory Flow needs macOS ${MIN_MACOS} or later`,
      detail: `Update macOS in System Settings → General → Software Update, then open Factory Flow again. (Darwin ${machine.release}; macOS ${MIN_MACOS} is Darwin ${MIN_DARWIN}.)`,
    };
  }
  if (machine.arch !== 'arm64') {
    return { kind: 'chip', title: 'Factory Flow needs an Apple silicon Mac', detail: `Intel Macs are not supported. This Mac runs the app as ${machine.arch}. Factory Flow requires arm64.` };
  }
  return undefined;
}
