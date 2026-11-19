'use strict';
const { start } = require('./mock-server');
const args = process.argv.slice(2);
const port = Number(args.find((a) => /^\d+$/.test(a)) || 9958);
const openOnly = args.indexOf('--open-only') >= 0;
start(port, { desktop: !openOnly }).then(({ server }) => {
  console.log('mock listening on ' + port + (openOnly ? ' (open only)' : ' (desktop + open)'));
  process.on('SIGTERM', () => { server.close(); process.exit(0); });
});
