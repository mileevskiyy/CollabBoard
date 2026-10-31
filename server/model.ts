import { z } from "zod";
export const columns = ["backlog", "doing", "review", "done"] as const;
export const roles = ["owner", "editor", "viewer"] as const;
export type Column = (typeof columns)[number];
export type Role = (typeof roles)[number];
export const boardInput = z.object({
  title: z.string().trim().min(2).max(70),
  description: z.string().trim().max(250).default(""),
  limits: z
    .object({
      doing: z.number().int().min(0).max(20),
      review: z.number().int().min(0).max(20),
    })
    .default({ doing: 3, review: 2 }),
});
export const cardInput = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(4000).default(""),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  color: z
    .enum(["paper", "lavender", "mint", "peach", "butter"])
    .default("paper"),
  assigneeId: z.string().uuid().nullable().default(null),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (v) =>
        !Number.isNaN(Date.parse(v + "T00:00:00Z")) &&
        new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v,
      "Choose a valid date.",
    )
    .nullable()
    .default(null),
  tags: z
    .array(z.string().trim().min(1).max(20))
    .max(5)
    .default([])
    .transform((v) => [...new Set(v)]),
});
export type User = { id: string; name: string };
export type Member = User & { role: Role; joinedAt: number };
export type Card = z.infer<typeof cardInput> & {
  id: string;
  number: number;
  column: Column;
  position: number;
  version: number;
  createdAt: number;
  updatedAt: number;
};
export type Comment = {
  id: string;
  cardId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: number;
  version: number;
};
export type Event = {
  id: number;
  at: number;
  actorId: string;
  actorName: string;
  kind: string;
  text: string;
  cardId?: string;
};
export type Board = {
  id: string;
  title: string;
  description: string;
  ownerId: string;
  createdAt: number;
  expiresAt: number;
  revision: number;
  nextNumber: number;
  limits: { doing: number; review: number };
  members: Member[];
  cards: Card[];
  comments: Comment[];
  events: Event[];
  receipts: { key: string; fingerprint: string; cardId?: string }[];
};
export class Fault extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assert(
  value: unknown,
  status: number,
  message: string,
): asserts value {
  if (!value) throw new Fault(status, message);
}
export function canonical(v: any): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Object.keys(v)
        .filter((k) => v[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
}
