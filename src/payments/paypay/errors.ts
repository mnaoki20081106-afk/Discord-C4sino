// paython-wrapper/errors.py の忠実なポート

export class PayPayError extends Error {
  readonly raw: unknown;
  constructor(message: string | object, raw?: unknown) {
    super(typeof message === 'string' ? message : safeStringify(message));
    this.name = 'PayPayError';
    this.raw = raw ?? (typeof message === 'object' ? message : undefined);
  }
}

export class PayPayLoginError extends PayPayError {
  constructor(message: string | object, raw?: unknown) { super(message, raw); this.name = 'PayPayLoginError'; }
}

export class PayPayNetworkError extends PayPayError {
  constructor(message: string | object, raw?: unknown) { super(message, raw); this.name = 'PayPayNetworkError'; }
}

export class P2PTemporaryHoldError extends PayPayError {
  constructor(message: string | object, raw?: unknown) { super(message, raw); this.name = 'P2PTemporaryHoldError'; }
}

function safeStringify(o: unknown): string {
  try { return JSON.stringify(o); } catch { return String(o); }
}
