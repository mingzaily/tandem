/** Why the camera could not start, so the scanner can say what to do instead of a generic error. */
export type CameraProblem = 'insecure' | 'denied' | 'missing' | 'busy' | 'failed';

export function cameraProblem(error: unknown, context: { secure: boolean; available: boolean }): CameraProblem {
  // Browsers only expose the camera on HTTPS or localhost.
  if (!context.secure || !context.available) return 'insecure';
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'missing';
    case 'NotReadableError':
    case 'AbortError':
      return 'busy';
    default:
      return 'failed';
  }
}

/** Trying again helps only when the user can change something on this device. */
export const canRetry = (problem: CameraProblem) => problem === 'denied' || problem === 'busy' || problem === 'failed';
