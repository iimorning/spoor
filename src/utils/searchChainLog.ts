/** Dev console trace: model fence → rewrite → Metaso → hit titles. */
const PREFIX = '[Spoor][search-chain]';

export function logSearchChain(step: string, detail?: unknown): void {
  if (detail === undefined) {
    console.info(`${PREFIX} ${step}`);
    return;
  }
  console.info(`${PREFIX} ${step}`, detail);
}
