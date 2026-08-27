# Contributing to CooWatch

Thanks for taking a look. This is a small project and it intends to stay small,
so the bar for a change is that it makes watching something together with a
friend better.

## Running it

```bash
npm install
```

```bash
npm start
```

Then open http://localhost:3000. There is no build step, no framework and no
database — edit a file, reload the page.

To test with someone on another network:

```bash
npm run share
```

## Testing a change

Most of this app only misbehaves with two browsers talking to each other, so
open a normal window and a private window side by side. A single tab will not
show you a sync bug.

Before opening a pull request:

```bash
node --check server.js && node --check public/app.js && node --check public/sw.js
```

If you touched anything with permissions, reconnection or media, say in the
pull request what you actually ran through by hand. "Two windows, host picked a
file, guest saw it, pause synced" is worth more than a green checkmark.

## House style

- Plain JavaScript. No TypeScript, no bundler, no dependencies beyond `express`
  and `ws`. If a change needs a build step, it probably belongs in a fork.
- Comments explain **why**, not what. The code already says what.
- Match the file you are editing rather than your own preference.
- Keep the diff to the thing you are fixing.

## Things worth knowing before you dig in

**Playback sync is not a clock.** In file and screen modes the host captures
their own `<video>` and sends the frames. When the host pauses, frames stop, so
the picture freezes everywhere with no timestamp maths involved. Only YouTube
mode syncs a clock, because there each browser plays its own copy.

**Transceiver order is a contract.** The host offers video, then film audio,
then voice, in that fixed order, and both sides identify a track by its `mid`.
That is what lets the host pick a file after someone has already joined without
renegotiating. If you add a track, add it at the end.

**Mute and the playback lock are cooperative.** Audio goes peer to peer, so the
server cannot strip it out — a mute is an instruction the other browser obeys.
Chat, reactions, polls, votes, kicks and every host-only command *are* enforced
server-side, and should stay that way. Please do not move an enforced rule to
the client.

**Sessions live in memory.** Restarting the server clears them. That is a
deliberate trade for having no database; if you want persistence, it is a real
design discussion, not a patch.

## Reporting a bug

Include the browser, whether you were the host or a guest, which source you
were using (file, screen or YouTube), and what the other person saw. A sync bug
that only shows up on one side is the interesting kind, and the other side is
half the report.

## Media

Do not commit audio or video. `public/waiting-room.mp3` is deliberately
gitignored — anyone running the app supplies their own.
