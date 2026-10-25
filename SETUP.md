# LOQUITUR: setup

Everything is in this one folder:

| File | What it is |
|---|---|
| `index.html` | The app. Open it in Chrome, Safari or Firefox. |
| `loquitur-server.js` | The agent server, which lets Claude (or another AI agent) use LOQUITUR's tools and keeps the app in sync. |
| `prompts.js`, `providers.js`, `store.js`, `sync.js` | Parts of the agent server. Keep them next to `loquitur-server.js`. |
| `package.json`, `package-lock.json` | The list of packages the server needs. |

Keep the folder somewhere permanent, such as your Desktop or Documents, before you set it up. The setup below points at its location.

## 1. Use the app (no setup)

Double-click `index.html`. Enter your own AI key (Gemini, Claude or OpenAI) and you're in. Your data is saved in your browser.

## 2. Connect the agent server (optional)

This lets you ask Claude things like "add an assignment to Torts due Friday" or "quiz me on my weak areas", and makes those changes show up in the app.

1. Install Node.js 18 or later from https://nodejs.org (the LTS version).
2. Open Terminal, go to this folder, and install the packages:

   ```bash
   cd "path/to/this/folder"
   npm install
   ```

   Tip: type `cd ` and drag the folder into the Terminal window to fill in its path.

3. Find the full path of the server file, which you'll need below:

   ```bash
   pwd
   ```

   Add `/loquitur-server.js` to the end of what it prints, e.g. `/Users/you/Desktop/Loquitur for partner/loquitur-server.js`.

4. Connect it to Claude.

   **Claude desktop app:** open Settings → Developer → Edit Config, and add this to `claude_desktop_config.json` (merge it into `mcpServers` if that's already there):

   ```json
   {
     "mcpServers": {
       "loquitur": {
         "command": "node",
         "args": ["/full/path/to/loquitur-server.js"]
       }
     }
   }
   ```

   If Claude can't find `node`, use its full path instead: run `which node` in Terminal and use what it prints.

   **Claude Code:**

   ```bash
   claude mcp add loquitur --scope user -- node "/full/path/to/loquitur-server.js"
   ```

5. Quit and reopen Claude. Ask it "what's my Loquitur status?" to check it's connected.

## 3. Sync between the app and Claude

Nothing to set up. While Claude is open, the server shares your data with the app at `http://127.0.0.1:47811`. Courses, assignments, quiz scores and billable time added in either place show up in the other within about 5 seconds.

- The first time the app connects, it combines what's in the app with what Claude has.
- When Claude is closed, the app keeps working on its own and catches up next time.
- Your data is saved in `~/.loquitur/state.json` (Claude's side) and in your browser (the app's side). Nothing is sent anywhere else, apart from your AI requests to the provider you chose.
- If you make changes in both places while Claude is closed, they're merged item by item. A deletion can come back in that case; just delete it again.

## Optional: let the server call the AI itself

By default the server hands its AI tasks to Claude, so it needs no key. To have it call a provider directly instead, add these to the config above:

```json
"env": { "LOQUITUR_PROVIDER": "gemini", "LOQUITUR_API_KEY": "your-key" }
```

`LOQUITUR_PROVIDER` can be `gemini`, `claude` or `openai`.

## Example requests for Claude

- "Add Civil Procedure, Mon/Wed 9:00 to 10:15 in Room 214, then show my weekly schedule."
- "Give me an MBE quiz on Torts focused on my weak areas." (Answer it, then: "Grade it.")
- "Fix this cite: International Shoe v. Washington 326 US 310 (1945)."
- "Log 47 minutes on the Smith clinic matter for research, then export my hours."
