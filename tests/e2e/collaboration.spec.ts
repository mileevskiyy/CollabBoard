import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
test("two editors and a viewer share a live board, preserve edits and enforce access", async ({
  browser,
  page,
  baseURL,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Big ideas/ })).toBeVisible();
  if (!process.env.DEMO_URL)
    await page.screenshot({
      path: fileURLToPath(new URL("../../docs/entry.png", import.meta.url)),
      fullPage: true,
    });
  await page.getByLabel("Your display name").fill("Morgan");
  await page.getByRole("button", { name: "Try the demo", exact: true }).click();
  await expect(page.locator(".connection")).toHaveText("Live updates");
  if (!process.env.DEMO_URL)
    await page.screenshot({
      path: fileURLToPath(new URL("../../docs/board.png", import.meta.url)),
      fullPage: true,
    });
  await page
    .getByRole("button", { name: "Invite people", exact: true })
    .click();
  await page.getByRole("button", { name: "Create link", exact: true }).click();
  const editorLink = await page
    .getByRole("textbox", { name: "Single-use invitation link", exact: true })
    .inputValue();
  const editorContext = await browser.newContext(),
    editor = await editorContext.newPage();
  await editor.goto(editorLink);
  await editor.getByLabel("Your display name").fill("Riley");
  await editor
    .getByRole("button", { name: "Join the board", exact: true })
    .click();
  await expect(
    editor.getByRole("heading", { name: /Website refresh/ }),
  ).toBeVisible();
  await expect(page.getByText("Riley", { exact: true })).toBeVisible();
  await page
    .getByRole("combobox", { name: "Invitation role", exact: true })
    .selectOption("viewer");
  await page.getByRole("button", { name: "Create link", exact: true }).click();
  const viewerLink = await page
    .getByRole("textbox", { name: "Single-use invitation link", exact: true })
    .inputValue();
  const viewerContext = await browser.newContext(),
    viewer = await viewerContext.newPage();
  await viewer.goto(viewerLink);
  await viewer.getByLabel("Your display name").fill("Sam");
  await viewer
    .getByRole("button", { name: "Join the board", exact: true })
    .click();
  await expect(viewer.locator(".viewer-banner")).toBeVisible();
  await expect(
    viewer.getByRole("button", { name: "Add a card", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await editor
    .getByRole("button", { name: "Add a card", exact: true })
    .first()
    .click();
  await editor
    .getByRole("textbox", { name: "Card title", exact: true })
    .fill("Validate the shared launch flow");
  await editor
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("Check the same board from independent browser sessions.");
  await editor
    .getByRole("button", { name: "Create card", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Validate the shared launch flow",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    viewer.getByRole("heading", {
      name: "Validate the shared launch flow",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Open CB-111:/ }).click();
  await editor.getByRole("button", { name: /Open CB-111:/ }).click();
  await page
    .getByRole("textbox", { name: "Card title", exact: true })
    .fill("Owner changed the shared card");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    editor.getByText("This card changed in another window.", { exact: false }),
  ).toBeVisible();
  await editor
    .getByRole("textbox", { name: "Card title", exact: true })
    .fill("An obsolete edit");
  await editor
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(editor.getByRole("alert").last()).toContainText(
    "another window",
  );
  await editor
    .getByRole("button", { name: "Load latest", exact: true })
    .click();
  await expect(
    editor.getByRole("textbox", { name: "Card title", exact: true }),
  ).toHaveValue("Owner changed the shared card");
  await editor
    .getByRole("textbox", { name: "Add a comment", exact: true })
    .fill("The second session sees the same work.");
  await editor
    .getByRole("button", { name: "Post comment", exact: true })
    .click();
  await page.getByRole("button", { name: /Open CB-111:/ }).click();
  await expect(
    page.getByText("The second session sees the same work.", { exact: true }),
  ).toBeVisible();
  if (!process.env.DEMO_URL)
    await page.screenshot({
      path: fileURLToPath(
        new URL("../../docs/conversation.png", import.meta.url),
      ),
      fullPage: true,
    });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await editor.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Move CB-111", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Move to", exact: true })
    .selectOption("doing");
  await page.getByRole("button", { name: "Move card", exact: true }).click();
  await expect(
    editor
      .getByRole("region", { name: "In progress", exact: true })
      .getByRole("heading", {
        name: "Owner changed the shared card",
        exact: true,
      }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Invite people", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Role for Riley", exact: true })
    .selectOption("viewer");
  await expect(editor.locator(".viewer-banner")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Role for Riley", exact: true })
    .selectOption("remove");
  await expect(editor.getByRole("alert")).toContainText("access");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Owner changed the shared card",
      exact: true,
    }),
  ).toBeVisible();
  if (!process.env.DEMO_URL) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: fileURLToPath(new URL("../../docs/mobile.png", import.meta.url)),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await editorContext.close();
  await viewerContext.close();
});
test("drag-and-drop orders cards and respects work-in-progress limits", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo", exact: true }).click();
  const doing = page.getByRole("region", { name: "In progress", exact: true }),
    backlog = page.getByRole("region", { name: "Backlog", exact: true });
  await page
    .locator('[data-card-number="101"]')
    .dragTo(doing.locator('[data-card-number="107"]'), {
      targetPosition: { x: 30, y: 20 },
    });
  await expect(doing.locator('[data-card-number="101"]')).toBeVisible();
  await page
    .locator('[data-card-number="102"]')
    .dragTo(doing.locator('[data-card-number="106"]'), {
      targetPosition: { x: 30, y: 20 },
    });
  await expect(page.getByRole("alert")).toContainText("work-in-progress limit");
  await expect(backlog.locator('[data-card-number="102"]')).toBeVisible();
  await page
    .getByRole("button", { name: "Dismiss error", exact: true })
    .click();
  await expect(doing.locator('[data-card-number="101"]')).toHaveAttribute(
    "draggable",
    "true",
  );
  await doing
    .locator('[data-card-number="101"]')
    .dragTo(doing.locator('[data-card-number="106"]'), {
      targetPosition: { x: 30, y: 20 },
    });
  await expect(doing.locator(".task-card").first()).toHaveAttribute(
    "data-card-number",
    "101",
  );
});
