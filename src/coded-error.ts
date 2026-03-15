export type CodedErrorOptions<TKind extends string = string, TMeta = unknown> = {
  kind?: TKind;
  meta?: TMeta;
  cause?: unknown;
};

export class CodedError<TCode extends string = string, TMeta = unknown, TKind extends string = string> extends Error {
  code: TCode;
  kind?: TKind;
  meta?: TMeta;

  constructor(code: TCode, message: string, options?: CodedErrorOptions<TKind, TMeta>) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "CodedError";
    this.code = code;
    this.kind = options?.kind;
    this.meta = options?.meta;
  }
}
