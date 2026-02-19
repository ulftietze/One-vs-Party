const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const repoEnv = readDotEnv(path.resolve(__dirname, "../../.env"));
const ADMIN_TOKEN = process.env.E2E_ADMIN_TOKEN || process.env.ADMIN_TOKEN || repoEnv.ADMIN_TOKEN || "";

const QUESTION_FIXTURES = [
  {
    text: "E2E Q1 Single: Welche Farbe passt am besten?",
    adminType: "choice",
    options: ["Q1 Rot", "Q1 Blau", "Q1 Gruen", "Q1 Gelb"],
    correctIndexes: [0],
    answerKind: "single",
    answers: {
      player: "Q1 Rot",
      guestOne: "Q1 Blau",
      guestTwo: "Q1 Rot",
      guestAsync: "Q1 Gelb"
    }
  },
  {
    text: "E2E Q2 Multi: Welche Zahlen sind gerade?",
    adminType: "choice",
    allowMultiple: true,
    options: ["Q2 2", "Q2 3", "Q2 4", "Q2 5"],
    correctIndexes: [0, 2],
    answerKind: "multi",
    answers: {
      player: ["Q2 2", "Q2 4"],
      guestOne: ["Q2 3"],
      guestTwo: ["Q2 2"],
      guestAsync: ["Q2 2", "Q2 4"]
    }
  },
  {
    text: "E2E Q3 Schaetzung: Wie viele Kilometer sind 100 km?",
    adminType: "estimate",
    estimateTarget: "100",
    estimateTolerance: "10",
    answerKind: "estimate",
    answers: {
      player: "102",
      guestOne: "130",
      guestTwo: "95",
      guestAsync: "101"
    }
  },
  {
    text: "E2E Q4 Reihenfolge: Tagesablauf",
    adminType: "order",
    options: ["Q4 Aufstehen", "Q4 Fruehstueck", "Q4 Arbeit", "Q4 Schlafen"],
    answerKind: "order",
    answers: {
      player: "send",
      guestOne: "send",
      guestTwo: "send",
      guestAsync: "send"
    }
  },
  {
    text: "E2E Q5 Media: Was zeigt das Bild?",
    adminType: "media_identity",
    promptMedia: "https://example.com/e2e-placeholder-image.jpg",
    options: ["Q5 Ein Platzhalterbild", "Q5 Ein Lied", "Q5 Ein Video", "Q5 Keins davon"],
    correctIndexes: [0],
    answerKind: "single",
    answers: {
      player: "Q5 Ein Platzhalterbild",
      guestOne: "Q5 Ein Lied",
      guestTwo: "Q5 Keins davon",
      guestAsync: "Q5 Ein Platzhalterbild"
    }
  },
  {
    text: "E2E Q6 Risiko: Was ist die Hauptstadt von Deutschland?",
    adminType: "risk",
    options: ["Q6 Berlin", "Q6 Paris", "Q6 Rom", "Q6 Madrid"],
    correctIndexes: [0],
    answerKind: "single",
    answers: {
      player: "Q6 Berlin",
      guestOne: "Q6 Paris",
      guestTwo: "Q6 Berlin",
      guestAsync: "Q6 Berlin"
    }
  }
];

test.describe.configure({ mode: "serial" });

test("Edge case: manual token input shows validation error", async ({ page }) => {
  await page.goto("/#/");
  await page.getByText("Open token manually", { exact: true }).click();
  await page.getByPlaceholder("e.g. https://.../#/t/XXXXXXXX or token").fill("ungueltig");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByText("No valid token found.")).toBeVisible();
});

