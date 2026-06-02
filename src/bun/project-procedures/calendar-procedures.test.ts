import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AuthServiceError } from "../auth/service";
import { closeAppDatabase, resetResolvedAppDataDirectory } from "../db";
import type { RpcRequestContext } from "../rpc-schema";

const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;
let appDataDir: string;

beforeAll(() => {
  closeAppDatabase();
  appDataDir = mkdtempSync(join(tmpdir(), "metidos-calendar-procedures-"));
  process.env.METIDOS_APP_DATA_DIR = appDataDir;
  resetResolvedAppDataDirectory();
});

afterAll(() => {
  closeAppDatabase();
  if (originalAppDataDir === undefined) {
    delete process.env.METIDOS_APP_DATA_DIR;
  } else {
    process.env.METIDOS_APP_DATA_DIR = originalAppDataDir;
  }
  resetResolvedAppDataDirectory();
  rmSync(appDataDir, { recursive: true, force: true });
});

function authenticatedContext(userId = 1): RpcRequestContext {
  return {
    auth: {
      isAdmin: true,
      sessionId: `calendar-procedures-test-${userId}`,
      userId,
      username: `operator-${userId}`,
    },
    signal: new AbortController().signal,
    priority: "default",
    timeoutMs: null,
  };
}

async function expectProcedureError(
  call: () => Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  await expect(call()).rejects.toThrow(expectedMessage);
}

