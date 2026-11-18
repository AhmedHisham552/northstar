# goals — a goals pane for Claude Code

Keep the few things you actually want to get done in a pane beside the chat, each with a progress bar. Goals persist across sessions and projects, and every day's state is kept so you can look back at your progress.

```
1/3 done

1. Draft the onboarding guide
██████░░░░ 60%

2. Fix the flaky login test
██████████ 100%
```

## Install

```
/plugin install goals --marketplace AhmedHisham552/claude-goals
```

Answer `y` to add the marketplace, then pick a scope (user scope makes it available in every project).

The pane docks to the side in the fullscreen layout on a terminal at least 110 columns wide (start Claude with `CLAUDE_CODE_NO_FLICKER=1`). Otherwise it shows above the prompt.

## Use

| Command | What it does |
| --- | --- |
| `/goals add A; B; C` | Add one or more goals (`add` is optional) |
| `/goals 2 60` | Set goal 2 to 60% |
| `/goals done 2` | Mark goal 2 as 100% |
| `/goals rm 2` | Remove goal 2 |
| `/goals clear` | Remove all goals |
| `/goals history [days]` | Goals and progress per day, last 7 days by default |
| `/goals` | Open the pane and show help |

Claude can update the pane too, through the `update_goals` tool: ask "set the login goal to 80%" or "show my goal history this week", and it will move a goal forward when its own work does.

## How it works

- Goals live in the plugin's own store under your Claude Code config directory, shared by every session.
- History keeps one snapshot per day: the state of your goals when you last changed them that day.
- Each change re-reads the stored list first, so two open sessions don't overwrite each other.

## Develop

```
claude --plugin-dir .          # run it from this folder
claude plugin validate .
claude plugin test .
```

## License

MIT
