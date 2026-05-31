/**
 * Static calendar preview for the features band on the landing page.
 * Renders a May 2026 month grid from fake calendars and events.
 */

/** @type {{ id: string; title: string; color: string; kind: "local" | "ics" }[]} */
const MOCK_CALENDARS = [
	{ id: "sprints", title: "Engineering sprints", color: "#4a90c4", kind: "local" },
	{ id: "releases", title: "Release train", color: "#c4983a", kind: "local" },
	{ id: "timeoff", title: "Team time off", color: "#8b6fc0", kind: "local" },
	{ id: "feeds", title: "Shared feeds", color: "#687580", kind: "ics" },
];

/** @type {string[]} */
const MOCK_EVENT_TITLES = [
	"Standup sync",
	"Deploy window",
	"Code review block",
	"Pairing session",
	"Sprint retro",
	"Architecture review",
	"Bug bash",
	"Release cutover",
	"Dependency audit",
	"Docs update",
	"On-call handoff",
	"Design critique",
	"Stakeholder demo",
	"Merge queue check",
	"Performance triage",
	"Plugin review",
	"Thread checkpoint",
	"Worktree sync",
	"CI health check",
	"Roadmap grooming",
	"Schema migration",
	"Security review",
	"Load test window",
	"Feature flag rollout",
];

const ANCHOR_YEAR = 2026;
const ANCHOR_MONTH = 4; // May (0-indexed)
const TODAY_KEY = "2026-05-30";
const MAX_VISIBLE_EVENTS = 3;

/**
 * @param {Date} date
 * @returns {string}
 */
function toDateKey(date) {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

/**
 * @param {Date} anchor
 * @returns {Date[]}
 */
function monthGridDays(anchor) {
	const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
	const start = new Date(first);
	start.setDate(first.getDate() - first.getDay());
	return Array.from({ length: 42 }, (_, index) => {
		const day = new Date(start);
		day.setDate(start.getDate() + index);
		return day;
	});
}

/**
 * Deterministic pseudo-random in [0, 1) from a string seed.
 * @param {string} seed
 */
function hashSeed(seed) {
	let hash = 2166136261;
	for (let i = 0; i < seed.length; i += 1) {
		hash ^= seed.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0) / 4294967296;
}

/**
 * @param {string} dayKey
 * @returns {{ calendarId: string; title: string }[]}
 */
function buildEventsForDay(dayKey) {
	const slot = Number(dayKey.slice(-2));
	const baseCount = 1 + Math.floor(hashSeed(dayKey) * 3);
	const count = slot % 7 === 0 ? baseCount + 1 : baseCount;

	/** @type {{ calendarId: string; title: string }[]} */
	const events = [];
	for (let i = 0; i < count; i += 1) {
		const calendar = MOCK_CALENDARS[(slot + i) % MOCK_CALENDARS.length];
		const title =
			MOCK_EVENT_TITLES[
				(slot + i * 3 + Math.floor(hashSeed(`${dayKey}:${i}`) * 100)) %
					MOCK_EVENT_TITLES.length
			];
		events.push({ calendarId: calendar.id, title });
	}
	return events;
}

/** Every cell in the six-week May 2026 grid, with at least one event per day. */
/** @type {{ dayKey: string; calendarId: string; title: string }[]} */
const MOCK_EVENTS = monthGridDays(new Date(ANCHOR_YEAR, ANCHOR_MONTH, 1)).flatMap(
	(day) => {
		const dayKey = toDateKey(day);
		return buildEventsForDay(dayKey).map((event) => ({
			dayKey,
			...event,
		}));
	},
);

/**
 * @param {string} calendarId
 * @returns {string}
 */
function calendarColor(calendarId) {
	const calendar = MOCK_CALENDARS.find((item) => item.id === calendarId);
	return calendar?.color ?? "#687580";
}

/**
 * @param {HTMLElement} root
 */
function renderCalendarMock(root) {
	const grid = root.querySelector("[data-calendar-grid]");
	if (!grid) return;

	const eventsByDay = new Map();
	for (const event of MOCK_EVENTS) {
		const bucket = eventsByDay.get(event.dayKey) ?? [];
		bucket.push(event);
		eventsByDay.set(event.dayKey, bucket);
	}

	const anchor = new Date(ANCHOR_YEAR, ANCHOR_MONTH, 1);
	const days = monthGridDays(anchor);
	const rows = Array.from({ length: 6 }, (_, rowIndex) =>
		days.slice(rowIndex * 7, rowIndex * 7 + 7),
	);

	const tbody = document.createElement("tbody");
	for (const row of rows) {
		const tr = document.createElement("tr");
		for (const day of row) {
			const key = toDateKey(day);
			const inMonth = day.getMonth() === ANCHOR_MONTH;
			const events = eventsByDay.get(key) ?? [];
			const visible = events.slice(0, MAX_VISIBLE_EVENTS);
			const overflow = events.length - visible.length;

			const td = document.createElement("td");
			td.className =
				"calendar-mock-cell min-h-[4.5rem] border-b border-r border-border-subtle p-1 align-top";

			const dayBtn = document.createElement("span");
			dayBtn.className = [
				"calendar-mock-day mb-1 inline-flex h-5 min-w-5 items-center justify-center px-1 text-[10px]",
				key === TODAY_KEY
					? "border border-accent bg-surface-2 text-text-primary"
					: "text-text-faint",
				inMonth ? "" : "opacity-60",
			]
				.filter(Boolean)
				.join(" ");
			dayBtn.textContent = String(day.getDate());
			td.appendChild(dayBtn);

			const list = document.createElement("div");
			list.className = "space-y-0.5";
			for (const event of visible) {
				const pill = document.createElement("span");
				pill.className = "calendar-mock-event";
				pill.style.setProperty(
					"--calendar-event-color",
					calendarColor(event.calendarId),
				);
				pill.textContent = event.title;
				list.appendChild(pill);
			}
			if (overflow > 0) {
				const more = document.createElement("span");
				more.className = "block text-[10px] text-text-faint";
				more.textContent = `+${overflow} more`;
				list.appendChild(more);
			}
			td.appendChild(list);
			tr.appendChild(td);
		}
		tbody.appendChild(tr);
	}

	grid.replaceChildren(tbody);
}

document.querySelectorAll("[data-calendar-mock]").forEach((root) => {
	if (root instanceof HTMLElement) {
		renderCalendarMock(root);
	}
});
