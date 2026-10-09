/**
 * On-screen diagnostics (camera preview numbers, the rep-counter line, per-rep plank debug) are for the admin only.
 * Admin unlock is remembered on the device, so a volunteer can be using a phone that is still unlocked: the numbers
 * therefore also need the admin's "Show diagnostics on screen" switch, which starts off, isn't saved across reloads,
 * and is turned off again by Next volunteer and Sign out admin. No screen turns them on by itself.
 */
export function showOnScreenDiagnostics(admin: { unlocked: boolean; diagnosticsOn: boolean }) {
  return admin.unlocked && admin.diagnosticsOn;
}
