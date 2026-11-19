import { expect, test, type BrowserContext, type Page } from "@playwright/test";

async function disableVaultResetNotifications(context: BrowserContext) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "locks", { value: undefined });
    Object.defineProperty(window, "BroadcastChannel", { value: undefined });
    window.addEventListener("storage", (event) => {
      if (event.key === "miroven:vault-lock") event.stopImmediatePropagation();
    }, { capture: true });
  });
}

async function resetLocalVault(page: Page) {
  await page.getByRole("button", { name: "계정", exact: true }).click();
  await page.getByRole("button", { name: "이 기기의 로컬 금고 초기화", exact: true }).click();
  await page.locator("#delete-confirm-input").fill("로컬 금고 삭제");
  await page.getByRole("button", { name: "로컬 금고 삭제", exact: true }).click();
  await expect(page.getByText("이 기기의 로컬 금고를 초기화했습니다.", { exact: true })).toBeVisible();
  await page.getByRole("dialog", { name: "계정", exact: true }).getByRole("button", { name: "완료", exact: true }).click();
}

type PendingDraftWindow = Window & { releaseDraftWrite?: () => void };
type PendingDraftClearWindow = Window & { releaseDraftClear?: () => void };
type PendingEntryWindow = Window & { releasePhotoRead?: () => void };

async function createTextEntry(page: import("@playwright/test").Page, text: string) {
  await page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" }).fill(text);
  await page.getByRole("button", { name: "기록", exact: true }).click();
  await expect(page.getByText(text, { exact: true })).toBeVisible();
}

