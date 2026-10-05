export const electronTrpcClient = {
	window: {
		getHomeDir: { query: async () => "/home/node" },
		getDirectoryStatus: {
			query: async ({ path }: { path: string }) => ({
				exists: path === "/workspace/project with spaces",
				isDirectory: path === "/workspace/project with spaces",
			}),
		},
	},
};
