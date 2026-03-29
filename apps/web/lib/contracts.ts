// TODO: Soroban contract call helpers — see docs/ISSUES.md — "Contract Call Helpers"

/** Calls escrow.deposit — builds XDR, signs via Freighter, submits. */
export async function depositEscrow(): Promise<string> {
  throw new Error("depositEscrow not implemented — see docs/ISSUES.md");
}

/** Calls escrow.release_milestone */
export async function releaseMilestone(): Promise<string> {
  throw new Error("releaseMilestone not implemented — see docs/ISSUES.md");
}

/** Calls escrow.open_dispute */
export async function openDispute(): Promise<string> {
  throw new Error("openDispute not implemented — see docs/ISSUES.md");
}
