import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

const { chromium } = await import(
	process.env.PLAYWRIGHT_MODULE ?? "playwright-core"
);
const cacheDir = await mkdtemp(join(tmpdir(), "superset-directory-picker-"));
const desktopDir = fileURLToPath(new URL("../", import.meta.url));
const serviceFixture = fileURLToPath(
	new URL(
		"../src/renderer/browser/fixtures/directory-service.ts",
		import.meta.url,
	),
);
const server = await createServer({
	configFile: false,
	root: desktopDir,
	cacheDir,
	optimizeDeps: {
		entries: ["src/renderer/browser/fixtures/directory-picker.tsx"],
	},
	resolve: {
		dedupe: ["react", "react-dom"],
		alias: { "../lib/trpc-client": serviceFixture },
	},
	plugins: [
		{
			name: "directory-service-fixture",
			configureServer(vite) {
				vite.middlewares.use((req, res, next) => {
					if (req.url !== "/") return next();
					res.setHeader("Content-Type", "text/html");
					res.end(
						'<!doctype html><html><head><title>Directory picker fixture</title></head><body><div id="fixture"></div><script type="module" src="/src/renderer/browser/fixtures/directory-picker.tsx"></script></body></html>',
					);
				});
			},
		},
		react({
			include: /\/(directory-picker\.tsx|select-directory\.ts)$/,
			babel: { plugins: ["@lingui/babel-plugin-lingui-macro"] },
		}),
	],
	server: {
		host: "127.0.0.1",
		port: 0,
		hmr: false,
		fs: {
			allow: [cacheDir, fileURLToPath(new URL("../../../", import.meta.url))],
		},
	},
});
let closeBrowser = async () => {};
try {
	await server.listen();
	assert(server.httpServer);
	const address = server.httpServer.address();
	assert(address && typeof address === "object");
	const browser = await chromium.launch({
		channel: process.env.CHROME_CHANNEL ?? "chrome",
		headless: true,
	});
	closeBrowser = () => browser.close();
	const page = await browser.newPage();
	page.setDefaultTimeout(3000);
	const errors: string[] = [];
	page.on("pageerror", (error: Error) => {
		errors.push(error.message);
		console.error(error.message);
	});
	await page.goto(`http://127.0.0.1:${address.port}`);
	await page.getByRole("button", { name: "New project", exact: true }).click();
	assert.equal(
		await page.evaluate(() => document.body.style.pointerEvents),
		"none",
	);
	await page
		.getByRole("button", { name: "Choose folder", exact: true })
		.click();
	const picker = page.locator("dialog[open]");
	const path = picker.getByRole("textbox", { name: "Directory path" });
	await path.fill("/missing");
	await picker.getByRole("button", { name: "Open", exact: true }).click();
	await picker
		.getByRole("alert")
		.filter({ hasText: "Directory not found" })
		.waitFor();
	await path.fill("/workspace/project with spaces");
	await path.focus();
	for (let index = 0; index < 4; index++) {
		await page.keyboard.press("Tab");
		assert(
			await picker.evaluate((element: HTMLElement) =>
				element.contains(document.activeElement),
			),
			"Tab escaped the directory picker",
		);
	}
	await path.focus();
	await page.keyboard.press("Shift+Tab");
	assert(
		await picker
			.getByRole("button", { name: "Open", exact: true })
			.evaluate((element: HTMLElement) => element === document.activeElement),
	);
	await picker.getByRole("button", { name: "Open", exact: true }).click();
	await page
		.locator("output")
		.filter({ hasText: "/workspace/project with spaces" })
		.waitFor({ state: "attached" });
	assert.equal(await picker.count(), 0);
	assert(
		await page
			.getByRole("button", { name: "Choose folder", exact: true })
			.evaluate((element: HTMLElement) => element === document.activeElement),
	);
	await page
		.getByRole("button", { name: "Choose folder", exact: true })
		.click();
	await picker.getByRole("button", { name: "Cancel", exact: true }).click();
	assert.equal(await picker.count(), 0);
	await page
		.getByRole("button", { name: "Choose folder", exact: true })
		.click();
	await picker.waitFor();
	await page.keyboard.press("Escape");
	assert.equal(await picker.count(), 0);
	assert.equal(
		await page.getByRole("dialog", { name: "Create project" }).count(),
		1,
		"Escape closed the project dialog",
	);
	assert.equal(await page.locator("output").textContent(), "Canceled");
	await page.getByRole("button", { name: "Close project" }).click();
	await page.getByRole("button", { name: "Standalone picker" }).click();
	await picker
		.getByRole("textbox", { name: "Directory path" })
		.fill("/workspace/project with spaces");
	await page.keyboard.press("Enter");
	await page
		.locator("output")
		.filter({ hasText: "/workspace/project with spaces" })
		.waitFor();
	assert.equal(await picker.count(), 0);
	assert.deepEqual(errors, []);
	console.log(
		"Directory picker passed: modal input, invalid path, spaces, Tab focus, submit, cancel, Escape, focus restoration, standalone submit.",
	);
} finally {
	await closeBrowser();
	await server.close();
	await rm(cacheDir, { recursive: true, force: true });
}
