const PUBLIC_OP_HOST = "op.tztright.qzz.io";
const SHORT_OP_PATH_PATTERN = /^\/([1-9][0-9]{8})$/;

export function isPublicOpHost(hostname: string): boolean {
  return hostname.toLowerCase() === PUBLIC_OP_HOST;
}

export function publicOpApiUrl(_hostname: string): "/api/op/resolve" {
  // The public page must resolve against its own host.  In local QA this keeps
  // the request on the Vite origin too, instead of coupling the browser to prod.
  return "/api/op/resolve";
}

export function extractPublicShortCode(pathname: string): string | undefined {
  return SHORT_OP_PATH_PATTERN.exec(pathname)?.[1];
}
