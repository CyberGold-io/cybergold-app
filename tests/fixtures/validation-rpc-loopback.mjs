// Keep validation's configured URL intact while sending its real HTTP requests
// to the local test server. This fixture is loaded only by the unit subprocess.
const fetchHttp = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(input);
  const target = new URL(process.env.TEST_VALIDATION_RPC_ORIGIN);
  url.host = target.host;
  url.protocol = target.protocol;
  return fetchHttp(url, options);
};
