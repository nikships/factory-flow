import { SavedSwitch, type SwitchState } from './saved-switch.js';

/**
 * Whether desktop browsers may use the web companion (`/dashboard`), kept in the office's own
 * .factory-flow/web-companion.json. On until the owner turns it off. Off, a browser can't pair, a
 * paired browser's token is refused (it stays paired for when the companion is back on), and no
 * companion socket connects. Phones are not affected.
 */
export class WebCompanion extends SavedSwitch {
  constructor(dataDir: string, onState: (state: SwitchState) => void = () => {}) {
    super(dataDir, 'web-companion.json', true, onState);
  }
}
