# Personal Assistant

> 🧑‍💼 **About this chapter** — Set up and use Fello's built-in personal assistant: create assistants, choose their source model and MCP servers, keep reminders, consolidate memory, and hand long jobs to background Workers.

A personal assistant lives inside Fello and belongs to no project. It keeps its own workspace, long-term memory, diary and reminders, so you do not have to restate the context every time. It can also hand long-running work to background sub-agents.

---

## Before You Start

A personal assistant needs an **enabled API Agent** as its source model. Stdio Agents are not supported.

1. Open **Settings → Agents** and make sure an OpenAI-compatible API Agent is added and enabled (DeepSeek, Kimi, OpenAI, etc.).
2. Open **Settings → Personal Assistant** and turn on **Enable Personal Assistant**.
3. In the sidebar, find the **Personal Assistant** section and click the **add** button.
4. Enter a name, choose the source Agent and MCP servers, then click **Create**.

You are taken straight to the assistant page. Each assistant is one row in the sidebar, fixed above the project list. Turning the global switch off hides the whole section.

> 💡 You can create several assistants, for example "Work" and "Writing". They have independent chats, memory, reminders and Workers, but share the worker types configured in Settings.

---

## Page Overview

The assistant page mirrors the session layout:

| Area | Purpose |
|------|---------|
| Chat column | Talk to the assistant, inspect tool calls, answer Ask User questions |
| Right panel | **Calendar** (reminders and diary), **Files** (assistant workspace), **Workers** |
| Detail column (on demand) | Open a file, diary entry, memory, or a Worker's read-only transcript |

The header shows the assistant name and status (Ready / Connecting / Dreaming…). On the right: read-aloud controls, the context usage button, **assistant configuration** (gear), and the panel toggle.

The model and thinking-level selectors sit at the bottom right of the input box. `Auto` uses the model default; `Max` / `High` / `Low` map to the corresponding reasoning effort.

> 💡 The assistant input is text-only and does not accept attachments. To work with a file, give it the path, or put the file in the assistant workspace and ask it to read it.

---

## Configuring an Assistant

Click the **gear** at the top right of the chat column:

| Setting | Meaning | When it applies |
|---------|---------|-----------------|
| Assistant ID / Workspace | Locate data and files; opens the folder | — |
| Source agent | The API Agent used by the assistant | After **Restart Assistant** |
| MCP servers | External tools available to the assistant | After **Restart Assistant** |
| Dream → Max tokens | Context size that forces a memory consolidation | After **Restart Assistant** |
| Dream → Preferred time | Daily time for scheduled consolidation | After **Restart Assistant** |

Name and enable/disable are not here: right-click the assistant in the sidebar to rename or disable it. Those changes apply immediately.

> ⚠️ After changing the source Agent, MCP servers or Dream settings, click **Restart Assistant** at the bottom. Editing the form alone does not write the configuration.

---

## Everyday Use

- **Just ask** — the assistant can plan, write, analyse, research and work with files. It knows its workspace and resolves relative paths there by default.
- **Reading files** — give an absolute path, or put the file in the assistant workspace. It can read any file on the computer, but writing into its own runtime directories is refused.
- **Writing outside the workspace** — the assistant is instructed to ask you first, usually through an Ask User dialog.
- **Deleting files** — only files inside the assistant workspace can be deleted. On the desktop they go to the system trash and can be restored; on a headless server the deletion is permanent.
- **Sharing results** — ask the assistant to write a file and share it with `share_to_user`. The result appears in the **Files** panel and can be previewed there.
- **Reminders** — say "remind me to send the weekly report tomorrow at 3pm" or "remind me to check email every weekday at 9am". Reminders arrive as chat messages and also raise a system notification.
- **Looking back** — ask "what did we talk about last week" or "what was the project codename I mentioned". The assistant searches its diary to answer.

> 💡 Reminders are injected as app events, not as new user messages. If a reminder is delivered late because the assistant was busy, it is marked as a retry and still delivered only once.

---

## Calendar, Diary and Memory

The **Calendar** tab shows, for each day:

- **Reminders** — one card per trigger time, with a countdown, triggered or past state, and a `Now` divider.
- **Diary** — diary entries covering that day. Click one to read it in the detail column.

**Memory** is opened from the context usage button:

- Click the **usage button** above the input → **View Memory** to read `memory.md`.
- The same menu contains **Dream now** for a manual consolidation.

---

## Dream (Memory Consolidation)

Dream is how the assistant consolidates context: it turns the current conversation into a diary entry, updates long-term memory, and then clears the model-visible history. The chat transcript in the UI stays.

### When It Runs

- **Context limit** — when history plus the system prompt reaches **Max tokens** (default 96,000), it runs right after the current turn; if it is still running before your next message, the assistant waits for it.
- **Daily schedule** — once new conversation reaches about 8,000 tokens, it runs at **Preferred time** (default 02:00).
- **Manual** — open the usage menu → **Dream now** and confirm.

A manual run only requires the assistant to be connected, idle, have a model, and have history. It does not require the token threshold.

### What Happens

