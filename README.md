# Deskwork

A personal task manager for long-running **goals** (daily time budget, optional points) and one-off **tasks**, with timers, a resource library (books, videos, links) and a full history.

## Install (Homebrew)

```sh
brew install renhao-dev/deskwork/deskwork
brew services start deskwork
```

Starting it puts **Deskwork(chrome tab)** in Launchpad. Open it there (or go to http://localhost:5174 in Chrome), make your account, and click **Install app** in the top bar for its own window and Dock icon. From then on Chrome's Deskwork app is the Launchpad icon, and the first one removes itself.

- Your data is in `~/Library/Application Support/Deskwork/data`, encrypted with your password. There is no way to reset the password.
- Update: when a new version is out, an **Update** button shows up in the top bar (Deskwork looks every 5 minutes). Clicking it installs the new version and restarts Deskwork, so you sign in again. By hand: `brew update`, then `brew upgrade deskwork` and `brew services restart deskwork`.
- Stop or start the server: `brew services stop deskwork` / `brew services start deskwork`. Log: `$(brew --prefix)/var/log/deskwork.log`.
- Remove: `brew services stop deskwork && brew uninstall deskwork`, then drag `Deskwork(chrome tab)` from `~/Applications` to the Trash. The data folder stays until you delete it.
- If you also used `scripts/install-mac.sh`, run `scripts/install-mac.sh --uninstall` first: both serve on port 5174. They share the same data folder.

## Release

```sh
scripts/release.sh
```

It checks that the current commit is pushed and clean, shows what changed since the last release, asks for the new version (suggesting the next fix, feature or major number), then tags the commit and pushes the tag and follows the release run until it finishes. `scripts/release.sh --dry-run` goes through the questions without tagging anything. By hand, the same is `git tag -a v0.2.0 -m "Deskwork 0.2.0" && git push origin v0.2.0`.

`.github/workflows/release.yml` then tests and builds, installs the archive with Homebrew on a Mac to check it works, publishes the GitHub release, and updates the formula in [renhao-dev/homebrew-deskwork](https://github.com/renhao-dev/homebrew-deskwork). The version comes from the tag; `package.json` doesn't need bumping. To try the pipeline without publishing, run the workflow by hand from the Actions tab.

The formula is generated from `packaging/deskwork.rb.in`. The workflow pushes to the tap with a deploy key stored in the `TAP_DEPLOY_KEY` secret.

## Run it from source

Requires Node 24+.

```sh
npm install
npm run build   # build the web app once
npm start       # http://localhost:5174
```

On first start Deskwork asks you to make an account; that account is the admin and can add more users from the Users menu.

For development with hot reload: `npm run dev`, then open http://localhost:5173.

Other commands: `npm test` (timer and day-boundary tests), `npm run typecheck`.

## Install as a Mac app (Launchpad icon)

```sh
scripts/install-mac.sh
```

This sets up three things:

1. **A background server** (a macOS LaunchAgent) that starts when you log in and restarts itself if it crashes, so Deskwork opens instantly.
2. **Deskwork in Launchpad**, which opens Deskwork in a Chrome window.
3. Inside Deskwork, an **Install app** button in the top bar. Click it once and Chrome installs Deskwork as its own app, with its own window, Dock icon and Cmd+Tab entry. The next time you open the old Launchpad icon, it hands over to the installed app and removes itself, so only one Deskwork icon remains.

Good to know:

- The installed app runs from `~/Library/Application Support/Deskwork/app` and keeps its data in `~/Library/Application Support/Deskwork/data`, because macOS blocks apps from reading `~/Documents` without a privacy permission. On first install, data from the project's `data/` folder is copied there.
- After changing the code, run `scripts/install-mac.sh` again. It rebuilds and restarts the server.
- Stop the server: `scripts/stop.sh`. Start it again: `scripts/start.sh` (it also starts at your next login).
- Remove everything except your data: `scripts/install-mac.sh --uninstall`. To remove the Chrome app too, open Deskwork and choose "Uninstall Deskwork" from its window menu (⋮).
- Logs: `server.log` and `launcher.log` in the data folder.

From a terminal in the project folder, `scripts/deskwork.sh` runs a separate copy with the project's own `data/` (handy for development).

## Where data lives

When run from the project folder, everything is in `data/`: `deskwork.db` (SQLite) and `uploads/` (book PDFs and video files). Back up that folder to back up the app. Set `DATA_DIR` to keep it elsewhere, `PORT` to change the port, and `HOST=0.0.0.0` to allow access from other devices on your network (default is this machine only).

## How it behaves

- **Overtime:** crossing a goal's daily budget doesn't stop the timer. You get the notification and the completion form; "Keep going" leaves the timer running and it counts overtime (+12:30) until you complete or stop it. A goal whose budget is already spent can be started again, straight into overtime.
- **Taking back a completion:** completion is a checkbox: tick it to complete (the form asks for time, points and a comment), untick it to put the goal back on today's list and take its points back. A task reopens the same way. The checkbox sits in the goal window's header and on every goal and task row. You can also use the undo arrow on an entry in Completed today, or in a goal's Sessions tab. The goal returns to today's list and its points are given back; a task reopens. Logged time stays.
- **Correcting time while completing:** the completion form has a "Time spent" field, filled in with what's logged (including the running timer). Change it to correct the record, or set it to zero to log none. More time is added as time entered by hand; less trims the newest sessions.
- **Correcting today's time:** a goal's Sessions tab can edit or delete any logged session (⋯ menu) and "Add time" records work done away from Deskwork. Totals, budgets and the day's completion figure follow along.
- **Only one timer at a time.** The timer is stored as timestamps, so it keeps counting through closed tabs and server restarts. When a goal's daily budget runs out, the completion form appears, even if that happened while the app was closed.
- **Your data is encrypted with your password.** Each account has its own vault file
  (`vault-<id>.db`), encrypted with SQLCipher. A random key encrypts the contents; that key is
  itself locked with a key derived from your password (scrypt), so changing your password rewraps
  32 bytes and never re-encrypts your notes. The shared `deskwork.db` holds only accounts and
  sessions.
  - **Signing in is what unlocks it**, including after a restart — the key lives in memory and
    nowhere else. A valid session isn't enough; Deskwork will ask for the password again.
  - **Signing out deletes the session and wipes the key**, so the data is sealed until you return.
  - **Nobody can read or reset someone else's account**, admins included. There is no password
    recovery: a forgotten password means the data is gone. Deleting an account deletes its vault.
  - Uploaded files (PDFs, pasted screenshots) are *not* yet encrypted — they live under
    `data/uploads/<user id>/`.
- **Days start at 04:00** by default, so late-night work counts toward the previous day. Change it in Settings.
- **Goals** come back every day until archived. Reaching the points target asks whether to archive.
- **When a task is due:** a task with a day shows a chip under its title: **Today** in brass, **Yesterday** or **3 days late** in red, **Tomorrow** or a date like "Mon, Oct 12" in grey. Undated tasks show nothing.
- **Today first:** tasks due today sit in their own **Today** section at the top of the Tasks window, with everything else under **Other tasks**.
- **Tasks** count time up. Completing one removes it from the dashboard; it stays in Manage → Tasks and in History.
- **Resources** are attached to goals or tasks and remember your position per goal:
  - PDFs open in the browser at the saved page.
  - YouTube videos and uploaded video files play in the Player window and save your position every few seconds. The first time you press play during a timer session, you choose whether the video should follow the timer (pause on breaks, pause and stop).
  - Physical books and other video sites: you enter where you stopped in the completion form.
- **Notifications:** Deskwork sends a system notification when a goal's time budget is used up ("Time budget crossed!"), and optionally when Pomodoro breaks start and end. Chrome asks for permission the first time you start a timer. Deskwork has to be open (minimized is fine). Settings has the switches and a test button.
- **Resource folders and search:** Manage → Resources has nested folders and a search box (title or author; ignores case and accents). A folder shows its subfolders first, then what's directly inside it; counts include everything nested. Drag a resource or folder onto a folder (in the sidebar, the list, or the path at the top) to move it there; drop on "All resources" to move it to the top level, or a resource on "No folder". Hovering over a closed folder while dragging opens it. Each folder's ⋯ menu also has New subfolder, Rename, Move to and Delete. Deleting a folder keeps its contents: its subfolders and resources move up one level. Searching looks in every folder and shows each result's folder path. The Attach picker in a goal's details has the same search and folders.
- **Start asks what to work from:** the Start dialog lists the goal's resources (suggesting the one used last). A video opens in the player and plays from your spot; a PDF or link opens; a physical book is just counted as used. For a video you choose whether it pauses along with the timer; that's remembered per goal and video and can be flipped in the player ("Synced with timer").
- **Video start and what you used:** positions are kept per goal and video. "Set start" (in the player, or next to the video in a goal's details) lets you skip what you already watched without tracking; it accepts `42:17`, `1:05:00`, `90m`, `1h5m`, a bare number of minutes, or a YouTube link with `&t=`. The Work log lists the resources each session used: videos with the range watched (a start set by hand isn't counted as watched), books with the page range from the completion form, and PDFs or links as "opened".
- **Order of goals and tasks:** drag goals or tasks up and down in their window (or Alt+↑/↓ on a focused row). The order is saved; tasks move within their own section, items not shown today keep their places, and new ones go to the bottom.
- **Wiki:** a knowledge base divided into spaces, in the **Wiki** window (top bar). Spaces on the left; pick one to see its pages and read or write in any of them, with the same editor as notes — Markdown, pasted screenshots, and everything the book reader can send into a page. **New page** writes straight into the space you're in. Spaces a goal has never filled stay out of the way behind "Show N empty goal spaces".
- **Trash:** a space's deleted pages sit behind a **Trash (n)** link under its page tree, which appears only when there's something in it. Restore a page, delete one for good, or empty the lot; anything left is deleted automatically after 30 days, with its images. A restored page whose parent was deleted too comes back under the space's home page rather than vanishing. (A goal's Notes tab has the same link, for notes written from that goal.)
- **New space** sits at the bottom of the wiki's sidebar when you're looking at the list of spaces: name it and it opens, ready to write in. (Manage → Spaces still has the full list, with rename, icon, archive and delete.)
- **Every space has a home page**, made with the space and named after it, and every other page in the space sits under it — the way a Confluence space works. Opening a space opens its home page. It can't be dragged, filed under another page, or thrown away; rename the space and it follows.
- **Pages nest:** a page is also a folder. Drag one onto another to file it inside, or between two to make it their sibling; a page with children shows a ▸ you can collapse, and a count of what's hidden. Alt+↑/↓ moves a page among its siblings and Alt+←/→ changes how deep it sits. Breadcrumbs above the page show where it is, and **Subpage** adds one filed under it. Moving a page takes everything under it along.
- **Links:** type `[[` in any note or page and pick what to link to — another page, a goal, a task or a book. It becomes an ordinary Markdown link, so the note stays plain text, and clicking it opens that thing. The link carries an id, not a name, so **renaming never breaks it**: a renamed goal reads under its new name wherever it was linked.
- **Opening a linked book:** a `[[` link to a book opens it in the reader, wherever you click it. From a goal's note, or a page in a goal's space, your place in the book still moves and the reading still counts toward that goal; from a space of your own it simply opens. In the wiki's own window — which has no desk to put a reader on — a book opens in its own window, and a goal or task link opens the desk.
- **Mentioned on:** every page, goal and task shows the pages that link to it, at the bottom of the page and in a goal's Overview. Nobody writes that list — it's the links read backwards, so a page gathers its own index of where it comes up. A page in the Trash stops counting as a mention.
- **Search:** the box at the top of the wiki's sidebar searches every page — titles and text — ranked, with the matching words highlighted in a snippet and the page's space and position shown under its name. Inside a space it searches that space, with **Search every space instead** one click away. Results narrow as you type (the last word matches as a prefix), accents are ignored, and other scripts work. Only the words are indexed, so Markdown punctuation and link addresses never count as matches, and pages in the Trash stay out.
- **A page has an address:** `/wiki/linear-algebra/eigenvalues-42`. Paste one into any browser on this Mac and it opens that page; back and forward work and a page can be bookmarked. The id at the end is what finds it, so renaming a page never breaks a link.
- **A note is a page:** a note's header links to the goal it was written from *and* to the wiki. Click **In the wiki** to show the page in the Wiki window; its ⋯ menu also has **Open in its own window**.
- **Wiki in its own window:** **Own window** in the Wiki title bar opens the whole wiki full-screen in a separate Chrome window, for a second screen. Editing in one window updates the other straight away.
- **Spaces:** every goal has a space — a container for pages, created with the goal and named after it. A note written from a goal goes there, so nothing ever has to be filed while you work. Manage → Spaces shows the spaces you made yourself; tick **Show N goal spaces** for the rest, each marked "Goal space". Rename, give one an emoji, archive the ones you've finished with, or delete an empty one. Notes written on tasks share a single **Tasks** space.
- **A space outlives its goal:** archiving a goal leaves its space alone, and *deleting* a goal now keeps its pages too — they stay in the space, which simply stops pointing at a goal. (Before spaces, deleting a goal deleted its notes.)
- **Windows stay on the desk.** On a narrow display the goal window and the book reader go full screen *below* the top bar rather than over it (the bar's height is measured, since it grows as it wraps). A window can't be opened, dragged, resized or left by a change in the app window's size anywhere that puts part of it off the desk — in particular above it, where its title bar would hide under the top bar and be impossible to grab. If one ever does end up outside (a stylesheet, a stale saved position), it's measured, moved back to the middle of the desk and saved there.
- **Stuck windows:** the user menu has **Tidy windows**, which forgets saved positions and puts every window back where it started.
- **Goal window:** clicking a goal or task anywhere opens it in its own desk window, with Overview (details and resources), Sessions (every timer run by day, with totals, completions, and what each session used; click ▸ to expand) and Comments. One is open at a time; the back arrow returns to the previous one. Every desk window can be maximized to the whole area under the top bar (button, or double-click the title bar) and restored.
- **Floating window:** the timer (button in the timer bar) and the Notes window (button in its title bar) can float above other apps in a small always-on-top window, handy while you work in another program. Chrome allows one at a time, so opening one closes the other. Not available in browsers without document picture-in-picture.
- **Book reader:** PDFs open inside Deskwork (a window you can move, resize and maximize) and fit the window's width by default, with a Fit button and zoom in the toolbar, and page tracking that saves your place and counts as reading in the session log. Select text and right-click for three ways to send it to the note you have open: plain text, text with a page link, or a quote with the book's title. Page links in notes reopen the book at that page. "Browser viewer" opens Chrome's own viewer for printing.
- **Notes:** a goal's (or task's) Notes tab lists its notes; New note opens it in the Notes window, which has a tab per open note and can be maximized. The editor shows formatting as you type and stores Markdown; `#`, `-`, `1.`, `[]`, `>` and ``` work as shortcuts, and screenshots can be pasted or dropped straight in. Notes save themselves about a second after you stop typing; if the server is down the text is kept in the browser and saved when it's back. Deleting moves a note to the goal's Trash (with Undo); the Trash is emptied automatically after 30 days, or by hand.
- **Server down:** the page shows "Server offline" and reconnects on its own. Nothing is lost.
