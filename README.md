# Brian's Aggravation

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

Milestones 9 through 11 synchronize the complete game through Firebase transactions, secure active room writes, restore games after refresh, and let the host restart a finished game. Local pass-and-play remains available from the home screen.

See [RULES.md](./RULES.md) for the frozen game rules.

## September 2026 experience update

- A warmer default table, responsive board, readable player cards, and a prominent local-play option. All five skins remain available.
- Visible turn instructions, numbered marbles, and large move buttons showing the exact die to spend. Board selection remains available.
- Local games save after each action; **Resume game** restores the current turn, including an unused die, after refresh or returning to the menu. One local save is kept per browser. Starting another local game asks before replacing it; ending a game clears it.
- **How to play** and **Settings** are available during play. **Quick play** skips 3D dice and move animations; device reduced-motion preferences apply to marble and decorative animation. Computer players wait between actions while either dialog is open.
- Press **R** to roll and **Esc** to clear a selection. Marbles and move choices also work with Tab and Enter/Space.
- Recent activity, saved names, explicit connection status, and a retry button for failed online sign-in.
- Dice values use unbiased Web Crypto sampling. The existing physics renderer animates those results; a static dice display keeps the game playable without WebGL.

There is still no build step or new dependency. `polish.css` contains the layout improvements and default-skin refinements; `styles.css` retains the original skins. Core movement rules remain unchanged; host turn skipping has been removed. Its legacy data field remains only for compatibility with existing online rooms and database rules.

Validation: `node --test` covers the existing rules, physical dice replay, themes, database boundaries, and saved-game validation. Browser checks cover local setup, computer turns, both die actions, refresh/resume, keyboard movement and rolling, in-game help/settings, all five skins, and phone/desktop layouts. Multi-browser online play still needs a live multiplayer check; no database rules or Firebase configuration were changed.
