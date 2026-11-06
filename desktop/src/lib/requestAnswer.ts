export function requestAnswerFailure(error: unknown): { settled: boolean; message: string } {
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    return { settled: error.code === 'requestSettled', message: String(error.message) };
  }
  return { settled: false, message: String(error) };
}