test("UI/UX E2E: complete game lifecycle with all question variants", async ({ browser, page }) => {
  test.setTimeout(600_000);
  test.skip(!ADMIN_TOKEN, "Missing ADMIN_TOKEN. Please set E2E_ADMIN_TOKEN or ADMIN_TOKEN.");

  page.on("dialog", dialog => dialog.accept().catch(() => {}));

  const gameTitle = `E2E UI Quiz ${Date.now()}`;
  const playerName = "E2E Player";

  await loginAsMasterAdmin(page);
  const tokens = await createGameViaUI(page, { gameTitle, playerName });

  await page.goto(`/#/admin/${tokens.admin}`);
  await expect(page.getByText(`Admin: ${gameTitle}`)).toBeVisible();
  await ensureGamePublished(page);

  await page.getByRole("button", { name: "Questions" }).click();
  for (const question of QUESTION_FIXTURES) {
    await createQuestionInAdmin(page, question);
  }

  const presentationContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const guestOneContext = await browser.newContext();
  const guestTwoContext = await browser.newContext();
  const guestAsyncContext = await browser.newContext();

  const presentationPage = await presentationContext.newPage();
  const playerPage = await playerContext.newPage();
  const guestOnePage = await guestOneContext.newPage();
  const guestTwoPage = await guestTwoContext.newPage();
  const guestAsyncPage = await guestAsyncContext.newPage();

  try {
    await presentationPage.goto(`/#/present/${tokens.present}`);
    await playerPage.goto(`/#/player/${tokens.player}`);
    await guestOnePage.goto(`/#/guest/live/${tokens.guest_live}`);
    await guestTwoPage.goto(`/#/guest/live/${tokens.guest_live}`);
    await guestAsyncPage.goto(`/#/guest/async/${tokens.guest_async}`);

    await expect(playerPage.getByText(playerName)).toBeVisible();

    await guestOnePage.getByRole("button", { name: "Join" }).click();
    await expect(guestOnePage.getByText("Please enter a name.")).toBeVisible();

    await joinLiveGuest(guestOnePage, "Gast Live 1");
    await joinLiveGuest(guestTwoPage, "Gast Live 2");
    await joinAsyncGuest(guestAsyncPage, "Gast Async");

    await expect(guestAsyncPage.getByText("You can submit answers before the game starts. Changes are possible until reveal.")).toBeVisible();

    await answerQuestionCard(
      guestAsyncPage,
      QUESTION_FIXTURES[0],
      QUESTION_FIXTURES[0].answers.guestAsync
    );

    await page.getByRole("button", { name: "Start game" }).click();
    await expect(page.getByRole("button", { name: "Stop game" })).toBeVisible();

    for (let i = 0; i < QUESTION_FIXTURES.length; i++) {
      const question = QUESTION_FIXTURES[i];

      await expect(presentationPage.getByText(question.text)).toBeVisible();

      await answerQuestionCard(playerPage, question, question.answers.player);

      await revealCurrentQuestion(presentationPage);
      await expect(playerPage.getByText("Reveal in progress. Answer is locked now.")).toBeVisible();

      const nextButtonName = i === QUESTION_FIXTURES.length - 1 ? "Show results" : "Next question";
      await presentationPage.getByRole("button", { name: nextButtonName }).click();
    }

    await expect(presentationPage.getByText("Game finished!")).toBeVisible();
    await expect(guestOnePage.getByText("Game finished!")).toBeVisible();

    await page.getByRole("button", { name: "Delete game" }).click();
    await expect(page).toHaveURL(/#\/admin$/);
    await page.getByRole("button", { name: "Reload" }).click();
    await expect(page.getByText(gameTitle)).toHaveCount(0);
  } finally {
    await Promise.all([
      presentationContext,
      playerContext,
      guestOneContext,
      guestTwoContext,
      guestAsyncContext
    ].map(ctx => ctx.close().catch(() => {})));
  }
});

async function loginAsMasterAdmin(page) {
  await page.goto("/#/admin");
  await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
}

async function createGameViaUI(page, { gameTitle, playerName }) {
  const createResponse = page.waitForResponse(response => {
    return response.url().includes("/api/games") && response.request().method() === "POST";
  });

  await page.getByPlaceholder("Title, e.g. 60th Birthday").fill(gameTitle);
  await page.getByPlaceholder("Player name").fill(playerName);
  await page.getByRole("button", { name: "Create game" }).click();

  const response = await createResponse;
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload?.tokens?.admin).toBeTruthy();
  expect(payload?.tokens?.present).toBeTruthy();
  expect(payload?.tokens?.player).toBeTruthy();
  expect(payload?.tokens?.guest_live).toBeTruthy();
  expect(payload?.tokens?.guest_async).toBeTruthy();
  return payload.tokens;
}

