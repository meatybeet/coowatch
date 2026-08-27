# CooWatch

Watch the same video, at the same second, with someone on the other side of the
world. Voice chat, text chat and emoji reactions on top.

No account, no database, no build step. One Node process serves everything.

## Quick start

You need [Node.js](https://nodejs.org) 18 or newer. That is the whole list.

```bash
npm install
```

Then, to watch with someone who is **not** on your network:

```bash
npm run share
```

That starts the app and opens a public HTTPS address for it, printing something
like `https://tidy-forest-1234.trycloudflare.com`. Send that link to whoever is
watching with you and open it yourself at that same address. Keep the window
open; Ctrl+C stops everything.

The tunnel is fetched automatically the first time (about 30 seconds) and cached
afterwards. Nothing is installed globally and no account is needed. The address
changes each run, so send a fresh link each time.

If you are both on the same network, `npm start` and http://localhost:3000 is
enough.

> **Why a tunnel and not just localhost?** Browsers refuse to hand over a
> microphone or a screen on a plain `http://` address unless it is localhost.
> The tunnel gives you real HTTPS, which is what makes the mic, screen sharing
> and the installable app work at all.

## Sending it to a friend

They do not need to know anything about the code. Send them the folder — a zip,
or the GitHub link — and tell them this:

**They need [Node.js](https://nodejs.org) 18 or newer.** Nothing else. No
account, no Docker, no database, no build tools.

Then, from inside the folder:

```bash
npm install
```

```bash
npm run share
```

That prints a public address like `https://tidy-forest-1234.trycloudflare.com`.
Whoever runs it is the host: they open that address themselves, tap the session
code to copy the invite link, and send it on.

Things worth telling them up front:

- **Open the printed address, not `localhost`.** The invite button copies
  whatever address the page is on, so from localhost they would send a link that
  only works on their own machine.
- **The address changes every run.** Send a fresh link each time.
- **Keep the window open.** Closing it ends the session. Ctrl+C stops cleanly.
- **The first run takes about 30 seconds longer** while the tunnel binary is
  downloaded. After that it is cached.
- **Wear headphones** if they are hosting a file, or the film's audio goes back
  out through their microphone as an echo.
- **The music file is not in the repository.** If you want them to have it, send
  the MP3 separately and tell them to save it as `public/waiting-room.mp3`. The
  app works fine without it.

If a tunnel is ever left running after a crash, the next `npm run share` finds
and closes it before starting a new one.

## Optional: waiting room music

Drop any MP3 at `public/waiting-room.mp3` and it loops on the home screen and in
a room with nothing playing yet. It stops as soon as a video is loaded and does
not come back when you pause mid-episode. The note button toggles it and the
choice is remembered per device.

It is deliberately **not** included in this repository — whatever you drop there
is most likely someone else's copyright. The app works fine without it: the
toggle simply hides itself.

Browsers refuse to start audio before the page has been interacted with, so on a
cold load it begins at your first click or key press rather than instantly.

Microphones start **muted**. Nobody is broadcast before they choose to be.


## Two ways to watch

**A file on your device** — you pick the video, the app captures it straight out of
the player and streams it peer-to-peer to whoever joined. Your friend needs nothing
but the link. When you pause, her picture freezes, because there are no more frames
to send. Costs your upload bandwidth (roughly 3-8 Mbit/s for 1080p) and your tab has
to stay open.

**A YouTube link** — you both load the same video and the app keeps the clocks
together. No upload, no bandwidth cost, works on any connection. Play, pause and
seek travel to everybody, and drift over 1.5 seconds is corrected automatically.

## Sessions

- **Private** — only people with the code or the invite link can get in.
- **Public** — shows up in the "Public sessions" list for anyone using the app.

Codes are six characters with no `0`, `O`, `1` or `I`, so they are easy to read out
loud. Tapping the code in a room copies the invite link.

A session outlives any one connection. Reloading keeps your seat, and a host who
leaves either hands the room over or ends it deliberately — see **Running a room**.

## Running it on one machine

```bash
npm start
```

Then open http://localhost:3000. `localhost` counts as a secure origin, so the
microphone and screen capture work there without HTTPS. Any *other* address
needs real HTTPS, which is what `npm run share` gives you.

## Deploying

The app has no build step and no database — one Node process serves both the API and
the PWA.

**Render** — push the folder to GitHub, then "New Web Service" and point it at the
repo. `render.yaml` is already set up (free plan, `node server.js`).

**Railway or Fly.io** — same idea; both read the `start` script from `package.json`.

**Anywhere with Docker** — a `Dockerfile` is included, listening on port 3000.

The free Render tier sleeps after inactivity, so the first load after a quiet spell
takes about thirty seconds. Sessions live in memory, so a restart clears them.

## Installing it as an app

Once it is on HTTPS, open it in Chrome on your phone and use "Add to Home screen",
or click the install icon in the desktop address bar. The shell is cached by a
service worker, so it opens instantly, but sessions obviously need the network.

## Things worth knowing

**Use headphones.** In file mode the movie's sound goes out through your speakers,
your mic picks it up and sends it back as an echo. Echo cancellation is on, but
headphones solve it properly.

**Browsers.** File mode needs `captureStream()`, so Chrome, Edge or Firefox on the
host side. Safari cannot host a file session; it can still join a YouTube one.

**TURN.** WebRTC usually connects two people directly, but some mobile and office
networks block that. `RTC_CONFIG` at the top of `public/app.js` falls back to a free
public relay. It is fine for testing but it is shared and sometimes slow — if calls
keep failing, put your own TURN credentials there (Metered, Twilio and Cloudflare
all sell one cheaply).

**File formats.** Browsers only decode a handful of containers. MP4 with H.264
video and AAC audio always works. MKV works sometimes, depending on the codecs
inside. `.ts`, `.m2ts`, `.avi`, `.wmv`, `.mpg` and friends never work — the app
says so and asks for another file rather than failing quietly.

Converting is quick, and for `.ts` it is almost always a straight copy of the
streams into a new container, so it takes seconds and loses nothing:

```bash
ffmpeg -i "episode.ts" -c copy -movflags +faststart "episode.mp4"
```

If that errors with something about the codec, the streams need a real re-encode,
which is slower:

```bash
ffmpeg -i "episode.ts" -c:v libx264 -crf 20 -c:a aac "episode.mp4"
```

A whole folder at once, in PowerShell:

```bash
Get-ChildItem *.ts | ForEach-Object { ffmpeg -i $_.FullName -c copy -movflags +faststart "$($_.BaseName).mp4" }
```

To get ffmpeg on Windows: `winget install Gyan.FFmpeg`, then open a new terminal.

**Group rooms.** Everyone hears everyone, but the video only ever comes from the
host, and the host uploads one copy per viewer. Two or three people is comfortable;
much more than that will saturate a home connection.

## Layout

```
server.js              signaling, session registry, public list
public/index.html      both screens: home and room
public/app.js          WebRTC, YouTube sync, chat, reactions
public/style.css
public/sw.js           service worker (app shell cache)
public/manifest.json
public/waiting-room.mp3    optional, not in git
share.js               one-command server + public tunnel
make-icons.js          regenerates the two PNG icons
```

## Running a room

The host owns the session. The panel button in the room header opens everything:

**Session rules** (host only)
- **Chat open** - turn it off and only the host can write.
- **Lock playback** - only the host can play, pause or seek.
- **Mute everyone** - silences the room. Anyone who muted *themselves* stays
  muted afterwards; the host can lift their own mute but not someone else's.

**Per person** (host only): mute for 30 seconds, mute indefinitely, unmute,
block or unblock the chat, hand over the host role, or remove them. Removing
someone bans their token, so they cannot walk straight back in.

**Polls** - the host asks a question with two to four answers. Everyone votes,
results update live, votes can be changed, and the host can close or clear it.

**Vote to remove** - any watcher can start a vote against another watcher. It
needs a majority of the people who can vote, runs for 60 seconds, and the host
is immune. It needs at least three watchers to be worth starting; below that
the host can simply remove someone.

**Asking to host** - a guest can request the role from the panel. The host sees
a badge and can accept or decline.

**Leaving** - when the host leaves with other people present, they choose
between handing the room to someone specific or ending it for everyone. If the
host vanishes without choosing, the room passes to whoever has been there
longest rather than dying.

## Reconnecting

Every member gets a token. Reloading the page picks the same seat straight back
up, and a dropped connection retries with a backoff before giving up. The
server holds a seat for 90 seconds after a socket dies, so a reload looks like
a blip rather than someone leaving; other people see them marked "Away".

One thing a reload cannot restore: **a local file**. Browsers will not re-open
a file without the user picking it again, so a host who reloads is asked to
choose the file once more. A YouTube session comes back completely, since only
the video id has to survive.

## Notes on what is and is not enforced

Muting is cooperative. The audio travels peer to peer, so the server cannot
strip it out - a mute is an instruction the other browser follows. That is the
right trade for watching with people you know, but it is not a security
boundary. The same goes for the playback lock. What *is* enforced server-side:
chat, reactions, polls, votes, kicks and every host-only command.

Sessions live in memory. Restarting the server clears them.

### Message protocol

Everything travels over one WebSocket as JSON with a `t` field.

| Message | Direction | Meaning |
| --- | --- | --- |
| `create` / `join` | client to server | enter a room |
| `joined` | server to client | your id, the room, who is already there |
| `peer-join` / `peer-leave` | server to client | membership changed |
| `signal` | relayed | WebRTC offer, answer or ICE candidate |
| `control` | broadcast | someone pressed play, pause or seek |
| `progress` | host to everyone | position, duration, paused, once a second |
| `source` | host to everyone | the video changed |
| `chat` / `reaction` | broadcast | text and emoji |
| `rejoin` | client to server | reclaim a seat with a saved token |
| `roster` | server to client | everyone, with their permissions |
| `config` | server to client | session rules changed |
| `host:*` | client to server | host-only commands, rejected from anyone else |
| `poll` / `poll:vote` | mixed | the current poll and its tallies |
| `votekick` / `votekick:vote` | mixed | an open vote to remove someone |
| `peer-offline` / `peer-reset` | server to client | drop or rebuild a media connection |
| `kicked` / `session-closed` | server to client | you are out, or the room ended |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Pull requests welcome.

## License

MIT - see [LICENSE](LICENSE).
