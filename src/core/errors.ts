export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export function newErrorId(): string {
  return crypto.randomUUID();
}
