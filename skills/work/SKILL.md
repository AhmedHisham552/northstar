---
name: work
description: Orchestrate work on one or more goals from the goals pane - align with the user first, then dispatch a background agent per goal that ticks its sub-tasks. Use when the user runs /northstar:work or asks to work on, start or dispatch goals by number.
argument-hint: <goals or sub-tasks, e.g. 1 3 or 2.4 2.5> [agents|workflow]
---

Call the `update_goals` tool with the command `work $ARGUMENTS`.

It focuses the first goal and returns the orchestration plan for those goals. Follow that plan exactly, phase by phase. If it returns an error such as `no goal #9`, tell the user and stop.
