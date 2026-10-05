declare global {
	interface Window {
		cubeBrowserHost?: boolean;
	}
}

export const isBrowserHost =
	typeof window !== "undefined" &&
	(window.cubeBrowserHost === true ||
		(!window.ipcRenderer && /^https?:$/.test(window.location?.protocol ?? "")));
