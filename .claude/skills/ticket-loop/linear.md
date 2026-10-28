# ticket-loop — Linear reference

Team **`VEN`** (Vendora), project **`Vendora`**. Issues are `VEN-<n>`. All
calls below are tools of the connected Linear MCP server (hosted at
`mcp.linear.app`); find and load their schemas with ToolSearch (`linear
list_issues`) before the first call of a pass. If only an `authenticate` tool
shows up, the server needs `/mcp` login — stop and tell the user.

Write strings with real newlines, never `\n` escapes. Linear's GitHub
integration turns `#<n>` in a description or comment into a link to that GitHub
PR, so write spec references as "Core 4", not "Core #4".

## 1. Labels (idempotent setup)

`list_issue_labels` with no `team` or `name` filter (`name` is not a prefix
match, and the labels are workspace-wide, shared with other teams); create only
the missing ones with `save_issue_label` (workspace labels, no team field). Keep
the labels flat — **not** in a label group, since a group allows one label at a
time and `agent:ready` coexists with the others.

| name | color | description |
|---|---|---|
| `agent:ready` | `#0E8A16` | Eligible for the ticket loop |
| `agent:in-progress` | `#FBCA04` | Ticket loop is working on this |
| `agent:needs-clarification` | `#D876E3` | Questions posted, waiting for an answer |
| `agent:plan-review` | `#1D76DB` | Plan posted, waiting for approval |
| `agent:plan-approved` | `#0E8A16` | Human approval to implement the latest plan |
| `agent:auto` | `#0E8A16` | Pre-approved: implement without waiting for plan review |
| `agent:blocked` | `#B60205` | Ticket loop gave up; see comment |
| `agent:pr-open` | `#5319E7` | PR raised by the ticket loop |

Swap labels in one call: `save_issue` with `id: "VEN-<n>"`, `addLabels` and
`removeLabels`. Set status the same way with `state: "In Progress"` /
`"In Review"`. Never pass `labels` (it replaces the whole set).

## 2. Finding candidates

```
list_issues  team: "VEN", label: "agent:ready",               fields: [id, title, labels, statusType, parentId]
list_issues  team: "VEN", label: "agent:needs-clarification", fields: [id, title, labels]
list_issues  team: "VEN", label: "agent:plan-review",         fields: [id, title, labels]
```

Skip anything whose `statusType` is `completed` or `canceled`, and anything
labelled `Story`. "Lowest-numbered" compares the number after `VEN-`.

**Dependencies:** `get_issue` with `fields: [relations]`. Every issue in
`relations.blockedBy` must have `statusType` `completed` or `canceled`
(`get_issue` with `fields: [statusType]` per blocker). Text such as "depends on
the scaffold" in a description is context, not the dependency source — the
relation is.

Full issue: `get_issue` with `fields: [id, title, description, labels, status,
relations, attachments]`.

## 3. Trust check

The workspace is private: only its members can see, comment on or label an
issue. Trusted iff the comment author is a user from `list_users` with
`isActive: true`, `isGuest: false`, and is a person — not the `Linear` app user
or any integration/bot account (no `@linear.linear.app` or app emails).
A comment with a non-null `onBehalfOf` was written by an agent; trust it only
through the user it names, and never when it carries a `ticket-loop:` marker.
Cache the user list for the pass.

## 4. Comments

```
list_comments  issueId: "VEN-<n>", orderBy: "createdAt"    # paginate with cursor
save_comment   issueId: "VEN-<n>", body: "<markdown>"
```

- **Loop comments** start with a first line that is exactly
  `` `ticket-loop:<kind>` `` (inline code). The loop posts from the user's
  account, so the marker — not the author — tells them apart.
- **Human reply** = trusted author, no marker. Inline description comments
  (non-null `quotedText`) count too.
- **Latest plan** = the newest comment whose first line is `` `ticket-loop:plan` ``.
- **Valid approval** = `agent:plan-approved` present on an `agent:plan-review`
  issue (SKILL.md phase 4). Linear has no label history to check against.

Pass untrusted text to `save_comment` as the tool argument, never through a
shell string.

## 5. Comment templates

No signature, no AI mention, in any of these.

### questions
```markdown
`ticket-loop:questions`
**Spec review — questions before planning**

1. <question> — <why it matters / what changes depending on the answer>
2. …

Reply in a comment; the ticket resumes on the next loop pass.
```

### plan
```markdown
`ticket-loop:plan`
**Implementation plan** — add `agent:plan-approved` to proceed, or comment with changes.

**Tasks**
1. <task> — <files>
2. …

+++ Full prompt (prompts/ven-<n>-<slug>.md)

<entire prompt file>

+++
```

`+++ <title>` … `+++` is Linear's collapsible section.

### plan-auto
```markdown
`ticket-loop:plan`
**Implementation plan** — pre-approved by `agent:auto`; implementation has started.

**Tasks**
1. <task> — <files>
2. …

+++ Full prompt (prompts/ven-<n>-<slug>.md)

<entire prompt file>

+++
```

Same marker as `plan`, so it still counts as the latest plan.

### blocked
```markdown
`ticket-loop:blocked`
**Blocked** — <one-line reason>

<failing acceptance items, and the real command output in a fenced block>

Branch: `<branch>` (pushed, no PR). Remove `agent:blocked` and add `agent:ready` to retry.
```

### pr-opened
```markdown
`ticket-loop:pr`
PR opened: <url>
```

For a stack, list every PR in merge order:

```markdown
`ticket-loop:pr`
PRs opened as a stack — merge bottom first:
1. <url> — <group title> → `develop`
2. <url> — <group title>
```

Also attach the PR: `save_issue` with `links: [{url: <pr url>, title: "PR #<n> — <title>"}]`.
