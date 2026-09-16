# Moving Podcast Clipper to a new PC

The old way of copying this whole folder broke on a new machine because a few things
inside it are compiled specifically for *this* PC (Node version, CPU architecture) --
mainly the `pot-provider` native addon, the Python transcription environment, and
`yt-dlp.exe`. Copying those bytes doesn't work; regenerating them on the new machine does.

## On this (old) PC

Double-click **`export-for-new-pc.bat`**. It creates a clean copy at
`..\podcast-clipper-portable` containing your code, your clip database (`data/app.db`),
transcripts, and `cookies.txt` -- but *not* `node_modules`, `pot-provider`, `bin`, or the
Python venv (those get rebuilt fresh on the new PC instead of copied), and *not*
`sources/` (the downloaded podcast videos), to keep the transfer small.

Copy that `podcast-clipper-portable` folder to the new PC any way you like -- USB drive,
a synced Google Drive/OneDrive folder, etc.

## On the new PC

Requirements (install these once if not already present):
- [Node.js](https://nodejs.org) 22 or later
- [Python](https://python.org) 3.10 or later
- ffmpeg (`winget install --id Gyan.FFmpeg -e`), on PATH

Then inside the copied folder, double-click **`setup.bat`**. It will:
1. `npm install` the app's dependencies
2. Download `yt-dlp.exe`
3. Download, install, and compile the `pot-provider` (native addon rebuilt for this PC)
4. Create a Python virtual environment and install `faster-whisper` into it
5. Warn you if ffmpeg isn't on PATH

When it finishes, double-click **`start.bat`** to launch the app, same as before.

## What actually moved

`data/app.db` (every source you added, plus all clip timestamps/scores/hooks) and
`cookies.txt` (your exported YouTube cookies, used only when YouTube's bot-check kicks
in) move over. Everything else is regenerated.

The downloaded source videos themselves (`sources/`) do **not** move -- they're the
biggest thing in the folder and easy to refetch. Your clip timestamps and hook text will
still be there and visible in the app. But if you later want to actually export a clip
from one of those sources, the app needs that source's video file again, and it won't
auto-redownload one it thinks it already has: delete that source in the app first, then
paste its URL again to fetch it fresh.
