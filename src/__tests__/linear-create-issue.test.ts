import { describe, expect, mock, test } from "bun:test";

const mockClient = {
	teams: mock(() =>
		Promise.resolve({
			nodes: [
				{ id: "team-1", name: "Ack", key: "ACK" },
				{ id: "team-2", name: "Beta", key: "BET" },
			],
		}),
	),
	issueLabels: mock(() => Promise.resolve({ nodes: [] as { id: string }[] })),
	createIssueLabel: mock(() =>
		Promise.resolve({
			issueLabel: Promise.resolve({ id: "new-label-id" }),
		}),
	),
	createIssue: mock(() =>
		Promise.resolve({
			issue: Promise.resolve({
				id: "issue-1",
				identifier: "ACK-210",
				url: "https://linear.app/ack/issue/ACK-210",
			} as { id: string; identifier: string; url: string } | null),
		}),
	),
};

mock.module("@linear/sdk", () => ({
	// biome-ignore lint/complexity/useArrowFunction: must be a regular function for `new` to work
	LinearClient: function () {
		return mockClient;
	},
}));

const { LinearTracker } = await import("../tracker/linear.js");

describe("LinearTracker.createIssue", () => {
	test("resolves existing labels and creates issue", async () => {
		mockClient.issueLabels.mockResolvedValueOnce({
			nodes: [{ id: "existing-label-id" }],
		});
		mockClient.createIssue.mockResolvedValueOnce({
			issue: Promise.resolve({
				id: "issue-1",
				identifier: "ACK-210",
				url: "https://linear.app/ack/issue/ACK-210",
			}),
		});

		const tracker = new LinearTracker("test-key");
		const result = await tracker.createIssue({
			teamId: "team-1",
			title: "Test issue",
			description: "Test description",
			labelNames: ["Critter"],
		});

		expect(result).toEqual({
			id: "issue-1",
			identifier: "ACK-210",
			url: "https://linear.app/ack/issue/ACK-210",
		});
		expect(mockClient.createIssue).toHaveBeenCalledWith({
			teamId: "team-1",
			title: "Test issue",
			description: "Test description",
			labelIds: ["existing-label-id"],
		});
		expect(mockClient.createIssueLabel).not.toHaveBeenCalled();
	});

	test("creates missing labels before creating issue", async () => {
		mockClient.issueLabels.mockResolvedValueOnce({ nodes: [] });
		mockClient.createIssueLabel.mockResolvedValueOnce({
			issueLabel: Promise.resolve({ id: "new-label-id" }),
		});
		mockClient.createIssue.mockResolvedValueOnce({
			issue: Promise.resolve({
				id: "issue-2",
				identifier: "ACK-211",
				url: "https://linear.app/ack/issue/ACK-211",
			}),
		});

		const tracker = new LinearTracker("test-key");
		const result = await tracker.createIssue({
			teamId: "team-1",
			title: "Test issue 2",
			description: "Description 2",
			labelNames: ["Critter"],
		});

		expect(result.id).toBe("issue-2");
		expect(mockClient.createIssueLabel).toHaveBeenCalledWith({
			name: "Critter",
			color: "#8B5CF6",
		});
		expect(mockClient.createIssue).toHaveBeenCalledWith({
			teamId: "team-1",
			title: "Test issue 2",
			description: "Description 2",
			labelIds: ["new-label-id"],
		});
	});

	test("throws when issue creation fails", async () => {
		mockClient.issueLabels.mockResolvedValueOnce({ nodes: [] });
		mockClient.createIssueLabel.mockResolvedValueOnce({
			issueLabel: Promise.resolve({ id: "label-id" }),
		});
		mockClient.createIssue.mockResolvedValueOnce({
			issue: Promise.resolve(null),
		});

		const tracker = new LinearTracker("test-key");
		await expect(
			tracker.createIssue({
				teamId: "team-1",
				title: "Failing issue",
				description: "Will fail",
				labelNames: ["Critter"],
			}),
		).rejects.toThrow("Failed to create issue");
	});
});

describe("LinearTracker.listTeams", () => {
	test("returns correct TrackerTeam shape", async () => {
		mockClient.teams.mockResolvedValueOnce({
			nodes: [
				{ id: "team-1", name: "Ack", key: "ACK" },
				{ id: "team-2", name: "Beta", key: "BET" },
			],
		});

		const tracker = new LinearTracker("test-key");
		const teams = await tracker.listTeams();

		expect(teams).toEqual([
			{ id: "team-1", name: "Ack", key: "ACK" },
			{ id: "team-2", name: "Beta", key: "BET" },
		]);
	});
});
