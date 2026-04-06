export function logServerError(context: string, error: unknown) {
  const timestamp = new Date().toISOString();

  if (error instanceof Error) {
    console.error(`[${timestamp}] ${context}: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    return;
  }

  console.error(`[${timestamp}] ${context}:`, error);
}

