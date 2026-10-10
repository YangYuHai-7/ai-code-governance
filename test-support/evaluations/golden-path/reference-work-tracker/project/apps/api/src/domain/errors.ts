export class NotFoundError extends Error {
  constructor(message = 'not found') { super(message); this.name = 'NotFoundError'; }
}

export class ConflictError extends Error {
  constructor(message = 'conflict') { super(message); this.name = 'ConflictError'; }
}
