/**
 * Make an upstream cookie stick on the local domain: drop Domain (it names the
 * upstream host) and send it as SameSite=None; Secure, because the frontend
 * (e.g. http://localhost:5100) and the local API domain are different sites.
 */
export function rewriteSetCookie(cookie: string): string {
  const [nameValue = "", ...attributes] = cookie.split(";").map((part) => part.trim());
  const kept = attributes.filter((attribute) => {
    const key = attribute.split("=")[0]?.trim().toLowerCase();
    return key !== "domain" && key !== "secure" && key !== "samesite";
  });
  return [nameValue, ...kept, "Secure", "SameSite=None"].join("; ");
}

/**
 * Point a redirect at the local domain when it targets the source origin under
 * the source base path. The base path is stripped because the local domain
 * maps "/" to it. Anything else is returned unchanged.
 */
export function rewriteLocation(location: string, source: string, localOrigin: string): string {
  // Relative-path references ("next", "../a") resolve against the local URL in
  // the browser and already land on the matching upstream path.
  const isAbsoluteUrlOrPath = /^([a-z][a-z0-9+.-]*:|\/)/i.test(location);
  const sourceUrl = new URL(source);
  if (!isAbsoluteUrlOrPath || !URL.canParse(location, sourceUrl.origin)) {
    return location;
  }

  const basePath = sourceUrl.pathname.replace(/\/+$/, "");
  const target = new URL(location, sourceUrl.origin);
  const isUnderBasePath =
    basePath === "" || target.pathname === basePath || target.pathname.startsWith(`${basePath}/`);
  if (target.origin !== sourceUrl.origin || !isUnderBasePath) {
    return location;
  }

  const localPath = target.pathname.slice(basePath.length) || "/";
  return `${localOrigin}${localPath}${target.search}${target.hash}`;
}
