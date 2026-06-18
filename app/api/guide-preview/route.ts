import { NextRequest, NextResponse } from "next/server";
import type { GuidePreviewResult } from "@/lib/guide-previews";

const ALLOWED_HOSTNAME = "partners.kzero.com";
const ALLOWED_PATH_PREFIX = "/library/";

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

function getMatches(html: string, pattern: RegExp, limit = 6) {
  const matches: string[] = [];

  for (const match of html.matchAll(pattern)) {
    const value = stripHtml(match[1] ?? "");
    if (value && !matches.includes(value)) {
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

  const title =
    getAttribute(sanitizedHtml, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
    getAttribute(sanitizedHtml, /<title>([\s\S]*?)<\/title>/i) ??
    getAttribute(sanitizedHtml, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ??
    "Guide preview";

  const intro =
    getAttribute(sanitizedHtml, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
    getAttribute(sanitizedHtml, /<p[^>]*>([\s\S]*?)<\/p>/i);

  const headings = dedupe([
    ...getMatches(sanitizedHtml, /<h2[^>]*>([\s\S]*?)<\/h2>/gi, 4),
    ...getMatches(sanitizedHtml, /<h3[^>]*>([\s\S]*?)<\/h3>/gi, 4)
  ]).slice(0, 6);

  const steps = dedupe(getMatches(sanitizedHtml, /<li[^>]*>([\s\S]*?)<\/li>/gi, 6)).slice(0, 6);
  const images = extractImages(sanitizedHtml, url);
  const normalizedText = stripHtml(sanitizedHtml);

  if (/loading library/i.test(normalizedText) && headings.length === 0 && steps.length === 0) {
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