async function ensureGamePublished(page) {
  const publishCheckbox = page.locator("label:has-text('Published (homepage)') input[type='checkbox']").first();
  if (!(await publishCheckbox.isChecked())) {
    await publishCheckbox.check();
  }
  await expect(publishCheckbox).toBeChecked();
}

async function createQuestionInAdmin(page, question) {
  await page.getByRole("button", { name: "Add new question" }).click();

  const modalHeading = page.getByRole("heading", { name: "New question" }).first();
  await expect(modalHeading).toBeVisible();
  const modal = modalHeading.locator("xpath=ancestor::div[2]");

  await modal.getByPlaceholder("Question text").fill(question.text);
  await modal.locator("select").first().selectOption(question.adminType);

  if (question.allowMultiple) {
    const multi = modal.locator("input#multi");
    if (await multi.count()) await multi.check();
  }

  if (question.adminType === "estimate") {
    await modal.getByPlaceholder("Target value (e.g. 42)").fill(question.estimateTarget);
    await modal.getByPlaceholder("Tolerance (e.g. 5)").fill(question.estimateTolerance);
  }

  if (question.adminType === "media_identity") {
    await modal.getByPlaceholder("Media URL (or choose file below)").first().fill(question.promptMedia);
  }

  if (Array.isArray(question.options) && question.options.length > 0) {
    const optionInputs = modal.getByPlaceholder("Answer");
    const existingCount = await optionInputs.count();
    for (let i = existingCount; i < question.options.length; i++) {
      await modal.getByRole("button", { name: "Add option" }).click();
    }

    for (let i = 0; i < question.options.length; i++) {
      await optionInputs.nth(i).fill(question.options[i]);
    }

    if (question.adminType !== "order") {
      for (let i = 0; i < question.options.length; i++) {
        const isCorrect = (question.correctIndexes || []).includes(i);
        const row = optionInputs.nth(i).locator("xpath=ancestor::div[@data-edit-order-index]").first();
        await row.locator("input[type='checkbox']").setChecked(isCorrect);
      }
    }
  }

  await modal.getByRole("button", { name: "Save" }).click();
  await expect(modal).toBeHidden();
  await expect(page.getByText(question.text)).toBeVisible();
}

async function joinLiveGuest(page, nickname) {
  await page.getByPlaceholder("Your name").fill(nickname);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByText("Waiting for game start")).toBeVisible();
}

async function joinAsyncGuest(page, nickname) {
  await page.getByPlaceholder("Your name").fill(nickname);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByText(`Game:`, { exact: false })).toBeVisible();
}

async function answerQuestionCard(page, question, answerValue) {
  const card = page.locator(".question-card").filter({ hasText: question.text }).first();
  await expect(card).toBeVisible();

  if (question.answerKind === "estimate") {
    const estimateInput = card.getByPlaceholder("Your estimate");
    const submitEstimate = card.getByRole("button", { name: "Submit estimate" });

    await estimateInput.fill("");
    await estimateInput.fill(String(answerValue));

    if (!(await submitEstimate.isEnabled())) {
      await estimateInput.click();
      await estimateInput.press("Control+a");
      await estimateInput.type(String(answerValue), { delay: 20 });
    }

    await expect(submitEstimate).toBeEnabled();
    await submitEstimate.click();
    return;
  }

  if (question.answerKind === "order") {
    await card.getByRole("button", { name: "Submit order" }).click();
    return;
  }

  if (question.answerKind === "multi") {
    for (const label of answerValue) {
      await card.getByLabel(label, { exact: true }).check();
    }
    await card.getByRole("button", { name: "Submit answer" }).click();
    return;
  }

  await card.getByRole("button", { name: String(answerValue), exact: true }).click();
}

async function revealCurrentQuestion(presentationPage) {
  const next = presentationPage.getByRole("button", { name: /Next question|Show results/ });
  if (await next.isVisible().catch(() => false)) return;

  const reveal = presentationPage.getByRole("button", { name: "Reveal" });
  if (await reveal.isVisible().catch(() => false)) {
    await reveal.click({ timeout: 2_000 }).catch(() => {});
  }

  await expect(next).toBeVisible({ timeout: 20_000 });
}