test("pins up to three entries, persists on reload, and preserves pins while editing", async ({ page }) => {
  await page.goto("/");
  for (const text of ["첫 번째 기록", "두 번째 기록", "세 번째 기록", "네 번째 기록"]) {
    await createTextEntry(page, text);
  }
  const entry = (text: string) => page.locator(".entry").filter({ has: page.getByText(text, { exact: true }) });
  for (const text of ["첫 번째 기록", "두 번째 기록", "세 번째 기록"]) {
    await entry(text).getByRole("button", { name: "기록 고정", exact: true }).click();
    await expect(entry(text).getByRole("button", { name: "기록 고정 해제", exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  await entry("네 번째 기록").getByRole("button", { name: "기록 고정", exact: true }).click();
  await expect(page.getByText("기록은 최대 3개까지 고정할 수 있습니다.", { exact: true })).toBeVisible();
  await expect(page.locator(".entry-pin-label")).toHaveCount(3);
  await expect(page.locator(".entry").last()).toContainText("네 번째 기록");
  await page.reload();
  await expect(page.locator(".entry-pin-label")).toHaveCount(3);
  await entry("첫 번째 기록").getByRole("button", { name: "기록 수정", exact: true }).click();
  await page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" }).fill("수정한 첫 번째 기록");
  await page.getByRole("button", { name: "수정 저장", exact: true }).click();
  await expect(entry("수정한 첫 번째 기록").locator(".entry-pin-label")).toBeVisible();
  await entry("수정한 첫 번째 기록").getByRole("button", { name: "기록 고정 해제", exact: true }).click();
  await expect(page.locator(".entry-pin-label")).toHaveCount(2);
  await entry("네 번째 기록").getByRole("button", { name: "기록 고정", exact: true }).click();
  await expect(page.locator(".entry-pin-label")).toHaveCount(3);
});

test("local vault deletion clears stored records and another open tab", async ({ page, context }) => {
  await page.goto("/");
  const text = "다른 탭에서도 지울 로컬 기록";
  await createTextEntry(page, text);
  const peer = await context.newPage();
  await peer.goto("/");
  await expect(peer.getByText(text, { exact: true })).toBeVisible();
  await resetLocalVault(page);
  await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  await expect(peer.getByText(text, { exact: true })).toHaveCount(0);
  await peer.reload();
  await expect(peer.getByText(text, { exact: true })).toHaveCount(0);
  await peer.close();
});

test("local vault reset clears recent searches across open tabs", async ({ page, context }) => {
  const previousSearch = "초기화 전 합성 검색어";
  const newSearch = "초기화 후 합성 검색어";
  const searchInput = page.getByRole("textbox", { name: "검색", exact: true });
  const submitSearch = async (query: string) => {
    await searchInput.fill(query);
    await searchInput.press("Enter");
    await searchInput.fill("");
    await expect(page.getByRole("button", { name: query, exact: true })).toBeVisible();
  };

  await page.goto("/");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await submitSearch(previousSearch);

  const peer = await context.newPage();
  await peer.goto("/");
  await peer.getByRole("button", { name: "검색", exact: true }).click();
  for (const tab of [page, peer]) {
    await expect(tab.getByRole("button", { name: previousSearch, exact: true })).toBeVisible();
    await expect(tab.getByRole("button", { name: `지우기: ${previousSearch}`, exact: true })).toBeVisible();
  }

  await resetLocalVault(page);

  for (const tab of [page, peer]) {
    await expect(tab.getByRole("textbox", { name: "검색", exact: true })).toBeVisible();
    await expect(tab.getByRole("button", { name: previousSearch, exact: true })).toHaveCount(0);
    await expect(tab.getByRole("button", { name: `지우기: ${previousSearch}`, exact: true })).toHaveCount(0);
  }
  await submitSearch(newSearch);
  await peer.close();
});

type RecentSearchTestWindow = Window & {
  pendingRecentSearch?: { release: () => void; settled: Promise<void> };
};

test("a pending recent search cannot write after a reset in another tab without Web Locks", async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "locks", { value: undefined });
    Object.defineProperty(window, "BroadcastChannel", { value: undefined });
    // Make the pending operation, rather than the fallback lock event, detect the reset.
    window.addEventListener("storage", (event) => {
      if (event.key === "miroven:vault-lock") event.stopImmediatePropagation();
    }, { capture: true });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  const input = page.getByRole("textbox", { name: "검색", exact: true });
  await input.fill("이전 검색어");
  await input.press("Enter");
  await input.fill("");
  await expect(page.getByRole("button", { name: "이전 검색어", exact: true })).toBeVisible();

  await page.evaluate(() => {
    const isRecentSearchCrypto = (algorithm: AlgorithmIdentifier) => {
      const aad = (algorithm as AesGcmParams).additionalData;
      return aad && new TextDecoder().decode(aad) === "private-journal:recent-searches:v1";
    };
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    const gate = Promise.withResolvers<void>();
    const transactionDone = Promise.withResolvers<void>();
    crypto.subtle.decrypt = async (algorithm, key, data) => {
      const plaintext = await decrypt(algorithm, key, data);
      if (isRecentSearchCrypto(algorithm)) {
        crypto.subtle.decrypt = decrypt;
        (window as RecentSearchTestWindow).pendingRecentSearch = {
          release: gate.resolve,
          settled: transactionDone.promise,
        };
        await gate.promise;
      }
      return plaintext;
    };
    crypto.subtle.encrypt = async (algorithm, key, data) => {
      const ciphertext = await encrypt(algorithm, key, data);
      if (!isRecentSearchCrypto(algorithm)) return ciphertext;
      crypto.subtle.encrypt = encrypt;
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, options) {
        const result = transaction.call(this, stores, mode, options);
        if (mode === "readwrite" && result.objectStoreNames.length === 1 && result.objectStoreNames.contains("device-keys")) {
          IDBDatabase.prototype.transaction = transaction;
          result.addEventListener("complete", () => transactionDone.resolve(), { once: true });
          result.addEventListener("abort", () => transactionDone.reject(result.error), { once: true });
        }
        return result;
      };
      return ciphertext;
    };
  });
  await input.fill("진행 중인 검색어");
  await input.press("Enter");
  await page.waitForFunction(() => Boolean((window as RecentSearchTestWindow).pendingRecentSearch));
  await input.fill("");

  const resetTab = await context.newPage();
  await resetTab.goto("/");
  await resetLocalVault(resetTab);
  await expect(page.getByRole("button", { name: "이전 검색어", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const mutation = (window as RecentSearchTestWindow).pendingRecentSearch!;
    mutation.release();
    await mutation.settled;
  });
  await expect(page.locator(".recent-chip")).toHaveCount(0);
  const storedKey = await resetTab.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("private-journal");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<IDBValidKey | undefined>((resolve, reject) => {
        const request = database.transaction("device-keys").objectStore("device-keys").getKey("recent-searches");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
  expect.soft(storedKey).toBeUndefined();

  const freshTab = await context.newPage();
  await freshTab.goto("/");
  await freshTab.getByRole("button", { name: "검색", exact: true }).click();
  await expect(freshTab.locator(".recent-chip")).toHaveCount(0);
  const freshInput = freshTab.getByRole("textbox", { name: "검색", exact: true });
  await freshInput.fill("초기화 후 새 검색어");
  await freshInput.press("Enter");
  await freshInput.fill("");
  await expect(freshTab.getByRole("button", { name: "초기화 후 새 검색어", exact: true })).toBeVisible();
  await freshTab.reload();
  await freshTab.getByRole("button", { name: "검색", exact: true }).click();
  await expect(freshTab.locator(".recent-chip")).toHaveCount(1);
  await expect(freshTab.getByRole("button", { name: "초기화 후 새 검색어", exact: true })).toBeVisible();
});

test("typing does not repeat timeline date formatting and shortcuts save the latest text", async ({ page }) => {
  await page.addInitScript(() => {
    const Original = Intl.DateTimeFormat;
    (window as unknown as { dateFormats: number }).dateFormats = 0;
    Intl.DateTimeFormat = new Proxy(Original, {
      construct(target, args) {
        (window as unknown as { dateFormats: number }).dateFormats++;
        return Reflect.construct(target, args);
      },
    });
  });
  await page.goto("/");
  await createTextEntry(page, "타임라인 고정 기록");
  const composer = page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" });
  await composer.fill("입력");
  await expect(page.getByRole("button", { name: "기록", exact: true })).toBeEnabled();
  await page.evaluate(() => { (window as unknown as { dateFormats: number }).dateFormats = 0; });
  await composer.pressSequentially(" 최신 내용", { delay: 15 });
  expect(await page.evaluate(() => (window as unknown as { dateFormats: number }).dateFormats)).toBe(0);
  await composer.press("Control+Enter");
  await expect(page.getByText("입력 최신 내용", { exact: true })).toBeVisible();
  await expect(composer).toHaveValue("");
});

test("draft survives tab changes and reload; clearing or saving cannot resurrect it", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" });
  await composer.fill("복원할 임시 글");
  const readDraft = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("private-journal"); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    try {
      return await new Promise<{ encrypted: boolean; hasPlaintextFields: boolean } | null>((resolve, reject) => {
        const req = db.transaction("device-keys").objectStore("device-keys").get("miroven-composer-draft");
        req.onsuccess = () => {
          const value = req.result;
          resolve(value ? {
            encrypted: value.cryptoVersion === 1
              && value.iv instanceof ArrayBuffer
              && value.iv.byteLength === 12
              && value.ciphertext instanceof ArrayBuffer
              && value.ciphertext.byteLength > 16,
            hasPlaintextFields: "text" in value || "editingEntryId" in value || "updatedAt" in value,
          } : null);
        };
        req.onerror = () => reject(req.error);
      });
    } finally { db.close(); }
  });
  await expect.poll(readDraft).toEqual({ encrypted: true, hasPlaintextFields: false });
  await composer.press("Control+k");
  await page.keyboard.press("Escape");
  await page.keyboard.press("1");
  await expect(composer).toHaveValue("복원할 임시 글");
  await page.reload();
  await expect(composer).toHaveValue("복원할 임시 글");
  await composer.fill("");
  await expect.poll(readDraft).toBeNull();
  await page.reload();
  await expect(composer).toHaveValue("");
  await composer.fill("저장 후 재등장 금지");
  await page.getByRole("button", { name: "기록", exact: true }).click();
  await expect(page.getByText("저장 후 재등장 금지", { exact: true })).toBeVisible();
  await expect.poll(readDraft).toBeNull();
  await page.reload();
  await expect(composer).toHaveValue("");
});

async function holdDraftEncryption(page: Page) {
  await page.evaluate(() => {
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    const gate = Promise.withResolvers<void>();
    crypto.subtle.encrypt = async (algorithm, key, data) => {
      const aad = (algorithm as AesGcmParams).additionalData;
      if (aad && new TextDecoder().decode(aad) === "private-journal:composer-draft:v1") {
        crypto.subtle.encrypt = encrypt;
        (window as PendingDraftWindow).releaseDraftWrite = gate.resolve;
        await gate.promise;
      }
      return encrypt(algorithm, key, data);
    };
  });
}

test("pending draft writes respect a reset in another tab without Web Locks", async ({ page, context }) => {
  await disableVaultResetNotifications(context);
  await page.goto("/");
  const resetTab = await context.newPage();
  await resetTab.goto("/");
  const composer = page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" });
  await holdDraftEncryption(page);
  await page.clock.install();
  await composer.fill("이전 자동 저장 초안");
  await page.clock.runFor(600);
  await page.waitForFunction(() => Boolean((window as PendingDraftWindow).releaseDraftWrite));
  await composer.fill("대기 중인 자동 저장 초안");
  await page.clock.runFor(600);

  await resetLocalVault(resetTab);
  const newComposer = resetTab.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" });
  const newDraft = "초기화 후 새 초안";
  await newComposer.fill(newDraft);
  await expect.poll(() => resetTab.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("private-journal");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<boolean>((resolve, reject) => {
        const request = database.transaction("device-keys").objectStore("device-keys").getKey("miroven-composer-draft");
        request.onsuccess = () => resolve(request.result !== undefined);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  })).toBe(true);

  await page.evaluate(() => (window as PendingDraftWindow).releaseDraftWrite?.());
  await expect(composer).toHaveValue("");
  await page.clock.runFor(600);
  const freshTab = await context.newPage();
  await freshTab.goto("/");
  await expect(freshTab.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" })).toHaveValue(newDraft);
});

test("a queued draft finishes saving after navigating away from the composer", async ({ page, context }) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" });
  await holdDraftEncryption(page);
  await page.clock.install();
  await composer.fill("먼저 저장할 합성 초안");
  await page.clock.runFor(600);
  await page.waitForFunction(() => Boolean((window as PendingDraftWindow).releaseDraftWrite));
  const latestDraft = "나가기 전에 대기열에 추가한 합성 초안";
  await composer.fill(latestDraft);
  await page.clock.runFor(600);

  await page.getByRole("button", { name: "계정", exact: true }).click();
  await page.getByRole("link", { name: "저작권 및 오픈 소스 라이선스", exact: true }).click();
  await expect(page).toHaveURL(/\/notice\/?$/);
  await expect(composer).toHaveCount(0);
  await page.evaluate(() => (window as PendingDraftWindow).releaseDraftWrite?.());

  const freshTab = await context.newPage();
  await expect(async () => {
    await freshTab.goto("/");
    await expect(freshTab.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" }))
      .toHaveValue(latestDraft, { timeout: 750 });
  }).toPass({ timeout: 5000 });
});

test("a reset during saved-entry draft cleanup clears the composer and feed", async ({ page, context }) => {
  await disableVaultResetNotifications(context);
  await page.goto("/");
  const resetTab = await context.newPage();
  await resetTab.goto("/");
  const composer = page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" });
  await page.evaluate(() => {
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (key) {
      const request = get.call(this, key);
      if (this.name !== "entries" || this.transaction.mode !== "readonly" || this.transaction.objectStoreNames.length !== 1) {
        return request;
      }
      IDBObjectStore.prototype.get = get;
      // Hold the next database connection, which draft cleanup opens after reading the summary.
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (name, version) {
        IDBFactory.prototype.open = open;
        const pending = open.call(this, name, version);
        pending.addEventListener("success", (event) => {
          event.stopImmediatePropagation();
          (window as PendingDraftClearWindow).releaseDraftClear = () => pending.onsuccess?.call(pending, event);
        }, { once: true });
        return pending;
      };
      return request;
    };
    const timers: Window = window;
    const schedule = timers.setTimeout.bind(timers);
    timers.setTimeout = (callback, delay, ...args) => schedule(callback, delay === 500 ? 60_000 : delay, ...args);
  });
  await composer.fill("초안 정리 중 초기화할 합성 기록");
  await page.getByRole("button", { name: "기록", exact: true }).click();
  await page.waitForFunction(() => Boolean((window as PendingDraftClearWindow).releaseDraftClear));
  await resetLocalVault(resetTab);
  await page.evaluate(() => (window as PendingDraftClearWindow).releaseDraftClear?.());
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue("");
  await expect(page.locator(".entry")).toHaveCount(0);
  await createTextEntry(page, "초기화 후 정상 저장한 합성 기록");
  await expect(page.locator(".entry")).toHaveCount(1);
});

for (const editing of [false, true]) {
  test(`pending photo ${editing ? "edit" : "entry"} respects a reset in another tab without Web Locks`, async ({ page, context }) => {
    await disableVaultResetNotifications(context);
    await page.goto("/");
    const resetTab = await context.newPage();
    await resetTab.goto("/");
    if (editing) {
      await createTextEntry(page, "수정할 합성 기록");
      await page.getByRole("button", { name: "기록 수정", exact: true }).click();
    }
    const encoded = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 16;
      canvas.getContext("2d")!.fillRect(0, 0, 16, 16);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    const photoInput = page.locator('.photo-button input[type="file"]');
    await expect(photoInput).toBeEnabled();
    await photoInput.setInputFiles({
      name: "synthetic.png",
      mimeType: "image/png",
      buffer: Buffer.from(encoded, "base64"),
    });
    await expect(page.locator(".image-preview img")).toBeVisible();

    await page.evaluate(() => {
      const read = FileReader.prototype.readAsDataURL;
      FileReader.prototype.readAsDataURL = function (blob) {
        if (blob.type !== "image/webp") return read.call(this, blob);
        FileReader.prototype.readAsDataURL = read;
        (window as PendingEntryWindow).releasePhotoRead = () => read.call(this, blob);
      };
      // Exercise submission's own reset check independently of draft autosave.
      const timers: Window = window;
      const schedule = timers.setTimeout.bind(timers);
      timers.setTimeout = (callback, delay, ...args) => schedule(callback, delay === 500 ? 60_000 : delay, ...args);
    });
    const composer = page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" });
    const text = "초기화 전에 제출한 합성 기록";
    await composer.fill(text);
    await page.getByRole("button", { name: editing ? "수정 저장" : "기록", exact: true }).click();
    await page.waitForFunction(() => Boolean((window as PendingEntryWindow).releasePhotoRead));

    await resetLocalVault(resetTab);
    await expect(composer).toHaveValue(text);
    await page.evaluate(() => (window as PendingEntryWindow).releasePhotoRead?.());
    await expect(composer).toHaveValue("");
    await expect(composer).toBeEnabled();
    await expect(page.locator(".entry")).toHaveCount(0);
    await expect(page.locator(".image-preview img")).toHaveCount(0);

    const storage = await resetTab.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("private-journal");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const transaction = database.transaction(["entries", "device-keys", "sync-outbox"]);
        const requests = [
          transaction.objectStore("entries").count(),
          transaction.objectStore("sync-outbox").count(),
          transaction.objectStore("device-keys").getKey("primary"),
        ];
        return await Promise.all(requests.map((request) => new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        })));
      } finally {
        database.close();
      }
    });
    expect(storage).toEqual([0, 0, undefined]);
    await createTextEntry(page, "초기화 후 새로 저장한 기록");
    const freshTab = await context.newPage();
    await freshTab.goto("/");
    await expect(freshTab.getByText("초기화 후 새로 저장한 기록", { exact: true })).toBeVisible();
    await expect(freshTab.locator(".entry")).toHaveCount(1);
    await expect(freshTab.locator(".entry-image")).toHaveCount(0);
  });
}

