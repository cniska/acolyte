export const HTTP_STATUS = {
  ok: 200,
  badRequest: 400,
  unauthorized: 401,
  notFound: 404,
  conflict: 409,
  tooManyRequests: 429,
  serviceUnavailable: 503,
  overloaded: 529,
} as const;
