import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";

export async function selectCloudDirectory(options?: {
	title?: string;
	defaultPath?: string;
}): Promise<string | null> {
	const opener =
		document.activeElement instanceof HTMLElement
			? document.activeElement
			: null;
	const parent =
		opener?.closest('[role="dialog"], [role="alertdialog"], dialog') ??
		document.body;
	const { electronTrpcClient } = await import("../lib/trpc-client");
	const home =
		options?.defaultPath ??
		(await electronTrpcClient.window.getHomeDir.query());
	return new Promise((resolve) => {
		const dialog = document.createElement("dialog");
		dialog.style.cssText =
			"pointer-events:auto;padding:24px;border:1px solid #555;border-radius:12px;background:var(--background,#191919);color:var(--foreground,#eee);min-width:min(480px,80vw);font:inherit";
		const form = document.createElement("form");
		const label = document.createElement("label");
		label.textContent =
			options?.title ?? i18n._(msg({ message: "Select Directory" }));
		const input = document.createElement("input");
		input.value = home;
		input.setAttribute(
			"aria-label",
			i18n._(msg({ message: "Directory path" })),
		);
		input.style.cssText =
			"display:block;box-sizing:border-box;width:100%;margin:16px 0;padding:10px;background:transparent;color:inherit;border:1px solid #777;border-radius:6px;font:inherit";
		const error = document.createElement("p");
		error.setAttribute("role", "alert");
		const cancel = document.createElement("button");
		cancel.type = "button";
		cancel.textContent = i18n._(msg({ message: "Cancel" }));
		const open = document.createElement("button");
		open.type = "submit";
		open.textContent = i18n._(msg({ message: "Open" }));
		for (const button of [cancel, open])
			button.style.cssText =
				"padding:6px 16px;border:1px solid #777;border-radius:6px;margin-right:8px";
		function finish(value: string | null) {
			window.removeEventListener("keydown", handleEscape, true);
			dialog.close();
			dialog.remove();
			if (opener?.isConnected) opener.focus();
			resolve(value);
		}
		function handleEscape(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			finish(null);
		}
		dialog.onkeydown = (event) => {
			if (event.key !== "Tab") return;
			event.stopPropagation();
			const last = open.disabled ? cancel : open;
			if (event.shiftKey && document.activeElement === input) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				input.focus();
			}
		};
		cancel.onclick = () => finish(null);
		dialog.oncancel = (event) => {
			event.preventDefault();
			finish(null);
		};
		form.onsubmit = async (event) => {
			event.preventDefault();
			open.disabled = true;
			try {
				const status = await electronTrpcClient.window.getDirectoryStatus.query(
					{ path: input.value },
				);
				if (!status.isDirectory) {
					error.textContent = i18n._(msg({ message: "Directory not found" }));
					return;
				}
				finish(input.value);
			} catch (failure) {
				error.textContent =
					failure instanceof Error
						? failure.message
						: i18n._(msg({ message: "Could not open directory" }));
			} finally {
				open.disabled = false;
			}
		};
		label.append(input);
		form.append(label, error, cancel, open);
		dialog.append(form);
		(parent.isConnected ? parent : document.body).append(dialog);
		window.addEventListener("keydown", handleEscape, true);
		dialog.showModal();
		input.focus();
	});
}
