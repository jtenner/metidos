import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

type JsonRecord = Record<string, unknown>;

type GoogleSearchProps = {
  device?: "desktop" | "mobile" | "tablet" | undefined;
  filter?: boolean | undefined;
  gl?: string | undefined;
  google_domain?: string | undefined;
  hl?: string | undefined;
  location?: string | undefined;
  lr?: string | undefined;
  no_cache?: boolean | undefined;
  nfpr?: boolean | undefined;
  q: string;
  safe?: "active" | "off" | undefined;
  start?: number | undefined;
  uule?: string | undefined;
  zero_trace?: boolean | undefined;
};

type YouTubeSearchProps = {
  gl?: string | undefined;
  hl?: string | undefined;
  no_cache?: boolean | undefined;
  search_query: string;
  sp?: string | undefined;
  zero_trace?: boolean | undefined;
};

type YouTubeTranscriptProps = {
  language_code?: string | undefined;
  no_cache?: boolean | undefined;
  title?: string | undefined;
  type?: string | undefined;
  v: string;
  zero_trace?: boolean | undefined;
};

type SearchJobsProps = {
  chips?: string | undefined;
  gl?: string | undefined;
  google_domain?: string | undefined;
  hl?: string | undefined;
  location?: string | undefined;
  lrad?: number | undefined;
  ltype?: boolean | undefined;
  next_page_token?: string | undefined;
  q: string;
  uds?: string | undefined;
  uule?: string | undefined;
};

const SERPAPI_SEARCH_URL = "https://serpapi.com/search.json";
const MAX_QUERY_LENGTH = 200;
const MAX_LOCATION_LENGTH = 120;
const MAX_TOKEN_LENGTH = 500;
const MAX_CHIPS_LENGTH = 1000;
const MAX_UDS_LENGTH = 2000;
const MAX_UULE_LENGTH = 500;
const MAX_DOMAIN_LENGTH = 80;
const MAX_LR_LENGTH = 120;
const MAX_VIDEO_ID_LENGTH = 160;
const MAX_TRANSCRIPT_TITLE_LENGTH = 200;
const MAX_TRANSCRIPT_TYPE_LENGTH = 40;
const MAX_LANGUAGE_CODE_LENGTH = 20;
const MAX_YOUTUBE_SEARCH_QUERY_LENGTH = 200;
const MAX_YOUTUBE_SP_LENGTH = 1000;
const MAX_TRANSCRIPT_CHARS = 80000;
const RESULT_DISPLAY_LIMIT = 10;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function nonEmptyString(
  value: unknown,
  name: string,
  maxLength: number,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value.trim().slice(0, maxLength);
}

function optionalString(
  input: JsonRecord,
  key: string,
  maxLength: number,
): string | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === "") return undefined;
  return nonEmptyString(value, key, maxLength);
}

function optionalLocaleCode(
  input: JsonRecord,
  key: string,
): string | undefined {
  const value = optionalString(input, key, 10);
  if (!value) return undefined;
  if (!/^[a-z]{2}$/iu.test(value)) {
    throw new Error(
      `${key} must be a two-letter code such as us, uk, en, or fr.`,
    );
  }
  return value.toLowerCase();
}

function optionalGoogleDomain(input: JsonRecord): string | undefined {
  const value = optionalString(input, "google_domain", MAX_DOMAIN_LENGTH);
  if (!value) return undefined;
  if (!/^[a-z0-9.-]+$/iu.test(value) || value.includes("..")) {
    throw new Error("google_domain must be a domain such as google.com.");
  }
  return value.toLowerCase();
}

