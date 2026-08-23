# Project Brian

A small, dependency-free web version of the marble board game for two to four players, using five marbles per player.

Live site: <https://austincoon.github.io/project-brian/>

## Run locally

The app uses native JavaScript modules, so serve it over HTTP rather than opening `index.html` directly.

From this directory, run either:

```powershell
python -m http.server 8000
```

or, on Windows when `python` points somewhere else:

```powershell
py -m http.server 8000
```

Then open <http://localhost:8000>.

No npm install or build step is required.

Run the browser-free checks with:

```powershell
node --test
```

## Firebase setup

The online lobby needs a Firebase project. The project owner must complete these console steps:

1. Create a Firebase project on the Spark plan and register a web app.
2. In **Authentication → Sign-in method**, enable **Anonymous**.
3. Create a **Realtime Database** and choose locked mode.
4. The registered web-app configuration is stored in `src/firebase.js`.
5. Copy `database.rules.json` into the Realtime Database **Rules** tab and publish it. The rules deny all unauthenticated access and constrain authenticated room changes.
6. Under **Authentication → Settings → Authorized domains**, add `localhost` for development. After GitHub Pages is deployed, add its domain there too.

Anonymous authentication is stored in local browser data, so refreshes and normal browser restarts preserve a seat. Clearing site data creates a new anonymous identity.

To test multiple players on one computer, use different browsers or separate browser profiles. Windows in the same browser profile intentionally share one identity.

## Current milestone

Milestones 9 through 11 synchronize the complete game through Firebase transactions, secure active room writes, restore games after refresh, support host skips, and let the host restart a finished game. Local pass-and-play remains available from the home screen.

See [RULES.md](./RULES.md) for the frozen game rules.
