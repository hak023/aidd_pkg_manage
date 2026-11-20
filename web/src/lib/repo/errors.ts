export class DomainError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = "대상") => new DomainError(404, `${what}을(를) 찾을 수 없습니다.`);
export const badRequest = (msg: string) => new DomainError(400, msg);