function optionalBoolean(input: JsonRecord, key: string): boolean | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean.`);
  return value;
}

function boundedInteger(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.`);
  }
  const integer = Math.trunc(value);
  if (integer < min || integer > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return integer;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function settingValue(
  settings:
    | { get(key: string): unknown; has(key: string): boolean }
    | undefined,
  key: string,
): unknown {
  return settings?.has(key) ? settings.get(key) : undefined;
}

function apiKey(metidos: MetidosPluginApi): string {
  const configured = firstNonEmptyString(
    settingValue(metidos.settings, "api_key"),
    metidos.env.get("SERPAPI_API_KEY"),
  );
  if (configured) return configured;
  throw new Error(
    "Configure the SerpApi api_key setting or SERPAPI_API_KEY env var.",
  );
}

function defaults(metidos: MetidosPluginApi): {
  gl?: string;
  google_domain?: string;
  hl?: string;
} {
  const values: {
    gl?: string;
    google_domain?: string;
    hl?: string;
  } = {};
  const gl = firstNonEmptyString(settingValue(metidos.settings, "gl"));
  if (gl) {
    values.gl = gl;
  }
  const googleDomain = firstNonEmptyString(
    settingValue(metidos.settings, "google_domain"),
  );
  if (googleDomain) {
    values.google_domain = googleDomain;
  }
  const hl = firstNonEmptyString(settingValue(metidos.settings, "hl"));
  if (hl) {
    values.hl = hl;
  }
  return values;
}

function validateSearchJobsProps(input: unknown): SearchJobsProps {
  const props = record(input);
  const location = optionalString(props, "location", MAX_LOCATION_LENGTH);
  const uule = optionalString(props, "uule", MAX_UULE_LENGTH);
  if (location && uule) {
    throw new Error("location and uule cannot be used together.");
  }
  return {
    chips: optionalString(props, "chips", MAX_CHIPS_LENGTH),
    gl: optionalLocaleCode(props, "gl"),
    google_domain: optionalGoogleDomain(props),
    hl: optionalLocaleCode(props, "hl"),
    location,
    lrad: boundedInteger(props.lrad, "lrad", 1, 1000),
    ltype: optionalBoolean(props, "ltype"),
    next_page_token: optionalString(props, "next_page_token", MAX_TOKEN_LENGTH),
    q: nonEmptyString(props.q ?? props.query, "q", MAX_QUERY_LENGTH),
    uds: optionalString(props, "uds", MAX_UDS_LENGTH),
    uule,
  };
}

function validateGoogleSearchProps(input: unknown): GoogleSearchProps {
  const props = record(input);
  const location = optionalString(props, "location", MAX_LOCATION_LENGTH);
  const uule = optionalString(props, "uule", MAX_UULE_LENGTH);
  const device = optionalString(props, "device", 20);
  const safe = optionalString(props, "safe", 20);
  if (location && uule) {
    throw new Error("location and uule cannot be used together.");
  }
  if (
    device &&
    device !== "desktop" &&
    device !== "mobile" &&
    device !== "tablet"
  ) {
    throw new Error("device must be desktop, mobile, or tablet.");
  }
  if (safe && safe !== "active" && safe !== "off") {
    throw new Error("safe must be active or off.");
  }
  return {
    device: device as GoogleSearchProps["device"],
    filter: optionalBoolean(props, "filter"),
    gl: optionalLocaleCode(props, "gl"),
    google_domain: optionalGoogleDomain(props),
    hl: optionalLocaleCode(props, "hl"),
    location,
    lr: optionalString(props, "lr", MAX_LR_LENGTH),
    no_cache: optionalBoolean(props, "no_cache"),
    nfpr: optionalBoolean(props, "nfpr"),
    q: nonEmptyString(props.q ?? props.query, "q", MAX_QUERY_LENGTH),
    safe: safe as GoogleSearchProps["safe"],
    start: boundedInteger(props.start, "start", 0, 990),
    uule,
    zero_trace: optionalBoolean(props, "zero_trace"),
  };
}

function extractYouTubeVideoId(value: string): string {
  const trimmed = value.trim();
  const watchMatch = /[?&]v=([^&#]+)/u.exec(trimmed);
  if (watchMatch?.[1])
    return decodeURIComponent(watchMatch[1]).slice(0, MAX_VIDEO_ID_LENGTH);
  const shortMatch = /youtu\.be\/([^?&#/]+)/u.exec(trimmed);
  if (shortMatch?.[1])
    return decodeURIComponent(shortMatch[1]).slice(0, MAX_VIDEO_ID_LENGTH);
  const shortsMatch = /youtube\.com\/shorts\/([^?&#/]+)/u.exec(trimmed);
  if (shortsMatch?.[1])
    return decodeURIComponent(shortsMatch[1]).slice(0, MAX_VIDEO_ID_LENGTH);
  return trimmed.slice(0, MAX_VIDEO_ID_LENGTH);
}

function validateYouTubeTranscriptProps(
  input: unknown,
): YouTubeTranscriptProps {
  const props = record(input);
  const rawVideo = nonEmptyString(
    props.v ?? props.video_id ?? props.url,
    "v",
    MAX_VIDEO_ID_LENGTH * 2,
  );
  const v = extractYouTubeVideoId(rawVideo);
  if (!/^[a-zA-Z0-9_-]{6,160}$/u.test(v)) {
    throw new Error("v must be a YouTube video ID or a YouTube video URL.");
  }
  const languageCode = optionalString(
    props,
    "language_code",
    MAX_LANGUAGE_CODE_LENGTH,
  );
  if (
    languageCode &&
    !/^[a-z]{2,3}(?:[-_][a-zA-Z0-9]{2,8})?$/u.test(languageCode)
  ) {
    throw new Error(
      "language_code must be a language code such as en, es-ES, or zh-Hans.",
    );
  }
  return {
    language_code: languageCode,
    no_cache: optionalBoolean(props, "no_cache"),
    title: optionalString(props, "title", MAX_TRANSCRIPT_TITLE_LENGTH),
    type: optionalString(props, "type", MAX_TRANSCRIPT_TYPE_LENGTH),
    v,
    zero_trace: optionalBoolean(props, "zero_trace"),
  };
}

function validateYouTubeSearchProps(input: unknown): YouTubeSearchProps {
  const props = record(input);
  return {
    gl: optionalLocaleCode(props, "gl"),
    hl: optionalLocaleCode(props, "hl"),
    no_cache: optionalBoolean(props, "no_cache"),
    search_query: nonEmptyString(
      props.search_query ?? props.q ?? props.query,
      "search_query",
      MAX_YOUTUBE_SEARCH_QUERY_LENGTH,
    ),
    sp: optionalString(props, "sp", MAX_YOUTUBE_SP_LENGTH),
    zero_trace: optionalBoolean(props, "zero_trace"),
  };
}

function encodeQueryComponent(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

function buildQueryString(params: Array<[string, string]>): string {
  return params
    .map(
      ([key, value]) =>
        `${encodeQueryComponent(key)}=${encodeQueryComponent(value)}`,
    )
    .join("&");
}

function buildSearchUrl(
  apiKeyValue: string,
  props: SearchJobsProps,
  configured: ReturnType<typeof defaults>,
): string {
  const params: Array<[string, string]> = [
    ["engine", "google_jobs"],
    ["api_key", apiKeyValue],
    ["q", props.q],
  ];
  if (props.location) params.push(["location", props.location]);
  if (props.uule) params.push(["uule", props.uule]);
  const googleDomain = props.google_domain ?? configured.google_domain;
  const gl = props.gl ?? configured.gl;
  const hl = props.hl ?? configured.hl;
  if (googleDomain) params.push(["google_domain", googleDomain]);
  if (gl) params.push(["gl", gl]);
  if (hl) params.push(["hl", hl]);
  if (props.next_page_token) {
    params.push(["next_page_token", props.next_page_token]);
  }
  if (props.chips) params.push(["chips", props.chips]);
  if (props.lrad !== undefined) params.push(["lrad", String(props.lrad)]);
  if (props.ltype === true) params.push(["ltype", "1"]);
  if (props.uds) params.push(["uds", props.uds]);
  return `${SERPAPI_SEARCH_URL}?${buildQueryString(params)}`;
}

function buildGoogleSearchUrl(
  apiKeyValue: string,
  props: GoogleSearchProps,
  configured: ReturnType<typeof defaults>,
): string {
  const params: Array<[string, string]> = [
    ["engine", "google_light"],
    ["api_key", apiKeyValue],
    ["q", props.q],
  ];
  if (props.location) params.push(["location", props.location]);
  if (props.uule) params.push(["uule", props.uule]);
  const googleDomain = props.google_domain ?? configured.google_domain;
  const gl = props.gl ?? configured.gl;
  const hl = props.hl ?? configured.hl;
  if (googleDomain) params.push(["google_domain", googleDomain]);
  if (gl) params.push(["gl", gl]);
  if (hl) params.push(["hl", hl]);
  if (props.lr) params.push(["lr", props.lr]);
  if (props.device) params.push(["device", props.device]);
  if (props.safe) params.push(["safe", props.safe]);
  if (props.start !== undefined) params.push(["start", String(props.start)]);
  if (props.filter !== undefined)
    params.push(["filter", props.filter ? "1" : "0"]);
  if (props.nfpr !== undefined) params.push(["nfpr", props.nfpr ? "1" : "0"]);
  if (props.no_cache === true) params.push(["no_cache", "true"]);
  if (props.zero_trace === true) params.push(["zero_trace", "true"]);
  return `${SERPAPI_SEARCH_URL}?${buildQueryString(params)}`;
}

function buildYouTubeTranscriptUrl(
  apiKeyValue: string,
  props: YouTubeTranscriptProps,
): string {
  const params: Array<[string, string]> = [
    ["engine", "youtube_video_transcript"],
    ["api_key", apiKeyValue],
    ["v", props.v],
  ];
  if (props.language_code) params.push(["language_code", props.language_code]);
  if (props.title) params.push(["title", props.title]);
  if (props.type) params.push(["type", props.type]);
  if (props.no_cache === true) params.push(["no_cache", "true"]);
  if (props.zero_trace === true) params.push(["zero_trace", "true"]);
  return `${SERPAPI_SEARCH_URL}?${buildQueryString(params)}`;
}

function buildYouTubeSearchUrl(
  apiKeyValue: string,
  props: YouTubeSearchProps,
  configured: ReturnType<typeof defaults>,
): string {
  const params: Array<[string, string]> = [
    ["engine", "youtube"],
    ["api_key", apiKeyValue],
    ["search_query", props.search_query],
  ];
  const gl = props.gl ?? configured.gl;
  const hl = props.hl ?? configured.hl;
  if (gl) params.push(["gl", gl]);
  if (hl) params.push(["hl", hl]);
  if (props.sp) params.push(["sp", props.sp]);
  if (props.no_cache === true) params.push(["no_cache", "true"]);
  if (props.zero_trace === true) params.push(["zero_trace", "true"]);
  return `${SERPAPI_SEARCH_URL}?${buildQueryString(params)}`;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function formatList(values: unknown): string {
  const strings = arrayValue(values)
    .map((value) => stringValue(value).trim())
    .filter(Boolean);
  return strings.length ? strings.join(", ") : "";
}

function escapeCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .slice(0, 600);
}

async function responseJson(response: {
  text: () => Promise<string>;
}): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error("SerpApi returned an empty response body.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `SerpApi returned a non-JSON response: ${text.slice(0, 200)}`,
    );
  }
}

function summarizeJobs(json: unknown, requested: SearchJobsProps): string {
  const root = record(json);
  const searchMetadata = record(root.search_metadata);
  const jobs = arrayValue(root.jobs_results).map(record);
  const pagination = record(root.serpapi_pagination);
  const lines = [
    `# Google Jobs results for ${requested.q}`,
    "",
    `Status: ${stringValue(searchMetadata.status) || "unknown"}`,
  ];
  if (jobs.length === 0) {
    lines.push("", "No jobs returned.");
  } else {
    lines.push(
      "",
      "| # | Title | Company | Location | Posted | Schedule | Via | Job ID |",
      "|---|---|---|---|---|---|---|---|",
    );
    jobs.slice(0, RESULT_DISPLAY_LIMIT).forEach((job, index) => {
      const detectedExtensions = record(job.detected_extensions);
      const posted = stringValue(detectedExtensions.posted_at);
      const schedule =
        stringValue(detectedExtensions.schedule_type) ||
        formatList(job.extensions);
      lines.push(
        `| ${index + 1} | ${escapeCell(job.title)} | ${escapeCell(job.company_name)} | ${escapeCell(job.location)} | ${escapeCell(posted)} | ${escapeCell(schedule)} | ${escapeCell(job.via)} | ${escapeCell(job.job_id)} |`,
      );
    });
  }

  const nextPageToken = stringValue(pagination.next_page_token);
  if (nextPageToken) {
    lines.push("", `Next page token: \`${escapeCell(nextPageToken)}\``);
  }

  const relatedLinks = jobs
    .slice(0, Math.min(jobs.length, RESULT_DISPLAY_LIMIT))
    .map((job, index) => {
      const applyOptions = arrayValue(job.apply_options).map(record);
      const links = applyOptions
        .map((option) => {
          const title = stringValue(option.title) || "Apply";
          const link = stringValue(option.link);
          return link ? `[${title}](${link})` : "";
        })
        .filter(Boolean)
        .slice(0, 3);
      return links.length ? `${index + 1}. ${links.join("; ")}` : "";
    })
    .filter(Boolean);
  if (relatedLinks.length) lines.push("", "## Apply links", ...relatedLinks);

  return lines.join("\n");
}

function summarizeGoogleSearch(
  json: unknown,
  requested: GoogleSearchProps,
): string {
  const root = record(json);
  const searchMetadata = record(root.search_metadata);
  const organicResults = arrayValue(root.organic_results).map(record);
  const answerBox = record(root.answer_box);
  const lines = [
    `# Google Search results for ${requested.q}`,
    "",
    `Status: ${stringValue(searchMetadata.status) || "unknown"}`,
  ];
  const answer =
    stringValue(answerBox.answer) ||
    stringValue(answerBox.snippet) ||
    stringValue(answerBox.result);
  if (answer) lines.push("", `Answer: ${escapeCell(answer)}`);
  if (organicResults.length === 0) {
    lines.push("", "No organic results returned.");
  } else {
    lines.push("", "| # | Title | Link | Snippet |", "|---|---|---|---|");
    organicResults.slice(0, RESULT_DISPLAY_LIMIT).forEach((result, index) => {
      lines.push(
        `| ${index + 1} | ${escapeCell(result.title)} | ${escapeCell(result.link)} | ${escapeCell(result.snippet)} |`,
      );
    });
  }
  return lines.join("\n");
}

function channelName(value: unknown): string {
  const channel = record(value);
  return stringValue(channel.name);
}

function summarizeYouTubeSearch(
  json: unknown,
  requested: YouTubeSearchProps,
): string {
  const root = record(json);
  const searchMetadata = record(root.search_metadata);
  const searchInformation = record(root.search_information);
  const pagination = record(root.serpapi_pagination);
  const videos = arrayValue(root.video_results).map(record);
  const shorts = arrayValue(root.shorts_results).map(record);
  const channels = arrayValue(root.channel_results).map(record);
  const playlists = arrayValue(root.playlist_results).map(record);
  const movies = arrayValue(root.movie_results).map(record);
  const lines = [
    `# YouTube Search results for ${requested.search_query}`,
    "",
    `Status: ${stringValue(searchMetadata.status) || "unknown"}`,
  ];
  const totalResults = searchInformation.total_results;
  if (typeof totalResults === "number")
    lines.push(`Total results: ${totalResults}`);

  if (videos.length) {
    lines.push(
      "",
      "## Videos",
      "",
      "| # | Title | Video ID | Channel | Published | Length | Views | Link |",
      "|---|---|---|---|---|---|---|---|",
    );
    videos.slice(0, RESULT_DISPLAY_LIMIT).forEach((video, index) => {
      lines.push(
        `| ${index + 1} | ${escapeCell(video.title)} | ${escapeCell(video.video_id)} | ${escapeCell(channelName(video.channel))} | ${escapeCell(video.published_date)} | ${escapeCell(video.length)} | ${escapeCell(video.views)} | ${escapeCell(video.link)} |`,
      );
    });
  }
  if (shorts.length) {
    lines.push(
      "",
      "## Shorts",
      "",
      "| # | Title | Video ID | Views | Link |",
      "|---|---|---|---|---|",
    );
    shorts.slice(0, RESULT_DISPLAY_LIMIT).forEach((short, index) => {
      lines.push(
        `| ${index + 1} | ${escapeCell(short.title)} | ${escapeCell(short.video_id)} | ${escapeCell(short.views)} | ${escapeCell(short.link)} |`,
      );
    });
  }
  if (channels.length) {
    lines.push(
      "",
      "## Channels",
      "",
      "| # | Name | Handle | Subscribers | Link |",
      "|---|---|---|---|---|",
    );
    channels.slice(0, 5).forEach((channel, index) => {
      lines.push(
        `| ${index + 1} | ${escapeCell(channel.title)} | ${escapeCell(channel.handle)} | ${escapeCell(channel.subscribers)} | ${escapeCell(channel.link)} |`,
      );
    });
  }
  if (playlists.length || movies.length) {
    lines.push(
      "",
      "## Other results",
      "",
      "| Type | Title | Link |",
      "|---|---|---|",
    );
    playlists.slice(0, 5).forEach((playlist) => {
      lines.push(
        `| Playlist | ${escapeCell(playlist.title)} | ${escapeCell(playlist.link)} |`,
      );
    });
    movies.slice(0, 5).forEach((movie) => {
      lines.push(
        `| Movie | ${escapeCell(movie.title)} | ${escapeCell(movie.link)} |`,
      );
    });
  }
  const nextPageToken = stringValue(pagination.next_page_token);
  if (nextPageToken)
    lines.push("", `Next page token / sp: \`${escapeCell(nextPageToken)}\``);
  if (
    !videos.length &&
    !shorts.length &&
    !channels.length &&
    !playlists.length &&
    !movies.length
  ) {
    lines.push("", "No YouTube results returned.");
  }
  return lines.join("\n");
}

function summarizeYouTubeTranscript(
  json: unknown,
  requested: YouTubeTranscriptProps,
): string {
  const root = record(json);
  const searchMetadata = record(root.search_metadata);
  const transcript = arrayValue(root.transcript).map(record);
  const chapters = arrayValue(root.chapters).map(record);
  const available = arrayValue(root.available_transcripts).map(record);
  const lines = [
    `# YouTube transcript for ${requested.v}`,
    "",
    `Status: ${stringValue(searchMetadata.status) || "unknown"}`,
  ];
  if (chapters.length) {
    lines.push(
      "",
      "## Chapters",
      "",
      "| Chapter | Start | End |",
      "|---|---|---|",
    );
    chapters.slice(0, 50).forEach((chapter) => {
      lines.push(
        `| ${escapeCell(chapter.chapter)} | ${escapeCell(chapter.start_ms)} | ${escapeCell(chapter.end_ms)} |`,
      );
    });
  }
  if (available.length) {
    lines.push(
      "",
      "## Available transcripts",
      "",
      "| Language | Code | Type | Title | Selected |",
      "|---|---|---|---|---|",
    );
    available.slice(0, 25).forEach((item) => {
      lines.push(
        `| ${escapeCell(item.language_name)} | ${escapeCell(item.language_code)} | ${escapeCell(item.type)} | ${escapeCell(item.title)} | ${escapeCell(item.selected)} |`,
      );
    });
  }
  lines.push("", "## Transcript", "");
  if (transcript.length === 0) {
    lines.push("No transcript snippets returned.");
    return lines.join("\n");
  }
  let usedChars = 0;
  for (const item of transcript) {
    const line = `- [${escapeCell(item.start_time_text)}] ${escapeCell(item.snippet)}`;
    if (usedChars + line.length > MAX_TRANSCRIPT_CHARS) {
      lines.push(
        "",
        `_Transcript truncated at ${MAX_TRANSCRIPT_CHARS} characters._`,
      );
      break;
    }
    lines.push(line);
    usedChars += line.length;
  }
  return lines.join("\n");
}

export default definePlugin((metidos) => {
  metidos.addAgentTool({
    tool: "search_jobs",
    name: "Search jobs",
    description:
      "Search Google Jobs through SerpApi using URL search parameters. Required: q (search query; query is also accepted as an alias). Optional geographic parameters: location (origin city/region; mutually exclusive with uule) or uule (Google encoded location). Optional localization parameters: google_domain (for example google.com), gl (two-letter country code such as us, uk, fr), hl (two-letter language code such as en, es, fr). Optional pagination: next_page_token from serpapi_pagination.next_page_token; Google discontinued start/offset and returns up to 10 results per page. Optional advanced Google Jobs parameters: chips (deprecated Google chip filters), lrad (radius in kilometers; not strict), ltype (true filters work-from-home; deprecated by Google), uds (Google-provided filter string from filters). Plugin settings provide defaults for google_domain, gl, and hl; tool-call values override settings.",
    timeoutMs: 30_000,
    validateProps: validateSearchJobsProps,
    async action(_context, props) {
      const url = buildSearchUrl(apiKey(metidos), props, defaults(metidos));
      const response = await metidos.fetch(url, {
        headers: { Accept: "application/json" },
        method: "GET",
      });
      if (!response.ok) {
        throw new Error(`SerpApi jobs request failed (${response.status}).`);
      }
      const json = await responseJson(response);
      await metidos.log("info", `SerpApi job search completed for ${props.q}`);
      return { markdown: summarizeJobs(json, props), type: "markdown" };
    },
  });

  metidos.addAgentTool({
    tool: "search_google",
    name: "Search Google",
    description:
      "Search Google via SerpApi Google Light using URL search parameters. Required: q (search query; query is also accepted as an alias). Optional geographic parameters: location (origin city/region; mutually exclusive with uule) or uule (Google encoded location). Optional localization parameters: google_domain (for example google.com), gl (two-letter country code such as us, uk, fr), hl (two-letter language code such as en, es, fr), lr (language restrict such as lang_en). Optional pagination: start (result offset). Optional search controls: device (desktop, mobile, tablet), safe (active or off), filter (duplicate filter), nfpr (exclude auto-corrected results), no_cache, zero_trace. Plugin settings provide defaults for google_domain, gl, and hl; tool-call values override settings.",
    timeoutMs: 30_000,
    validateProps: validateGoogleSearchProps,
    async action(_context, props) {
      const url = buildGoogleSearchUrl(
        apiKey(metidos),
        props,
        defaults(metidos),
      );
      const response = await metidos.fetch(url, {
        headers: { Accept: "application/json" },
        method: "GET",
      });
      if (!response.ok) {
        throw new Error(
          `SerpApi Google search request failed (${response.status}).`,
        );
      }
      const json = await responseJson(response);
      await metidos.log(
        "info",
        `SerpApi Google search completed for ${props.q}`,
      );
      return { markdown: summarizeGoogleSearch(json, props), type: "markdown" };
    },
  });

  metidos.addAgentTool({
    tool: "fetch_youtube_transcript",
    name: "Fetch YouTube transcript",
    description:
      "Fetch a YouTube video transcript through SerpApi YouTube Video Transcript using URL search parameters. Required: v (YouTube video ID; video_id or url aliases accepted). Optional localization: language_code (for example en, es-ES, zh-Hans; defaults to English and may fall back to first available language). Optional advanced parameters: title (specific transcript title such as Twitch Chat - Simple), type (transcript type such as asr for auto-generated), no_cache (true forces a fresh fetch; do not combine with async), zero_trace (enterprise mode). async and output are intentionally not exposed by this tool.",
    timeoutMs: 30_000,
    validateProps: validateYouTubeTranscriptProps,
    async action(_context, props) {
      const url = buildYouTubeTranscriptUrl(apiKey(metidos), props);
      const response = await metidos.fetch(url, {
        headers: { Accept: "application/json" },
        method: "GET",
      });
      if (!response.ok) {
        throw new Error(
          `SerpApi YouTube transcript request failed (${response.status}).`,
        );
      }
      const json = await responseJson(response);
      await metidos.log(
        "info",
        `SerpApi YouTube transcript fetched for ${props.v}`,
      );
      return {
        markdown: summarizeYouTubeTranscript(json, props),
        type: "markdown",
      };
    },
  });

  metidos.addAgentTool({
    tool: "search_youtube",
    name: "Search YouTube",
    description:
      "Search YouTube through SerpApi YouTube Search using URL search parameters. Required: search_query (q or query aliases accepted). Optional localization: gl (two-letter country code), hl (two-letter language code); plugin gl/hl settings are defaults. Optional advanced YouTube parameter: sp (pagination token from serpapi_pagination.next_page_token or pagination.next_page_token; also accepts YouTube filter values such as upload date, 4K, exact spelling, etc.). Optional SerpApi parameters: no_cache (true forces a fresh fetch; do not combine with async), zero_trace (enterprise mode). async and output are intentionally not exposed by this tool. Returned video_id values can be passed to fetch_youtube_transcript as v.",
    timeoutMs: 30_000,
    validateProps: validateYouTubeSearchProps,
    async action(_context, props) {
      const url = buildYouTubeSearchUrl(
        apiKey(metidos),
        props,
        defaults(metidos),
      );
      const response = await metidos.fetch(url, {
        headers: { Accept: "application/json" },
        method: "GET",
      });
      if (!response.ok) {
        throw new Error(
          `SerpApi YouTube search request failed (${response.status}).`,
        );
      }
      const json = await responseJson(response);
      await metidos.log(
        "info",
        `SerpApi YouTube search completed for ${props.search_query}`,
      );
      return {
        markdown: summarizeYouTubeSearch(json, props),
        type: "markdown",
      };
    },
  });
});
