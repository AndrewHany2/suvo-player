// Pure builder for the VLC launch invocation. No electron/child_process deps so
// it runs under node:test. Returns { file, args } suitable for execFile (which
// spawns WITHOUT a shell), or null when the stream URL is unsafe.
//
// Security: streamUrl and name come from untrusted playlist / IPTV data. We
// never build a shell string; args are passed as a literal argv array so shell
// metacharacters cannot inject commands. The URL is validated to an http(s)
// scheme, which also rejects values (e.g. leading "-") that would otherwise be
// interpreted as VLC flags.

const SAFE_SCHEMES = new Set(["http:", "https:"]);

function buildVlcInvocation(streamUrl, options, platform) {
  const { startTime = 0, name = "Stream" } = options || {};

  let parsed;
  try {
    parsed = new URL(String(streamUrl));
  } catch {
    return null;
  }
  if (!SAFE_SCHEMES.has(parsed.protocol)) return null;

  const vlcArgs = [];
  const t = Math.floor(Number(startTime) || 0);
  if (t > 0) vlcArgs.push(`--start-time=${t}`);
  if (name) vlcArgs.push(`--meta-title=${String(name)}`);

  const url = parsed.href;
  switch (platform) {
    case "darwin":
      return {
        file: "open",
        args: ["-a", "VLC", url, ...(vlcArgs.length ? ["--args", ...vlcArgs] : [])],
      };
    case "win32":
      return {
        file: "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
        args: [...vlcArgs, url],
      };
    default:
      return { file: "vlc", args: [...vlcArgs, url] };
  }
}

module.exports = { buildVlcInvocation, SAFE_SCHEMES };
