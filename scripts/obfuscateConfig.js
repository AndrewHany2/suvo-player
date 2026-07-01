// Light–medium obfuscation preset. Tuned for weak TV engines (webOS/Tizen):
// control-flow flattening and string-array encoding are OFF — they crawl or
// break there. This mangles names + hides string literals only. Bar-raising,
// not real secrecy (see spec §2/§8).
const OBFUSCATE_OPTIONS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  stringArray: true,
  stringArrayThreshold: 0.5,
  stringArrayEncoding: [],
  rotateStringArray: true,
  identifierNamesGenerator: "mangled",
  numbersToExpressions: false,
  simplify: true,
  splitStrings: false,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
  disableConsoleOutput: false,
  target: "browser",
};

module.exports = { OBFUSCATE_OPTIONS };
