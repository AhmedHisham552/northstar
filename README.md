# Waypoint

**A goals pane for Claude Code, driven by `/track`.** Keep the few things you want to get done beside the chat, see what you are working on *now*, tick sub-tasks as you go, and get your standup or weekly review written for you from what actually happened.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-d97757)](https://docs.claude.com/en/docs/claude-code/plugins)

```
◎ Waypoint · Goals        0/4
──────────────────────────────
FOCUS                      2/4
◑ #3 Ship onboarding guide
   ✓ 3.1 Outline
   ✓ 3.2 First draft
   ○ 3.3 Screenshots
   ○ 3.4 Review

MY-APP
○ #6 Fix flaky login test    0%

GENERAL
◕ #2 Prepare demo            3/4

▸ OTHER-REPO                 2
```

## Quick start

```
/plugin install waypoint --marketplace AhmedHisham552/waypoint
```

Answer `y` to add the marketplace, then pick **user** scope so the pane is there in every project. Then:

```
/track add @here Ship onboarding guide; Fix flaky login test
/track sub 1 Outline; First draft; Screenshots; Review
/track focus 1
```

## Features

- **Side pane** that stays beside the chat, about 32 columns wide.
- **Focus.** One goal is in *FOCUS*: it sits on top with its sub-tasks, and the hint line under the prompt keeps it in view, faded.
- **Hands-off updates.** Claude sees your open goals with each prompt. When you start talking about another goal, it switches focus. When its work finishes a sub-task, it ticks it. A toast tells you, with a one-line undo.
- **Live progress.** Whatever is being worked on spins in the pane (`⠹ 3.2 Screenshots`) until it's ticked. Claude and its agents mark sub-tasks as they start them.
- **Sub-tasks** with a goal's progress worked out from them. Progress shows as a filling circle `○ ◔ ◑ ◕ ✓`.
- **Labels per repo.** Goals added with `@here` belong to the repo you are in, and every worktree of that repo shares them. Other repos' labels show as one header line you can click to open. Untagged goals are **General**.
- **Change log.** Adds, ticks, progress, focus and removals are recorded with their time and an optional note.
- **Summaries.** `yesterday`, `today`, `week` or any date range, as an exact log plus a short update ready to paste into Slack or a standup thread.
- **Work on goals from one session.** `/waypoint:work 1 3` has Claude gather context and ask you everything up front. Once you confirm, it dispatches one background agent per goal, with progress ticking into the pane as they finish.
- **Ask about your log.** Claude answers "what did I do this week?" from your log.

## Usage

| Command | What it does |
| --- | --- |
| `/track add A; B` | Add goals to General (`add` is optional) |
| `/track add @here A` | Add a goal to the repo you are in |
| `/track add @label A` | Add a goal to any label |
| `/track sub 3 A; B` | Add sub-tasks to goal #3 |
| `/track tick 3.2 "note"` | Tick (or untick) sub-task 3.2, with an optional note |
| `/track 3 60 "note"` | Set progress of a goal without sub-tasks |
| `/track done 3` | Mark goal #3 done |
| `/track rm 3` / `rm 3.2` / `rm 5, 6, 3.2` | Remove goals and sub-tasks, one or many |
| `/track focus 3` / `focus off` | Set or clear the FOCUS goal for that goal's label |
| `/track start 3.2` / `stop` | Mark work in progress: it spins in the pane until ticked or stopped |
| `/track tag 3 @label` | Move a goal to a label (`@general` to clear) |
| `/track @label` | Open or close another label in the pane (or click its header) |
| `/track yesterday` / `today` / `week` | Summary for that period |
| `/track from 2026-11-01 to 2026-11-15` | Summary for any date range |
| `/waypoint:work 1 3` | Plan and dispatch work on goals #1 and #3 (see below) |
| `/waypoint:work 2.4 2.5 workflow` | Work on chosen sub-tasks only, run as workflows |
| `/track done-list` | List finished goals |
| `/track` | Open the pane and show help |

Goal numbers (`#3`) are permanent: they never shift when other goals are added or removed. Sub-tasks are `goal.sub` (`3.2`).

In the pane, a goal row sets focus and a sub-task row ticks it, by click or keyboard.

**Ask Claude** in plain words: "add a goal to review the PR for this repo", "tick the screenshots sub-task", "write my standup". Claude uses the plugin's `update_goals` tool, which takes the same commands.

## Working on goals

`/waypoint:work <n|n.m> … [agents|workflow]` (a skill that ships with the plugin) turns this session into an orchestrator. Pass whole goals (`1 3`), chosen sub-tasks (`2.4 2.5`), or both:

1. **Align.** Claude reads what it can from the code, docs and tools, adds sub-tasks to any goal without them, then asks you every question it needs answered, in one message.
2. **Dispatch.** Once you confirm, it starts one background agent per goal, or one workflow per goal with `workflow` (or the `dispatch` setting), each with a self-contained brief. Each agent ticks its sub-tasks in the pane as it finishes them, and stops to report a question rather than guess.
3. **Report.** As agents finish, Claude gives you each result in a few lines and brings you any question raised, then re-dispatches with your answer.

## Standups and weekly reviews

`/track yesterday` (the last *working* day):

```
Tue 17 Nov
PLANNED     4 goals open, focus: Ship onboarding guide
DONE        ◑ Ship onboarding guide  2/4
              ✓ First draft
            ✓ Fix flaky login test
MOVED       ◔→◑ Prepare demo  1/4 → 2/4
STILL OPEN  Migrate settings page

POST
Yesterday I finished the first draft of the onboarding guide and sent it
for comments, and fixed the flaky login test. The demo is halfway there.
Today I'll add screenshots to the guide.
```

- **PLANNED:** goals open at the start of the period, and what was in focus.
- **DONE:** goals finished in the period, and finished sub-tasks under their goal. Each counts once, by its last state. Notes are left off screen but go into the post.
- **MOVED:** goals that made progress but are not finished.
- **STILL OPEN:** goals that did not move.
- **POST:** a short update written by a small Claude model from the log above, and only from it: a standup update for a day, a short review for `week` and date ranges.

`week` and date ranges group everything by label.

## How it works

- **Files.** Everything lives in one folder (default `~/.waypoint`; an install from before the rename keeps reading `~/.claude-goals`):
  - `goals.json`: the current goals.
  - `log/YYYY-MM.jsonl`: one line per change, one file per month.

  Plain files, so you can back them up, sync them or grep them. They survive reinstalling the plugin.
- **Labels.** `@here` resolves to the folder name of the repo's main checkout (`git rev-parse --git-common-dir`), so worktrees share a label. Outside git it is the current folder's name.
- **Focus.** One FOCUS goal per label. A session shows the focus of its repo's label, or General's when that label has none.
- **Finished goals** stay in the pane, green, on the day they were finished, then leave it. They stay in the log, the summaries and `/track done-list`.
- **Two sessions at once.** Each change re-reads the files before writing, so one session doesn't wipe another's goals. Every open pane picks up changes from other sessions within a few seconds. In the rare case two sessions write in the same instant, one log line can be lost.

## Configuration

Run `/plugin`, open **waypoint**, and set:

| Option | Default | What it does |
| --- | --- | --- |
| `dataDir` | `~/.waypoint` | Folder for `goals.json` and `log/` |
| `workWeek` | `sun-thu` | Working days for `yesterday` and `week` (`sun-thu` or `mon-fri`) |
| `autoUpdate` | on | Claude may switch focus and tick sub-tasks on its own from the conversation |
| `dispatch` | `agents` | How `/waypoint:work` runs each goal: `agents` (lighter) or `workflow` (more thorough, uses more agents) |

The pane docks beside the chat in the fullscreen layout on a terminal at least 110 columns wide. To have that in every session, with no flag to remember, add this to `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_NO_FLICKER": "1" } }
```

Otherwise it shows above the prompt. Run `/track` once: from then on the pane docks by itself from 110 columns (144 before you have opened it). Drag its edge to resize it; your width is kept.

## Data and privacy

Your goals and log are stored on your machine, in `dataDir`. Two things go to Claude, as part of your normal Claude Code usage:

- **With `autoUpdate` on:** your open goals and sub-tasks are attached to each prompt you send, so Claude can keep them current. Turn `autoUpdate` off to stop this.
- **When you ask for a summary:** the summary log is sent to a small Claude model to write the POST.

## Troubleshooting

- **The pane is not beside the chat.** Use the fullscreen layout (above) and a terminal at least 110 columns wide, or open the pane with `/track`.
- **The circles look misaligned.** Some fonts draw `◔ ◑ ◕` at a different width. Please open an issue with your terminal and font.
- **My v0.1 goals are gone.** v0.2 imports them once, on its first start, into the `dataDir` set at that moment. If you changed `dataDir` later, move the files from the old folder into the new one.

## Development

```
git clone https://github.com/AhmedHisham552/waypoint
cd waypoint
claude --plugin-dir .        # run it from this folder
claude plugin validate .
claude plugin test .
```

The code is a Claude Code hooks module in `hooks/`. `register.tsx` wires the events, and the logic is in plain modules: `model.ts`, `parse.ts`, `store.ts`, `label.ts`, `summary.ts` and `view.tsx`, each with a `*.test.ts` beside it.

## Contributing

Issues and pull requests are welcome. Please run `claude plugin validate .` and `claude plugin test .` before opening a pull request, and update this README when you add or change a command.

## License

[MIT](LICENSE)