test("low-spec effects are disabled without OS reduced motion and editing scrolls instantly", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    localStorage.setItem("miroven:low_spec_mode", "true");
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (options) {
      (window as unknown as { lastScroll: unknown }).lastScroll = options;
      return original.call(this, options);
    };
  });
  await page.goto("/");
  await createTextEntry(page, "효과 제거 확인");
  await expect(page.locator(".app-shell")).toHaveClass(/low-spec-mode/);
  const styles = await page.locator(".post-button").evaluate((element) => {
    const css = getComputedStyle(element);
    return { animation: css.animationName, transition: css.transitionDuration, shadow: css.boxShadow };
  });
  expect(styles).toEqual({ animation: "none", transition: "0s", shadow: "none" });
  await page.getByRole("button", { name: "기록 수정" }).click();
  expect(await page.evaluate(() => (window as unknown as { lastScroll: unknown }).lastScroll)).toEqual({ behavior: "instant" });
});

test("stores a journal entry encrypted and restores it after reload", async ({ page }) => {
  const plaintext = "브라우저 E2E 암호화 기록";

  await page.goto("/");
  await expect(page.getByText("내 저널", { exact: true })).toBeVisible();

  await createTextEntry(page, plaintext);

  const readStoredEntry = () => page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("private-journal");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    try {
      return await new Promise<Record<string, unknown> | null>((resolve, reject) => {
        const request = database.transaction("entries", "readonly").objectStore("entries").getAll();
        request.onsuccess = () => resolve((request.result[0] as Record<string, unknown>) ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });

  await expect.poll(async () => (await readStoredEntry()) !== null).toBe(true);
  const storedEntry = (await readStoredEntry())!;

  expect(storedEntry).not.toHaveProperty("text");
  expect(storedEntry).toHaveProperty("ciphertext");
  expect(JSON.stringify(storedEntry)).not.toContain(plaintext);

  await page.reload();
  await expect(page.getByText(plaintext, { exact: true })).toBeVisible();
});

test("persists entry edits and deletion across reloads", async ({ page }) => {
  const original = "수정 전 브라우저 기록";
  const updated = "수정 후 브라우저 기록";

  await page.goto("/");
  await createTextEntry(page, original);

  await page.getByRole("button", { name: "기록 수정" }).click();
  const composer = page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" });
  await expect(composer).toHaveValue(original);
  await composer.fill(updated);
  await page.getByRole("button", { name: "수정 저장" }).click();

  await expect(page.getByText(updated, { exact: true })).toBeVisible();
  await expect(page.getByText(original, { exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.getByText(updated, { exact: true })).toBeVisible();

  const nativeDialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    nativeDialogs.push(dialog.type());
    await dialog.dismiss();
  });
  const deleteButton = page.getByRole("button", { name: "기록 삭제", exact: true });
  const modal = page.getByRole("dialog", { name: "기록 삭제", exact: true });
  await deleteButton.click();
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("button", { name: "취소" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(modal.getByRole("button", { name: "닫기" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(modal.getByRole("button", { name: "삭제", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(deleteButton).toBeFocused();
  await expect(page.getByText(updated, { exact: true })).toBeVisible();

  await deleteButton.click();
  await modal.getByRole("button", { name: "취소" }).click();
  await expect(modal).toHaveCount(0);
  await deleteButton.click();
  await page.mouse.click(5, 5);
  await expect(modal).toHaveCount(0);
  await expect(page.getByText(updated, { exact: true })).toBeVisible();

  await deleteButton.click();
  await page.keyboard.press("/");
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(nativeDialogs).toEqual([]);
  await expect(page.getByText(updated, { exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.getByText(updated, { exact: true })).toHaveCount(0);
});

test("removes plaintext from the page while the vault is locked", async ({ page }) => {
  const plaintext = "잠금 화면에서 숨겨야 하는 기록";

  await page.goto("/");
  await createTextEntry(page, plaintext);

  await page.getByRole("button", { name: "금고 잠그기" }).click();
  await expect(page.getByRole("heading", { name: "금고가 잠겨 있습니다" })).toBeVisible();
  await expect(page.getByText(plaintext, { exact: true })).toHaveCount(0);
  expect(await page.locator("body").textContent()).not.toContain(plaintext);

  await page.getByRole("button", { name: "금고 잠금 해제" }).click();
  await expect(page.getByText(plaintext, { exact: true })).toBeVisible();
});

test("serializes same-entry edits across tabs using the browser Web Lock", async ({ page, context }) => {
  await page.goto("/");
  await createTextEntry(page, "공유 원본");
  const second = await context.newPage();
  await second.goto("/");
  await expect(second.getByText("공유 원본", { exact: true })).toBeVisible();
  for (const [tab, text] of [[page, "첫 번째 탭 수정"], [second, "두 번째 탭 수정"]] as const) {
    await tab.getByRole("button", { name: "기록 수정" }).click();
    await tab.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" }).fill(text);
  }

  // Hold the actual browser lock until both UI writes are waiting for it.
  await page.evaluate(() => new Promise<void>(ready => {
    void navigator.locks.request("private-journal:mutation", () => new Promise<void>(release => {
      (window as unknown as { releaseMutation: () => void }).releaseMutation = release;
      ready();
    }));
  }));
  try {
    await Promise.all([page, second].map(tab => tab.getByRole("button", { name: "수정 저장" }).click()));
    await expect.poll(() => page.evaluate(async () => {
      const locks = await navigator.locks.query();
      return locks.pending?.filter(lock => lock.name === "private-journal:mutation").length;
    })).toBe(2);
  } finally {
    await page.evaluate(() => (window as unknown as { releaseMutation: () => void }).releaseMutation());
  }
  for (const tab of [page, second]) {
    await expect(tab.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" })).toHaveValue("");
  }
  const revision = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("private-journal");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const request = db.transaction("entries").objectStore("entries").getAll();
        request.onsuccess = () => resolve(request.result[0].revision);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
  expect(revision).toBe(3);
  await Promise.all([page.reload(), second.reload()]);
  const firstText = page.locator(".entry-text");
  await expect(firstText).toHaveCount(1);
  await expect(second.locator(".entry-text")).toHaveText((await firstText.textContent())!);
  expect(await firstText.textContent()).toMatch(/^(첫 번째|두 번째) 탭 수정$/);
});

test("an unchanged focus refresh reuses decrypted text", async ({ page }) => {
  await page.addInitScript(() => {
    const counters = { decrypts: 0, digests: 0, active: 0 };
    (window as unknown as { readCounters: typeof counters }).readCounters = counters;
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    crypto.subtle.decrypt = async (...args) => { counters.decrypts++; return decrypt(...args); };
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = async (...args) => {
      counters.digests++; counters.active++;
      try { return await digest(...args); } finally { counters.active--; }
    };
  });
  await page.goto("/");
  for (let i = 0; i < 3; i++) await createTextEntry(page, `재조회 기록 ${i}`);
  await page.evaluate(() => {
    const state = (window as unknown as { readCounters: { decrypts: number; digests: number } }).readCounters;
    state.decrypts = state.digests = 0;
    window.dispatchEvent(new Event("focus"));
  });
  await page.waitForFunction(() => {
    const state = (window as unknown as { readCounters: { digests: number; active: number } }).readCounters;
    return state.digests >= 4 && state.active === 0;
  });
  expect(await page.evaluate(() => (window as unknown as { readCounters: { decrypts: number } }).readCounters.decrypts)).toBe(0);
  await expect(page.locator(".entry")).toHaveCount(3);
});

test("photo data leaves offscreen items and text edits preserve the stored photo", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("내 저널", { exact: true })).toBeVisible();
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
    canvas.getContext("2d")!.fillRect(0, 0, 64, 64);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator('.photo-button input[type="file"]').setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from(encoded, "base64") });
  await expect(page.locator(".image-preview img")).toBeVisible({ timeout: 30000 });
  await createTextEntry(page, "사진 있는 기록");
  await expect(page.locator(".entry-image")).toBeVisible();
  const src = await page.locator(".entry-image").getAttribute("src");
  await page.evaluate(() => { document.getElementById("composer")!.style.minHeight = "2000px"; });
  await expect(page.locator(".entry-image")).toHaveCount(0);
  await page.locator(".entry-image-shell").scrollIntoViewIfNeeded();
  await expect(page.locator(".entry-image")).toBeVisible();
  await expect(page.locator(".entry-image")).toHaveAttribute("src", src!);
  await page.locator(".entry-image").click();
  await expect(page.getByRole("dialog", { name: "사진 확대보기" })).toBeVisible();
  await expect(page.locator(".lightbox-img")).toHaveAttribute("src", src!);
  await page.getByRole("button", { name: "닫기" }).click();
  await expect(page.getByRole("dialog", { name: "사진 확대보기" })).toHaveCount(0);
  await page.evaluate(() => { document.getElementById("composer")!.style.minHeight = ""; });
  await page.getByRole("button", { name: "기록 수정" }).click();
  await page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" }).fill("사진 보존 수정");
  await page.getByRole("button", { name: "수정 저장" }).click();
  await expect(page.getByText("사진 보존 수정", { exact: true })).toBeVisible();
  await page.locator(".entry-image-shell").scrollIntoViewIfNeeded();
  await expect(page.locator(".entry-image")).toHaveAttribute("src", src!);
  await page.reload();
  await page.locator(".entry-image-shell").scrollIntoViewIfNeeded();
  await expect(page.locator(".entry-image")).toHaveAttribute("src", src!);
});

test("locking during a slow load stops scheduling decrypts and unlock reloads safely", async ({ page }) => {
  await page.goto("/");
  for (let i = 0; i < 12; i++) await createTextEntry(page, `취소 가능한 기록 ${i}`);
  await expect(page.locator(".entry")).toHaveCount(12);
  await page.addInitScript(() => {
    localStorage.setItem("miroven:low_spec_mode", "true");
    const state = { started: 0, finished: 0, release: () => {} };
    const gate = new Promise<void>((resolve) => { state.release = resolve; });
    (window as unknown as { decryptGate: typeof state }).decryptGate = state;
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    crypto.subtle.decrypt = async (...args) => {
      state.started++;
      await gate;
      try { return await decrypt(...args); } finally { state.finished++; }
    };
  });
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { decryptGate: { started: number } }).decryptGate.started === 8);
  await page.getByRole("button", { name: "금고 잠그기" }).click();
  await expect(page.getByRole("heading", { name: "금고가 잠겨 있습니다" })).toBeVisible();
  await page.evaluate(() => (window as unknown as { decryptGate: { release: () => void } }).decryptGate.release());
  // Each started v3 record finishes its two crypto calls, but no next record starts.
  await page.waitForFunction(() => (window as unknown as { decryptGate: { finished: number } }).decryptGate.finished === 16);
  expect(await page.evaluate(() => (window as unknown as { decryptGate: { started: number } }).decryptGate.started)).toBe(16);
  await expect(page.locator(".entry")).toHaveCount(0);
  await page.getByRole("button", { name: "금고 잠금 해제" }).click();
  await expect(page.locator(".entry")).toHaveCount(12);
});

test("warns before leaving with an unsaved draft", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "무슨 생각을 하고 있나요?" })
    .fill("아직 저장하지 않은 기록");

  const dialogPromise = page.waitForEvent("dialog");
  const navigationPromise = page.goto("about:blank");
  const dialog = await dialogPromise;

  expect(dialog.type()).toBe("beforeunload");
  await dialog.accept();
  await navigationPromise;
  expect(page.url()).toBe("about:blank");
});

test("asks before a manual lock discards an unsaved draft", async ({ page }) => {
  const plaintext = "수동 잠금 전에 확인할 초안";

  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" });
  await composer.fill(plaintext);

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "금고 잠그기" }).click();
  await expect(composer).toHaveValue(plaintext);
  await expect(page.getByRole("heading", { name: "금고가 잠겨 있습니다" })).toHaveCount(0);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "금고 잠그기" }).click();
  await expect(page.getByRole("heading", { name: "금고가 잠겨 있습니다" })).toBeVisible();
  expect(await page.locator("body").textContent()).not.toContain(plaintext);
});

