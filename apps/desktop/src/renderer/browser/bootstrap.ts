import { version } from "~/package.json";
import { isBrowserHost } from "./mode";

if (isBrowserHost) {
	window.cubeBrowserHost = true;
	document.documentElement.classList.add("cube-browser-host");
	window.App = {
		appVersion: version,
		platform: /mac/i.test(navigator.platform)
			? "darwin"
			: /win/i.test(navigator.platform)
				? "win32"
				: "linux",
		username: "node",
		sayHelloFromBridge() {},
	};
	window.webUtils = { getPathForFile: () => "" };
}
