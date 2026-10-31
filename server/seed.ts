import { randomUUID as uuid } from "node:crypto";
import type { Board, User, Column, Card } from "./model.ts";
export function seed(
  user: User,
  now: number,
  title = "Website refresh",
): Board {
  const board: Board = {
    id: uuid(),
    title,
    description:
      "A small launch. A lot of moving parts. One shared place to bring it together.",
    ownerId: user.id,
    createdAt: now,
    expiresAt: now + 86400000,
    revision: 0,
    nextNumber: 111,
    limits: { doing: 3, review: 2 },
    members: [{ ...user, role: "owner", joinedAt: now }],
    cards: [],
    comments: [],
    events: [],
    receipts: [],
  };
  const tasks: [
    string,
    string,
    Column,
    Card["color"],
    Card["priority"],
    string[],
  ][] = [
    [
      "Map the first-time visitor journey",
      "Sketch the path from landing page to the first useful action. Capture questions before jumping into screens.",
      "backlog",
      "lavender",
      "high",
      ["research"],
    ],
    [
      "Collect references that feel like us",
      "Bring three references with a short note on what works. Focus on hierarchy, spacing and tone.",
      "backlog",
      "paper",
      "normal",
      ["design"],
    ],
    [
      "Write a useful empty state",
      "Explain what belongs here and give a clear next action. Keep the copy short.",
      "backlog",
      "butter",
      "low",
      ["content"],
    ],
    [
      "Plan the mobile navigation",
      "Explore a navigation pattern that works at 390 px as well as on a wide screen.",
      "backlog",
      "paper",
      "normal",
      ["design", "mobile"],
    ],
    [
      "Document the launch checklist",
      "List the checks needed before sharing the preview: links, forms, responsive layouts and basic accessibility.",
      "backlog",
      "mint",
      "normal",
      ["planning"],
    ],
    [
      "Build the homepage components",
      "Break the page into reusable sections. Check the spacing system and keyboard interaction as you go.",
      "doing",
      "paper",
      "high",
      ["development"],
    ],
    [
      "Shape the visual direction",
      "Choose one coherent direction and document the key type, colour and layout decisions.",
      "doing",
      "peach",
      "normal",
      ["design"],
    ],
    [
      "Review the contact form flow",
      "Check validation messages, loading state and successful submission. Record any unclear behavior.",
      "review",
      "lavender",
      "normal",
      ["testing"],
    ],
    [
      "Agree on the scope",
      "Define a small set of outcomes for the refresh and name what belongs in a later iteration.",
      "done",
      "mint",
      "normal",
      ["planning"],
    ],
    [
      "Set up the project workspace",
      "Create one place for decisions, tasks and discussion.",
      "done",
      "paper",
      "low",
      ["setup"],
    ],
  ];
  tasks.forEach(([task, description, column, color, priority, tags], i) =>
    board.cards.push({
      id: uuid(),
      number: 101 + i,
      title: task,
      description,
      column,
      color,
      priority,
      tags,
      assigneeId: i === 5 ? user.id : null,
      dueDate:
        i === 5 || i === 7
          ? new Date(now + (i === 5 ? 2 : 4) * 86400000)
              .toISOString()
              .slice(0, 10)
          : null,
      version: 1,
      position: board.cards.filter((c) => c.column === column).length,
      createdAt: now,
      updatedAt: now,
    }),
  );
  return board;
}
