// paython-wrapper/errors.py の忠実なポート
export class PayPayError extends Error {
    raw;
    constructor(message, raw) {
        super(typeof message === 'string' ? message : safeStringify(message));
        this.name = 'PayPayError';
        this.raw = raw ?? (typeof message === 'object' ? message : undefined);
    }
}
export class PayPayLoginError extends PayPayError {
    constructor(message, raw) { super(message, raw); this.name = 'PayPayLoginError'; }
}
export class PayPayNetworkError extends PayPayError {
    constructor(message, raw) { super(message, raw); this.name = 'PayPayNetworkError'; }
}
export class P2PTemporaryHoldError extends PayPayError {
    constructor(message, raw) { super(message, raw); this.name = 'P2PTemporaryHoldError'; }
}
function safeStringify(o) {
    try {
        return JSON.stringify(o);
    }
    catch {
        return String(o);
    }
}
