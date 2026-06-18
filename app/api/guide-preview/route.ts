import { NextRequest, NextResponse } from "next/server";
import type { GuidePreviewResult } from "@/lib/guide-previews";

const ALLOWED_HOSTNAME = "partners.kzero.com";
const ALLOWED_PATH_PREFIX = "/library/";
const NAVIGATION_LABELS = [
  "home",
  "knowledge base",
  "opportunities",
  "sales enablement",
  "sign in",
  "back to folder",
  "previous",
  "next",
  "kzero partner portal",
  "open kzero passwordless dashboard"
];

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function dedupe(values: string[]) {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function normalizeText(value: string) {
  return stripHtml(value).replace(/\s+/g, " ").trim();
}

function normalizeForComparison(value: string) {
  return normalizeText(value).toLowerCase();
}

function isNavigationText(value: string) {
  const normalized = normalizeForComparison(value);

  if (!normalized) {
    return true;
  }

  return NAVIGATION_LABELS.some((label) => normalized === label || normalized.startsWith(`${label} `));
}

function getMatches(html: string, pattern: RegExp, limit = 6) {
  const matches: string[] = [];

  for (const match of html.matchAll(pattern)) {
    const value = stripHtml(match[1] ?? "");
    if (value && !isNavigationText(value) && !matches.includes(value)) {
      matches.push(value);
    }

    if (matches.length >= limit) {
      break;
    }
  }

  return matches;
}

function getAttribute(html: string, pattern: RegExp) {
  const match = html.match(pattern);
  return match?.[1] ? decodeHtmlEntities(match[1].trim()) : null;
}

function toAbsoluteUrl(sourceUrl: string, maybeRelativeUrl: string) {
  try {
    return new URL(maybeRelativeUrl, sourceUrl).toString();
  } catch {
    return null;
  }
}

function extractImages(html: string, sourceUrl: string) {
  const imageCandidates = [
    getAttribute(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i),
    ...Array.from(html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)).map((match) => match[1] ?? "")
  ]
    .filter(Boolean)
    .map((value) => toAbsoluteUrl(sourceUrl, value as string))
    .filter((value): value is string => Boolean(value));

  return dedupe(imageCandidates).slice(0, 3);
}

function extractNodes(html: string, tagName: string) {
  const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  const nodes: { index: number; value: string }[] = [];

  for (const match of html.matchAll(pattern)) {
    const rawValue = match[1] ?? "";
    const value = normalizeText(rawValue);
    const index = match.index ?? -1;

    if (value && index >= 0) {
      nodes.push({ index, value });
    }
  }

  return nodes;
}

function findArticleStart(html: string) {
  const headings = extractNodes(html, "h1");
  return headings.find((heading) => !isNavigationText(heading.value)) ?? null;
}

function findArticleEndIndex(html: string, startIndex: number) {
  const boundaryPatterns = [
    /<a[^>]*>\s*Back to Folder\s*<\/a>/gi,
    /<a[^>]*>\s*Previous\s*<\/a>/gi,
    /<a[^>]*>\s*Next\s*<\/a>/gi,
    /<footer[\s\S]*$/i
  ];

  const boundaryIndexes = boundaryPatterns
    .map((pattern) => {
      pattern.lastIndex = startIndex;
      const match = pattern.exec(html);
      return match?.index ?? -1;
    })
    .filter((index) => index > startIndex);

  if (boundaryIndexes.length === 0) {
    return html.length;
  }

  return Math.min(...boundaryIndexes);
}

function getMeaningfulParagraphs(html: string, limit = 4) {
  const paragraphs = extractNodes(html, "p")
    .map((paragraph) => paragraph.value)
    .filter((paragraph) => !isNavigationText(paragraph))
    .filter((paragraph) => paragraph.length > 20);

  return dedupe(paragraphs).slice(0, limit);
}

function getMeaningfulHeadings(html: string, limit = 6) {
  const headings = [
    ...extractNodes(html, "h2").map((heading) => heading.value),
    ...extractNodes(html, "h3").map((heading) => heading.value),
    ...extractNodes(html, "h4").map((heading) => heading.value)
  ]
    .filter((heading) => !isNavigationText(heading))
    .filter((heading) => heading.length > 2);

  return dedupe(headings).slice(0, limit);
}

