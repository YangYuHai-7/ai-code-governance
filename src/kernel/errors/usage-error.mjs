export function usageError(message) {
  const error = new Error(message);
  error.code = 'AICG_USAGE';
  error.exitCode = 2;
  return error;
}
