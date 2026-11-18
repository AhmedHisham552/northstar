# goals

**A goals pane for Claude Code.** Keep the few things you want to get done beside the chat, see what you are working on *now*, tick sub-tasks as you go, and get your standup or weekly review written for you from what actually happened.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-d97757)](https://docs.claude.com/en/docs/claude-code/plugins)

```
NOW
◑ #3 Ship onboarding guide   2/4
   ✓ 3.1 Outline
   ✓ 3.2 First draft
   ○ 3.3 Screenshots
   ○ 3.4 Review

MY-APP
○ #6 Fix flaky login test    0%

GENERAL
◕ #2 Prepare demo            3/4

+2 in other-repo
```

## Quick start

```
/plugin install goals --marketplace AhmedHisham552/claude-goals
```

Answer `y` to add the marketplace, then pick **user** scope so the pane is there in every project. Then:

```
/goals add @here Ship onboarding guide; Fix flaky login test
/goals sub 1 Outline; First draft; Screenshots; Review
/goals focus 1
```

## Features

- **Side pane** that stays beside the chat, about 32 columns wide.
- **Focus.** One goal is *NOW*: it sits on top with its sub-tasks, and a one-line strip above the prompt keeps it in view.
- **Sub-tasks** with a goal's progress worked out from them. Progress shows as a filling circle `○ ◔ ◑ ◕ ✓`.
- **Labels per repo.** Goals added with `@here` belong to the repo you are in, and every worktree of that repo shares them. Other labels fold into one line. Untagged goals are **General**.
- **Change log.** Every change is recorded with its time and an optional note.
- **Summaries.** `yesterday`, `today`, `week` or any date range, as an exact log plus a short update ready to paste into Slack or a standup thread.
- **Claude can use it too.** Claude ticks sub-tasks when its work completes them and answers "what did I do this week?" from your log.

## Usage

| Command | What it does |
| --- | --- |
| `/goals add A; B` | Add goals to General (`add` is optional) |
| `/goals add @here A` | Add a goal to the repo you are in |
| `/goals add @label A` | Add a goal to any label |
| `/goals sub 3 A; B` | Add sub-tasks to goal #3 |
| `/goals tick 3.2 "note"` | Tick (or untick) sub-task 3.2, with an optional note |
| `/goals 3 60 "note"` | Set progress of a goal without sub-tasks |
| `/goals done 3` | Mark goal #3 done |
| `/goals rm 3` / `rm 3.2` | Remove a goal or a sub-task |
| `/goals focus 3` / `focus off` | Set or clear the NOW goal for that goal's label |
| `/goals tag 3 @label` | Move a goal to a label (`@general` to clear) |
| `/goals @label` | Expand another label in the pane |
| `/goals yesterday` / `today` / `week` | Summary for that period |
| `/goals from 2026-11-01 to 2026-11-15` | Summary for any date range |
| `/goals done-list` | List finished goals |
| `/goals` | Open the pane and show help |

Goal numbers (`#3`) are permanent: they never shift when other goals are added or removed. Sub-tasks are `goal.sub` (`3.2`).

In the pane, a goal row sets focus and a sub-task row ticks it, by click or keyboard.

**Ask Claude** in plain words: "add a goal to review the PR for this repo", "tick the screenshots sub-task", "write my standup". Claude uses the plugin's `update_goals` tool, which takes the same commands.

## Standups and weekly reviews

`/goals yesterday` (the last *working* day):

```
Tue 17 Nov
PLANNED     4 goals open, focus: Ship onboarding guide
DONE        ✓ First draft (Ship onboarding guide)
                sent to the team for comments
            ✓ Fix flaky login test
MOVED       ◔→◑ Prepare demo  1/4 → 2/4
STILL OPEN  Migrate settings page

POST
Yesterday I finished the first draft of the onboarding guide and sent it
for comments, and fixed the flaky login test. The demo is halfway there.
Today I'll add screenshots to the guide.
```

- **PLANNED:** goals open at the start of the period, and what was in focus.
- **DONE:** goals and sub-tasks finished in the period, with their notes.
- **MOVED:** goals that made progress but are not finished.
- **STILL OPEN:** goals that did not move.
- **POST:** a short update written by a small Claude model from the log above, and only from it.

`week` and date ranges group everything by label.

## How it works

- **Files.** Everything lives in one folder (default `~/.claude-goals`):
  - `goals.json`: the current goals.
  - `log/YYYY-MM.jsonl`: one line per change, one file per month.

  Plain files, so you can back them up, sync them or grep them. They survive reinstalling the plugin.
- **Labels.** `@here` resolves to the folder name of the repo's main checkout (`git rev-parse --git-common-dir`), so worktrees share a label. Outside git it is the current folder's name.
- **Focus.** One NOW goal per label. A session shows the focus of its repo's label, or General's when that label has none.
- **Finished goals** stay in the pane, green, on the day they were finished, then leave it. They stay in the log, the summaries and `/goals done-list`.
- **Two sessions at once.** Each change re-reads the files before writing, so open sessions don't overwrite each other.

## Configuration

Run `/plugin`, open **goals**, and set:

| Option | Default | What it does |
| --- | --- | --- |
| `dataDir` | `~/.claude-goals` | Folder for `goals.json` and `log/` |
| `workWeek` | `sun-thu` | Working days for `yesterday` and `week` (`sun-thu` or `mon-fri`) |

The pane docks beside the chat in the fullscreen layout on a terminal at least 110 columns wide:

```
CLAUDE_CODE_NO_FLICKER=1 claude
```

Otherwise it shows above the prompt. Drag its edge to resize it; your width is kept.

## Data and privacy

Your goals and log stay on your machine, in `dataDir`. The only thing sent anywhere is the summary log, to a Claude model, when you ask for a summary. That is what writes the POST, and it is billed to your Claude Code usage. Nothing is sent for any other command.

## Troubleshooting

- **The pane is not beside the chat.** Use the fullscreen layout (above) and a terminal at least 110 columns wide, or open the pane with `/goals`.
- **The circles look misaligned.** Some fonts draw `◔ ◑ ◕` at a different width. Please open an issue with your terminal and font.
- **My v0.1 goals are gone.** On first start, v0.2 imports them from the old storage into `dataDir`. If you changed `dataDir` before that first start, set it back, restart, and then move the folder.

## Development

```
git clone https://github.com/AhmedHisham552/claude-goals
cd claude-goals
claude --plugin-dir .        # run it from this folder
claude plugin validate .
claude plugin test .
```

The code is a Claude Code hooks module in `hooks/`. `register.tsx` wires the events, and the logic is in plain modules: `model.ts`, `parse.ts`, `store.ts`, `label.ts`, `summary.ts` and `view.tsx`, each with a `*.test.ts` beside it.

## Contributing

Issues and pull requests are welcome. Please run `claude plugin validate .` and `claude plugin test .` before opening a pull request, and update this README when you add or change a command.

## License

[MIT](LICENSE)