function getMeaningfulSteps(html: string, limit = 6) {
  const listItems = extractNodes(html, "li")
    .map((item) => item.value)
    .filter((item) => !isNavigationText(item))
    .filter((item) => item.length > 12);

  const actionParagraphs = getMeaningfulParagraphs(html, 12).filter((paragraph) =>
    /step\s*\d+|select |click |fill in|send invite|add admin|add user|import/i.test(paragraph)
  );

  return dedupe([...listItems, ...actionParagraphs]).slice(0, limit);
}

function buildUnavailablePreview(url: string, title?: string, message?: string): GuidePreviewResult {
  return {
    headings: [],
    images: [],
    intro: null,
    kind: "unavailable",
    message: message ?? "Preview unavailable",
    steps: [],
    title: title ?? "Preview unavailable",
    url
  };
}

function buildCollectionPreview(url: string, title?: string): GuidePreviewResult {
  return {
    headings: [],
    images: [],
    intro: null,
    kind: "collection",
    message: "This link opens a guide collection. Open the full guide to choose the article.",
    steps: [],
    title: title ?? "Guide collection",
    url
  };
}

function extractPreview(url: string, html: string): GuidePreviewResult {
  const sanitizedHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  const articleStart = findArticleStart(sanitizedHtml);
  const articleHtml = articleStart
    ? sanitizedHtml.slice(articleStart.index, findArticleEndIndex(sanitizedHtml, articleStart.index))
    : sanitizedHtml;

  const title =
    articleStart?.value ??
    getAttribute(sanitizedHtml, /<title>([\s\S]*?)<\/title>/i) ??
    getAttribute(sanitizedHtml, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
    "Guide preview";

  const paragraphs = getMeaningfulParagraphs(articleHtml, 6);
  const intro =
    paragraphs.find((paragraph) => paragraph !== title) ??
    getAttribute(sanitizedHtml, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);

  const headings = getMeaningfulHeadings(articleHtml, 6);
  const steps = getMeaningfulSteps(articleHtml, 6);
  const images = extractImages(articleHtml, url);
  const normalizedText = normalizeForComparison(articleHtml);

  if (/loading library/i.test(normalizedText) && headings.length === 0 && steps.length === 0) {
    return buildCollectionPreview(url, title);
  }

  if (!articleStart && /loading library/i.test(normalizeForComparison(sanitizedHtml))) {
    return buildCollectionPreview(url, title);
  }

  if (!intro && headings.length === 0 && steps.length === 0) {
    return buildUnavailablePreview(url, title);
  }

  return {
    headings,
    images,
    intro,
    kind: "article",
    steps,
    title,
    url
  };
}

export async function GET(request: NextRequest) {
  const requestedUrl = request.nextUrl.searchParams.get("url")?.trim();

  if (!requestedUrl) {
    return NextResponse.json({ error: "Guide URL is required." }, { status: 400 });
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(requestedUrl);
  } catch {
    return NextResponse.json({ error: "Guide URL is invalid." }, { status: 400 });
  }

  const isAllowed =
    parsedUrl.protocol === "https:" &&
    parsedUrl.hostname === ALLOWED_HOSTNAME &&
    parsedUrl.pathname.startsWith(ALLOWED_PATH_PREFIX);

  if (!isAllowed) {
    return NextResponse.json({ error: "Guide URL is not allowed." }, { status: 400 });
  }

  try {
    const response = await fetch(parsedUrl.toString(), {
      cache: "no-store",
      headers: {
        "user-agent": "KZeroOnboardingPortal/1.0"
      }
    });

    if (!response.ok) {
      return NextResponse.json({
        preview: buildUnavailablePreview(parsedUrl.toString(), undefined, "Preview unavailable")
      });
    }

    const html = await response.text();

    return NextResponse.json({
      preview: extractPreview(parsedUrl.toString(), html)
    });
  } catch {
    return NextResponse.json({
      preview: buildUnavailablePreview(parsedUrl.toString(), undefined, "Preview unavailable")
    });
  }
}
