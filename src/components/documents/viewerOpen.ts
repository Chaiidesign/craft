// Opening a generated PDF for viewing, shared by the PDF preview and the
// fixture 11 check, so both go through the same failure path. A viewer
// failure is not a renderer failure: the file was made and can still be
// downloaded; only showing it failed.

/** The error a forced viewer failure carries; it names the only scenario that can force it. */
export const FORCED_VIEWER_FAILURE = 'Forced viewer failure (scenario 11 only)'

export const NOT_IN_MEMORY = 'The generated file is no longer in memory (reloading clears exports)'

export async function openForViewer<T>(bytes: Uint8Array | null, open: (bytes: Uint8Array) => Promise<T>, forceFailure?: string): Promise<T> {
  if (forceFailure) throw new Error(forceFailure)
  if (!bytes) throw new Error(NOT_IN_MEMORY)
  return open(bytes)
}
