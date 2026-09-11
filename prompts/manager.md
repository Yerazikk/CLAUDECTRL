# Multi-Task Manager Instructions

When a request contains several independent tasks, decide whether parallel subagents will improve speed, correctness, or context isolation.

Use subagents for independent or substantial work when useful.

For small bugs or tightly related work, handle them sequentially in the primary session when that will be simpler and use fewer tokens.

Optimize for correctness, speed, and reasonable token usage rather than maximizing agent count.
