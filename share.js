// Starts CooWatch and puts it on a public HTTPS address, in one command.
//
//   npm run share
//
// The only requirement is Node. The tunnel binary is fetched by npx the first
// time and cached after that. Nothing is installed globally, no account needed.

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// A named Cloudflare tunnel gives a permanent address on your own domain
// instead of a new random one every run. Set it up once (see the README), put
// the name in tunnel.json or COOWATCH_TUNNEL, and this uses it automatically.
function namedTunnel() {
  if (process.env.COOWATCH_TUNNEL) {
    return { name: process.env.COOWATCH_TUNNEL, hostname: process.env.COOWATCH_HOSTNAME || '' };
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'tunnel.json'), 'utf8'));
    if (cfg && cfg.tunnel) return { name: cfg.tunnel, hostname: cfg.hostname || '' };
  } catch {
    // no config, so fall back to a throwaway address
  }
  return null;
}
const HEALTH = `http://localhost:${PORT}/api/health`;
const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

const PID_FILE = path.join(__dirname, '.coowatch-pids');

let server = null;
let tunnel = null;
let shuttingDown = false;

// If a previous run was killed without its handler firing - closing the window,
// a crash - the tunnel can outlive it. Clean that up before starting a new one.
// PIDs get recycled, so never kill one without checking what it actually is.
function processName(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/fi', `PID eq ${pid}`, '/nh', '/fo', 'csv'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const match = out.match(/^"([^"]+)"/);
      return match ? match[1].toLowerCase() : '';
    }
    return execFileSync('ps', ['-p', String(pid), '-o', 'comm='],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().toLowerCase();
  } catch {
    return '';
  }
}

function reapPrevious() {
  let pids;
  try {
    pids = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
  } catch {
    return;
  }
  let cleaned = 0;
  for (const pid of Array.isArray(pids) ? pids : []) {
    const name = processName(pid);
    if (!name.includes('node') && !name.includes('cloudflared')) continue;
    killPid(pid);
    cleaned++;
  }
  if (cleaned) console.log(`Cleaned up ${cleaned} leftover process(es) from a previous run.`);
  try { fs.unlinkSync(PID_FILE); } catch {}
}

function rememberPids() {
  const pids = [server, tunnel].filter(Boolean).map((c) => c.pid);
  try { fs.writeFileSync(PID_FILE, JSON.stringify(pids)); } catch {}
}

function line(char) {
  return char.repeat(64);
}

// Some browsers, Opera in particular, ship a VPN and a bandwidth limiter that
// quietly break peer-to-peer video. If a plain Chromium or Firefox is
// installed, open there rather than gambling on the system default.
// COOWATCH_BROWSER=default forces the system default back.
function preferredBrowser() {
  if (process.platform !== 'win32') return null;
  const choice = process.env.COOWATCH_BROWSER;
  if (choice === 'default') return null;
  if (choice && fs.existsSync(choice)) return choice;

  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
  const relative = [
    ['Google', 'Chrome', 'Application', 'chrome.exe'],
    ['Microsoft', 'Edge', 'Application', 'msedge.exe']
  ];
  for (const parts of relative) {
    for (const root of roots) {
      const full = path.join(root, ...parts);
      try {
        if (fs.existsSync(full)) return full;
      } catch {
        // unreadable path, try the next
      }
    }
  }
  return null;
}


// Opened once the address is known, so a double-click on the desktop shortcut
// lands you straight on the page. COOWATCH_NO_OPEN=1 skips it.
function openBrowser(url) {
  if (process.env.COOWATCH_NO_OPEN === '1' || process.argv.includes('--no-open')) return;
  try {
    if (process.platform === 'win32') {
      const browser = preferredBrowser();
      if (browser) {
        spawn(browser, [url], { stdio: 'ignore', detached: true }).unref();
        return;
      }
      spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
    }
  } catch {
    // no browser is not fatal; the address is printed above anyway
  }
}

function banner(url) {
  console.log('');
  console.log(line('='));
  console.log('  CooWatch is online');
  console.log('');
  console.log('  ' + url);
  console.log('');
  console.log('  Send that link to whoever is watching with you.');
  console.log('  Open it yourself at that address too, not localhost, so the');
  console.log('  invite button copies a link that works for them.');
  console.log('');
  console.log('  Keep this window open. Ctrl+C stops everything.');
  console.log(line('='));
  console.log('');
  openBrowser(url);
}

async function waitForServer(attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(HEALTH);
      if (res.ok) return true;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function startServer() {
  server = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: Object.assign({}, process.env, { PORT: String(PORT) })
  });
  server.on('exit', (code) => {
    if (shuttingDown) return;
    console.error(`\nThe server stopped (exit ${code}).`);
    stop(1);
  });
}

function startTunnel() {
  const named = namedTunnel();
  const args = named
    ? ['-y', 'cloudflared', 'tunnel', 'run', '--url', `http://localhost:${PORT}`, named.name]
    : ['-y', 'cloudflared', 'tunnel', '--url', `http://localhost:${PORT}`];

  console.log(named
    ? `Connecting the "${named.name}" tunnel...`
    : 'Opening a public address (first run downloads the tunnel, ~30s)...');

  tunnel = spawn('npx', args, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });

  let found = false;
  if (named && named.hostname) {
    // A named tunnel prints no URL, because it always has the same one.
    found = true;
    setTimeout(() => banner('https://' + named.hostname.replace(/^https?:[/][/]/, '')), 2500);
  }
  const scan = (chunk) => {
    const text = chunk.toString();
    if (found) return;
    const match = text.match(TUNNEL_URL);
    if (match) {
      found = true;
      banner(match[0]);
    }
  };

  tunnel.stdout.on('data', scan);
  tunnel.stderr.on('data', scan);

  tunnel.on('exit', (code) => {
    if (shuttingDown) return;
    if (!found) {
      console.error('\nCould not open the tunnel.');
      console.error('Check your internet connection, then try again.');
      console.error(`The app is still usable on this machine at http://localhost:${PORT}`);
      return;
    }
    console.error(`\nThe tunnel closed (exit ${code}). Restart with: npm run share`);
    stop(1);
  });

  tunnel.on('error', (err) => {
    console.error('\nCould not start the tunnel: ' + err.message);
    console.error('Make sure Node and npm are installed and on your PATH.');
  });
}

// On Windows, npx is a wrapper: killing it leaves the real cloudflared process
// running and the tunnel open. The whole tree has to go.
function killPid(pid) {
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
      return;
    } catch {
      // fall through to the plain kill below
    }
  }
  try { process.kill(pid); } catch {}
}

function killTree(child) {
  if (!child || child.killed) return;
  killPid(child.pid);
}

function stop(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  killTree(tunnel);
  killTree(server);
  try { fs.unlinkSync(PID_FILE); } catch {}
  setTimeout(() => process.exit(code || 0), 500);
}

process.on('SIGINT', () => {
  console.log('\nStopping...');
  stop(0);
});
process.on('SIGTERM', () => stop(0));

(async () => {
  reapPrevious();
  startServer();
  const up = await waitForServer();
  if (!up) {
    console.error(`The server never came up on port ${PORT}.`);
    console.error('Something else may be using that port. Try: PORT=3001 npm run share');
    stop(1);
    return;
  }
  startTunnel();
  rememberPids();
})();