describe("calendar project procedures auth seam", () => {
  it("rejects representative calendar procedures without an authenticated local operator", async () => {
    const {
      createCalendarEventProcedure,
      createCalendarProcedure,
      createExternalIcsCalendarProcedure,
      deleteCalendarEventProcedure,
      deleteCalendarProcedure,
      deleteExternalIcsCalendarProcedure,
      dismissCalendarNotificationProcedure,
      getCalendarBootstrapProcedure,
      leaveSharedCalendarProcedure,
      listCalendarNotificationsProcedure,
      listCalendarOccurrencesProcedure,
      refreshExternalIcsCalendarProcedure,
      setCalendarShareProcedure,
      snoozeCalendarNotificationProcedure,
      updateCalendarEventProcedure,
      updateCalendarNotificationSettingsProcedure,
      updateCalendarPreferenceProcedure,
      updateCalendarProcedure,
      updateExternalIcsCalendarProcedure,
    } = await import("./calendar-procedures");

    const occurrenceWindow = {
      start: "2026-06-02T00:00:00.000Z",
      end: "2026-06-03T00:00:00.000Z",
    };
    const procedureCalls: Array<{
      name: string;
      call: () => Promise<unknown>;
    }> = [
      {
        name: "getCalendarBootstrapProcedure",
        call: () => getCalendarBootstrapProcedure(undefined),
      },
      {
        name: "listCalendarOccurrencesProcedure",
        call: () => listCalendarOccurrencesProcedure(occurrenceWindow),
      },
      {
        name: "createCalendarProcedure",
        call: () => createCalendarProcedure({ title: "Blocked" } as never),
      },
      {
        name: "updateCalendarProcedure",
        call: () =>
          updateCalendarProcedure({ calendarId: 1, title: "Blocked" }),
      },
      {
        name: "deleteCalendarProcedure",
        call: () => deleteCalendarProcedure({ calendarId: 1 }),
      },
      {
        name: "leaveSharedCalendarProcedure",
        call: () => leaveSharedCalendarProcedure({ calendarId: 1 }),
      },
      {
        name: "updateCalendarPreferenceProcedure",
        call: () =>
          updateCalendarPreferenceProcedure({
            calendarId: 1,
            visible: true,
          } as never),
      },
      {
        name: "setCalendarShareProcedure",
        call: () =>
          setCalendarShareProcedure({
            calendarId: 1,
            permission: "read",
            userId: 2,
          }),
      },
      {
        name: "createCalendarEventProcedure",
        call: () => createCalendarEventProcedure({} as never),
      },
      {
        name: "updateCalendarEventProcedure",
        call: () => updateCalendarEventProcedure({} as never),
      },
      {
        name: "deleteCalendarEventProcedure",
        call: () => deleteCalendarEventProcedure({ eventId: 1 } as never),
      },
      {
        name: "createExternalIcsCalendarProcedure",
        call: () => createExternalIcsCalendarProcedure({} as never),
      },
      {
        name: "updateExternalIcsCalendarProcedure",
        call: () =>
          updateExternalIcsCalendarProcedure({ externalCalendarId: 1 }),
      },
      {
        name: "refreshExternalIcsCalendarProcedure",
        call: () =>
          refreshExternalIcsCalendarProcedure({ externalCalendarId: 1 }),
      },
      {
        name: "deleteExternalIcsCalendarProcedure",
        call: () =>
          deleteExternalIcsCalendarProcedure({ externalCalendarId: 1 }),
      },
      {
        name: "updateCalendarNotificationSettingsProcedure",
        call: () =>
          updateCalendarNotificationSettingsProcedure({
            browserNotificationsEnabled: true,
            inAppNotificationsEnabled: true,
          } as never),
      },
      {
        name: "listCalendarNotificationsProcedure",
        call: () => listCalendarNotificationsProcedure(undefined),
      },
      {
        name: "dismissCalendarNotificationProcedure",
        call: () => dismissCalendarNotificationProcedure({ deliveryId: 1 }),
      },
      {
        name: "snoozeCalendarNotificationProcedure",
        call: () =>
          snoozeCalendarNotificationProcedure({
            deliveryId: 1,
            snoozedUntil: "2026-06-02T01:00:00.000Z",
          }),
      },
    ];

    expect.assertions(procedureCalls.length * 3);
    for (const { name, call } of procedureCalls) {
      try {
        await call();
      } catch (error) {
        expect(error, name).toBeInstanceOf(AuthServiceError);
        expect((error as AuthServiceError).code, name).toBe("session_required");
        expect((error as AuthServiceError).message, name).toBe(
          "A valid authenticated session is required for calendar access.",
        );
      }
    }
  });

  it("keeps authenticated procedure access bounded to non-deleted calendars and events", async () => {
    const {
      createCalendarEventProcedure,
      createCalendarProcedure,
      deleteCalendarEventProcedure,
      deleteCalendarProcedure,
      updateCalendarEventProcedure,
      updateCalendarPreferenceProcedure,
    } = await import("./calendar-procedures");
    const context = authenticatedContext(42);

    const deletedCalendar = await createCalendarProcedure(
      { title: "Deleted boundary calendar" },
      context,
    );
    await deleteCalendarProcedure({ calendarId: deletedCalendar.id }, context);

    await expectProcedureError(
      () =>
        updateCalendarPreferenceProcedure(
          { calendarId: deletedCalendar.id, visible: true },
          context,
        ),
      "Calendar not found or not visible.",
    );
    await expectProcedureError(
      () =>
        createCalendarEventProcedure(
          {
            calendarId: deletedCalendar.id,
            title: "Blocked deleted-calendar event",
            startAt: "2026-06-02T15:00:00.000Z",
            endAt: "2026-06-02T15:30:00.000Z",
            timezone: "UTC",
          },
          context,
        ),
      "Calendar not found or not visible.",
    );

    const liveCalendar = await createCalendarProcedure(
      { title: "Event boundary calendar" },
      context,
    );
    const deletedEvent = await createCalendarEventProcedure(
      {
        calendarId: liveCalendar.id,
        title: "Deleted boundary event",
        startAt: "2026-06-02T16:00:00.000Z",
        endAt: "2026-06-02T16:30:00.000Z",
        timezone: "UTC",
      },
      context,
    );
    await deleteCalendarEventProcedure({ eventId: deletedEvent.id }, context);

    await expectProcedureError(
      () =>
        updateCalendarEventProcedure(
          { eventId: deletedEvent.id, title: "Blocked update" },
          context,
        ),
      "Event not found.",
    );
    await expectProcedureError(
      () => deleteCalendarEventProcedure({ eventId: deletedEvent.id }, context),
      "Event not found.",
    );
  });
});
