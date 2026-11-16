// Prints a free loopback port and exits.
//
// The office smoke checks start a server and can't rely on 4700 being unused. Asking the kernel for
// an unused port and closing it leaves a moment where another process could take it, which is fine
// for a smoke check: the office either binds it or the check says so.
import { createServer } from 'node:net';

const server = createServer();
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  console.log(typeof address === 'object' && address !== null ? address.port : 0);
  server.close();
});
