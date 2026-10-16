import { expect, test, type Page } from "@playwright/test";
import { requestConnection } from "../metamask/wallet-ui";

// These controls exercise connection navigation without an App server, wallet
// extension or provider. The regression project leaves action timeouts unlimited.
test.use({ actionTimeout: 0 });

async function expectNoProvider(page: Page) {
  expect(await page.evaluate(() => "ethereum" in window)).toBe(false);
}

test.afterEach(async ({ context }) => {
  for (const page of context.pages()) await expectNoProvider(page);
});

test("an already connected wallet needs no Connect Wallet button", async ({ page }) => {
  await page.setContent('<button aria-label="Open wallet menu">Wallet</button>');
  await expect(page.getByRole("button", { name: "Connect Wallet", exact: true })).toHaveCount(0);

  await requestConnection(page);

  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(1);
});

test("an open wallet chooser selects MetaMask without another connect action", async ({ page }) => {
  await page.setContent('<button>MetaMask</button><output id="selections">0</output>');
  await page.getByRole("button", { name: "MetaMask", exact: true }).evaluate(button => {
    button.addEventListener("click", () => {
      document.querySelector("output")!.textContent = "1";
      button.setAttribute("aria-label", "Open wallet menu");
      button.textContent = "Wallet";
    });
  });
  await expect(page.getByRole("button", { name: "Connect Wallet", exact: true })).toHaveCount(0);

  await requestConnection(page);

  await expect(page.locator("#selections")).toHaveText("1");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^MetaMask\b/ })).toHaveCount(0);
});

test("an existing native prompt is ready for the separate confirmation step", async ({ page, context }) => {
  await page.setContent("<p>Connection requested</p>");
  const prompt = await context.newPage();
  await prompt.goto("about:blank#notification.html");
  await prompt.setContent('<button data-testid="confirm-btn">Connect</button><output>0</output>');
  await prompt.getByTestId("confirm-btn").evaluate(button => {
    button.addEventListener("click", () => { document.querySelector("output")!.textContent = "1"; });
  });

  await requestConnection(page);

  await expect(page.getByText("Connection requested", { exact: true })).toBeVisible();
  await expect(prompt.getByTestId("confirm-btn")).toBeVisible();
  await expect(prompt.locator("output")).toHaveText("0");
  expect(context.pages()).toHaveLength(2);
});

test("Connect Wallet opens the chooser and selects MetaMask", async ({ page }) => {
  await page.setContent('<button>Connect Wallet</button><output id="transitions"></output>');
  await page.getByRole("button", { name: "Connect Wallet", exact: true }).evaluate(button => {
    button.addEventListener("click", () => {
      document.querySelector("output")!.textContent = "connect";
      const choice = document.createElement("button");
      choice.textContent = "MetaMask";
      choice.addEventListener("click", () => {
        document.querySelector("output")!.textContent += ",metamask";
        choice.setAttribute("aria-label", "Open wallet menu");
        choice.textContent = "Wallet";
      });
      button.replaceWith(choice);
    });
  });

  await requestConnection(page);

  await expect(page.locator("#transitions")).toHaveText("connect,metamask");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
});

test("Connect Wallet can become connected without a chooser", async ({ page }) => {
  await page.setContent('<button>Connect Wallet</button><output>0</output>');
  await page.getByRole("button", { name: "Connect Wallet", exact: true }).evaluate(button => {
    button.addEventListener("click", () => {
      document.querySelector("output")!.textContent = "1";
      button.setAttribute("aria-label", "Open wallet menu");
      button.textContent = "Wallet";
    });
  });

  await requestConnection(page);

  await expect(page.locator("output")).toHaveText("1");
  await expect(page.getByRole("button", { name: "Open wallet menu" })).toBeVisible();
});

test("a missing connect control times out within the connection allowance", async ({ page }) => {
  test.setTimeout(25_000);
  page.setDefaultTimeout(0);
  await page.setContent("<p>Wallet controls unavailable</p>");
  const started = Date.now();

  const error = await requestConnection(page).then(() => undefined, (failure: Error) => failure);

  expect(error?.name).toBe("TimeoutError");
  expect(error?.message).toContain("Timeout 15000ms exceeded");
  expect(Date.now() - started).toBeGreaterThanOrEqual(14_000);
  expect(Date.now() - started).toBeLessThan(24_000);
  await expect(page.getByText("Wallet controls unavailable", { exact: true })).toBeVisible();
});
