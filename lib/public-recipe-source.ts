import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

const limit = 1024 * 1024;

export async function fetchRecipeSource(input: string) {
  const signal = AbortSignal.timeout(9000);
  let target = new URL(input);
  for (let hop = 0; hop <= 3; hop++) {
    const secure = target.protocol === "https:";
    if ((!secure && target.protocol !== "http:") || target.port || target.username || target.password) {
      throw new Error("Enter a public HTTP or HTTPS recipe link.");
    }
    const host = target.hostname.replace(/^\[|\]$/g, "");
    const addresses = await lookup(host, { all: true });
    if (!addresses.length || addresses.some(({ address }) => ipaddr.process(address).range() !== "unicast")) {
      throw new Error("This recipe link must use a public website.");
    }
    signal.throwIfAborted();
    // The socket uses the vetted address directly. Host and TLS still verify the original site.
    const get = secure ? httpsRequest : httpRequest;
    const response = await new Promise<{ location?: string; body?: string }>((resolve, reject) => {
      get({
        hostname: addresses[0].address, family: addresses[0].family,
        port: secure ? 443 : 80, path: target.pathname + target.search, signal,
        servername: isIP(host) ? undefined : host,
        headers: { Host: target.host, Accept: "text/html, application/ld+json, application/json", "Accept-Encoding": "identity", "User-Agent": "HomemadeByBekah/1.0" },
      }, (res) => {
        if (res.headers.location && [301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
          res.destroy();
          resolve({ location: res.headers.location });
          return;
        }
        if (res.statusCode !== 200 || !/^(text\/html|application\/(ld\+json|json|xhtml\+xml))(?:;|$)/i.test(res.headers["content-type"] ?? "") ||
            (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity") || Number(res.headers["content-length"]) > limit) {
          res.destroy();
          reject(new Error("The website did not return a supported recipe page."));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > limit) res.destroy(new Error("The recipe page is too large."));
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("aborted", () => reject(new Error("The recipe download was interrupted.")));
        res.on("end", () => resolve({ body: Buffer.concat(chunks).toString("utf8") }));
      }).on("error", reject).end();
    });
    if (response.location) { target = new URL(response.location, target); continue; }
    return { html: response.body ?? "", source: target.href };
  }
  throw new Error("The recipe website redirected too many times.");
}
