// ua-parser-js 1.x (MIT) ships no type definitions; only the parts we use are declared here
// instead of adding @types/ua-parser-js (DECISIONS D-005).
declare module 'ua-parser-js' {
  interface UAParserResult {
    browser: { name?: string; version?: string };
    os: { name?: string; version?: string };
    device: { type?: string; vendor?: string; model?: string };
  }

  class UAParser {
    constructor(ua?: string);
    getResult(): UAParserResult;
  }

  export default UAParser;
}
