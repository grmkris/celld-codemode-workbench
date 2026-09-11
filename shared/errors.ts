export class HostError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "HostError";
    this.code = code;
    this.status = status;
  }
}

export class ApprovalRequiredError extends HostError {
  operationId: string;

  constructor(operationId: string) {
    super("approval_required", `Protected effect ${operationId} requires host approval`, 409);
    this.name = "ApprovalRequiredError";
    this.operationId = operationId;
  }
}

export class CancelledError extends HostError {
  constructor(message = "Run was cancelled") {
    super("cancelled", message, 409);
    this.name = "CancelledError";
  }
}

export class FenceError extends HostError {
  constructor(message = "Stale execution fenced") {
    super("fenced", message, 409);
    this.name = "FenceError";
  }
}