test("shows a warning when browser storage is nearly full", async ({ page }) => {
  await page.addInitScript(() => {
    const megabyte = 1024 * 1024;
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        estimate: async () => ({ usage: 96 * megabyte, quota: 100 * megabyte }),
        persisted: async () => false,
        persist: async () => false,
      },
    });
  });

  await page.goto("/");
  const warning = page.getByRole("alert", { name: "저장 공간이 부족합니다" });
  await expect(warning).toContainText("저장 공간이 부족합니다");
  await expect(warning).toContainText("약 4.0MB 남았습니다");
  await expect(page.getByText("96.0 / 100.0 MB 사용 중", { exact: false })).toBeVisible();
});

test("auto-detects English locale for non-Korean browser settings", async ({ browser }) => {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByText("My journal", { exact: true })).toBeVisible();
  await context.close();
});

test("closes sub-modal first before closing settings dialog when pressing Escape", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "계정", exact: true }).click();
  await expect(page.getByRole("heading", { name: "계정" })).toBeVisible();
  await expect(page.getByRole("group", { name: "계정 및 동기화" })).toBeVisible();
  await expect(page.getByRole("group", { name: "암호화 백업" })).toBeVisible();

  await page.getByRole("button", { name: "PIN 잠금 설정" }).click();
  await expect(page.getByRole("heading", { name: "🔒 PIN 암호화 잠금 설정" })).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByRole("heading", { name: "🔒 PIN 암호화 잠금 설정" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "계정" })).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByRole("heading", { name: "계정" })).toHaveCount(0);
});

