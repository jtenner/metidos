import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

type ForecastPeriod = {
  detailedForecast: string;
  endTime: string;
  isDaytime: boolean;
  name: string;
  probabilityOfPrecipitation?: { value: number | null } | null;
  shortForecast: string;
  startTime: string;
  temperature: number;
  temperatureUnit: string;
  windDirection: string;
  windSpeed: string;
};

type ForecastDetails = {
  coordinates: string;
  forecastUrl: string;
  generatedAt: string | null;
  periods: ForecastPeriod[];
};

type CacheEntry = {
  expiresAt: number;
  result: ForecastDetails;
};

const WEATHER_POINTS_BASE_URL = "https://api.weather.gov/points";
const CACHE_TTL_MS = 30 * 60 * 1000;
const forecastCache = new Map<string, CacheEntry>();

function parseCoordinates(input: unknown): {
  latitude: number;
  longitude: number;
  normalized: string;
} {
  const raw = typeof input === "string" ? input : "";
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/u.exec(raw);
  if (!match) {
    throw new Error(
      "Weather coordinates must use Google Maps format: latitude, longitude.",
    );
  }
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error("Weather latitude must be between -90 and 90.");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error("Weather longitude must be between -180 and 180.");
  }
  return { latitude, longitude, normalized: `${latitude},${longitude}` };
}

function propertyString(value: unknown, name: string): string {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Weather response missing ${name}.`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record[name] !== "string" || !record[name]) {
    throw new Error(`Weather response missing ${name}.`);
  }
  return record[name];
}

function forecastPeriods(value: unknown): ForecastPeriod[] {
  if (typeof value !== "object" || value === null) return [];
  const properties = (value as Record<string, unknown>).properties;
  if (typeof properties !== "object" || properties === null) return [];
  const periods = (properties as Record<string, unknown>).periods;
  if (!Array.isArray(periods)) return [];
  return periods.filter((period): period is ForecastPeriod => {
    if (typeof period !== "object" || period === null) return false;
    const record = period as Partial<ForecastPeriod>;
    return (
      typeof record.name === "string" &&
      typeof record.startTime === "string" &&
      typeof record.endTime === "string" &&
      typeof record.temperature === "number" &&
      typeof record.temperatureUnit === "string" &&
      typeof record.windSpeed === "string" &&
      typeof record.windDirection === "string" &&
      typeof record.shortForecast === "string" &&
      typeof record.detailedForecast === "string"
    );
  });
}

function escapeCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function precip(period: ForecastPeriod): string {
  const value = period.probabilityOfPrecipitation?.value;
  return typeof value === "number" ? `${value}%` : "";
}

function verticalForecastTable(periods: ForecastPeriod[]): string {
  const selected = periods.slice(0, 2);
  if (selected.length === 0) return "No forecast periods returned.";
  const headers = selected.map((_, index) =>
    index === 0 ? "Today" : "Tomorrow",
  );
  const rows: Array<[string, (period: ForecastPeriod) => string]> = [
    ["Time", (p) => `${p.startTime} to ${p.endTime}`],
    ["Forecast", (p) => p.shortForecast],
    ["Temperature", (p) => `${p.temperature} ${p.temperatureUnit}`],
    ["Precipitation", precip],
    ["Wind", (p) => `${p.windSpeed} ${p.windDirection}`],
    ["Details", (p) => p.detailedForecast],
  ];
  return [
    `| x | ${headers.map(escapeCell).join(" | ")} |`,
    `|---|${headers.map(() => "---").join("|")}|`,
    ...rows.map(
      ([label, pick]) =>
        `| ${escapeCell(label)} | ${selected.map((p) => escapeCell(pick(p))).join(" | ")} |`,
    ),
  ].join("\n");
}

async function fetchJson(metidosFetch: MetidosPluginApi["fetch"], url: string) {
  const response = await metidosFetch(url, {
    headers: {
      Accept: "application/geo+json, application/json",
      "User-Agent": "Metidos weather plugin",
    },
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(`Weather request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

export default definePlugin((metidos) => {
  metidos.addAgentTool({
    tool: "weather_forecast",
    name: "Weather forecast",
    description:
      "Fetch the configured National Weather Service forecast as a vertical markdown table.",
    timeoutMs: 10_000,
    validateProps() {
      return {};
    },
    async action() {
      const coordinates = metidos.settings.get("coordinates");
      const parsed = parseCoordinates(coordinates);
      const cached = forecastCache.get(parsed.normalized);
      if (cached && cached.expiresAt > Date.now()) {
        return {
          markdown: verticalForecastTable(cached.result.periods),
          type: "markdown",
        };
      }
      const point = await fetchJson(
        metidos.fetch,
        `${WEATHER_POINTS_BASE_URL}/${parsed.normalized}`,
      );
      const properties = (point as { properties?: unknown }).properties;
      const forecastUrl = propertyString(properties, "forecast");
      const forecast = await fetchJson(metidos.fetch, forecastUrl);
      const periods = forecastPeriods(forecast);
      const generatedAt =
        typeof (forecast as { properties?: { generatedAt?: unknown } })
          .properties?.generatedAt === "string"
          ? (forecast as { properties: { generatedAt: string } }).properties
              .generatedAt
          : null;
      forecastCache.set(parsed.normalized, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        result: {
          coordinates: parsed.normalized,
          forecastUrl,
          generatedAt,
          periods,
        },
      });
      return {
        markdown: verticalForecastTable(periods),
        type: "markdown",
      };
    },
  });
});
