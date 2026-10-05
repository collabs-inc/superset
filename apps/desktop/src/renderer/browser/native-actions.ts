import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "lib/trpc/routers";
import { asOpenNewResult } from "./project-result";
import { selectCloudDirectory } from "./select-directory";
import { selectBrowserImage } from "./select-image";

function openExternal(value: string): void {
	const url = new URL(value);
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password
	)
		throw new Error(i18n._(msg({ message: "Unsupported URL" })));
	window.open(url.href, "_blank", "noopener,noreferrer");
}

async function nativeAction(path: string, input: unknown): Promise<unknown> {
	switch (path) {
		case "window.getPlatform":
			return window.App.platform;
		case "window.getZoomFactor":
			return 1;
		case "window.selectImageFile":
			return selectBrowserImage();
		case "external.copyPath":
		case "external.copyText":
			return navigator.clipboard.writeText(String(input));
		case "external.openUrl":
			return openExternal(String(input));
		case "window.openNew":
			openExternal(window.location.href);
			return { success: true };
		case "window.setTitleBarOverlay":
			return { success: false };
		case "window.selectDirectory": {
			const selected = await selectCloudDirectory(
				input as { title?: string; defaultPath?: string } | undefined,
			);
			return { canceled: selected === null, path: selected };
		}
		case "projects.openNew": {
			const selected = await selectCloudDirectory();
			if (!selected) return { canceled: true };
			const { electronTrpcClient } = await import("../lib/trpc-client");
			return asOpenNewResult(
				await electronTrpcClient.projects.openFromPath.mutate({
					path: selected,
				}),
			);
		}
		case "autoUpdate.check":
		case "autoUpdate.checkInteractive":
		case "autoUpdate.install":
			throw new Error(
				i18n._(
					msg({ message: "Update Superset from Cube's Manage app menu." }),
				),
			);
		case "external.openInFinder":
		case "external.openFolderInFinder":
		case "external.openInApp":
		case "external.openFileInEditor":
			throw new Error(
				i18n._(
					msg({
						message:
							"Use Superset's file explorer to open files on the cloud machine.",
					}),
				),
			);
	}
}

const localActions = new Set([
	"window.selectImageFile",
	"window.getPlatform",
	"window.getZoomFactor",
	"external.copyPath",
	"external.copyText",
	"external.openUrl",
	"window.openNew",
	"window.setTitleBarOverlay",
	"window.selectDirectory",
	"projects.openNew",
	"autoUpdate.check",
	"autoUpdate.checkInteractive",
	"autoUpdate.install",
	"external.openInFinder",
	"external.openFolderInFinder",
	"external.openInApp",
	"external.openFileInEditor",
]);

export function browserNativeLink(): TRPCLink<AppRouter> {
	return () =>
		({ op, next }) => {
			if (!localActions.has(op.path)) return next(op);
			return observable((observer) => {
				let canceled = false;
				void nativeAction(op.path, op.input).then(
					(data) => {
						if (!canceled) {
							observer.next({ result: { data } });
							observer.complete();
						}
					},
					(error) => {
						if (!canceled) observer.error(TRPCClientError.from(error));
					},
				);
				return () => {
					canceled = true;
				};
			});
		};
}