1. The assistant reviews the conversation and writes a diary entry (summary, timeline, facts, decisions, commitments, preferences, open questions).
2. It rewrites long-term memory (facts, preferences, open commitments, ongoing context).
3. The diary goes to `memory/diary/`; memory goes to `memory/memory.md`.
4. Model history is cleared; later turns continue from memory.

> ⚠️ Dream clears the model-visible history. The UI transcript remains, but the assistant no longer re-reads the old conversation word by word — it relies on memory and diary. Make sure anything important is clearly stated before running it.

### If It Fails

If the model returns an invalid structure, a dismissible error appears below the chat header. Dismissing it also clears the backend state, so it does not reappear when you leave and return. A failure does not loop on the same target: the next scheduled run is armed instead, and if the context is still over the limit it will try again after the next turn.

---

## Workers (Background Sub-agents)

A Worker is a background ACP agent the assistant can drive. It is a good fit for reading many files, writing long documents, or research and coding jobs that take a while. The assistant decides when to delegate; you can also say "give this to a Worker".

### Configure Worker Types First

Open **Settings → Personal Assistant → Worker types** and click **Add worker type**:

| Field | Meaning |
|-------|---------|
| Name | Display name, e.g. `Coder`, `Researcher` |
| Description | Tells the assistant when to use this type |
| Agent | Agent used by the Worker (Stdio or API) |
| Model | Leave empty for the Agent default |
| Permission | `Ask`: the assistant decides on tool calls; `Allow all`: allow automatically |
| Instructions | Role instructions appended to every Worker task |
| Features / MCP | Fello features and MCP servers available to the Worker |

All assistants share these types. A type is visible to the assistant only when it is enabled, has an Agent, and that Agent is enabled. If no type is available, the assistant gets no Worker tools and does everything itself.

> 💡 Existing Workers keep the type snapshot they were created with. Editing or deleting a type does not affect Workers that already exist.

### Using a Worker

Describe the job in chat, for example:

- "Turn the meeting notes in this folder into a weekly report under `reports`."
- "Ask Coder to fix the bug in this script and tell me which files changed."
- "Research these links and write a comparison document."

The assistant will:

1. Pick a matching Worker type and create a background session.
2. Hand over the whole task in one self-contained brief (the Worker cannot see your conversation).
3. Return to the chat immediately; the Worker runs in the background.
4. Receive an event when it finishes or fails and report back to you.
5. When a permission is requested, decide harmless operations itself and ask you first if the action could affect files or commands outside the Worker workspace.

The **Workers** tab shows status, type, Agent / model, workspace and turn count. **View chat** opens a read-only transcript; on the desktop, the folder and path buttons locate it in Finder.

When a Worker is done:

- **Close (`worker_close`)** releases the process but keeps the record and transcript. The next task reconnects it.
- **Terminate (`worker_terminate`)** deletes the Worker record and transcript, but **never its workspace files**. Files inside the assistant workspace can be removed with `fs_delete`; anything outside is yours to clean up.

> ⚠️ A normal app exit cancels running Workers. After a crash, the next start marks them `interrupted`; they do not resume automatically. Ask the assistant to inspect the status and continue if needed.

---

## Data and Privacy

Each assistant keeps its data on your machine:

```text
~/.fello/assistants/<assistant_id>/
├── config.json
├── session/          # model state and history
├── chat/             # UI transcript
├── memory/           # memory and diary
├── reminders/        # reminders
└── workers/          # Worker records and transcripts
```

The assistant workspace is:

```text
~/.fello/workspaces/__assistant__<assistant_id>__/
```

Use **Assistant Folder** / **Workspace Folder** in the assistant configuration to open them.

- The assistant **never** writes into its own runtime data (`session/`, `chat/`, `memory/`, `workers/`, `reminders/`).
- Deleting an assistant also deletes its data directory and workspace. This cannot be undone.
- The assistant can use the MCP servers you selected; their credentials remain in global settings.
- The assistant's reasoning and replies are sent to the API provider you chose; what leaves your machine depends on that provider's privacy policy.

---

## Troubleshooting

**Clicking Add Assistant jumps to Agents settings?**  
There is no usable API Agent yet. Add and enable an OpenAI-compatible API Agent in Settings → Agents first.

**The assistant stays Unavailable or shows a configuration error?**  
Check that the source Agent is enabled and that its API key / base URL are correct, then click **Restart Assistant** in the assistant configuration.

**Changed MCP servers but the assistant still cannot use them?**  
MCP changes require **Restart Assistant**.

**Why did the assistant forget the recent conversation?**  
A Dream may have just run. It now relies on `memory.md` and the diary; open **View Memory** to check. You can also add missing facts by telling it explicitly.

**Why did the assistant hand the job to a Worker?**  
Long jobs, broad reading or long documents are delegated for reliability. You can say "do it yourself, no Worker", or adjust the Worker type descriptions to influence the choice.

**A Worker shows Interrupted?**  
It was still running when Fello exited. Ask the assistant to inspect it, or tell it to continue; the Worker reconnects and resumes the same ACP session.

**A reminder did not appear?**  
Check that the assistant is enabled and Fello is running. One-time reminders missed while the app was closed are not replayed; recurring reminders continue at the next trigger time.
