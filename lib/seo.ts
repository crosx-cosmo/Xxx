import type { User, VideoDetail, VideoWithMeta } from './types';

export const SITE_NAME = 'Hey Lady';
export const SITE_TITLE =
  'Hey Lady — Luxury 18+ Adult Entertainment & Hot Sex Videos';
export const SITE_DESCRIPTION =
  'Stream exclusive 18+ adult entertainment, curated Hot Sex Videos, verified VIP creators, and private HD video collections on Hey Lady.';

export const SITE_KEYWORDS: string[] = [
  'Hot Sex Videos',
  'Hey Lady',
  'Hey Lady 18+',
  'luxury adult videos',
  '18+ adult streaming',
  'HD adult entertainment',
  'verified adult creators',
  'VIP adult videos',
  'curated 18+ cinema',
  'private adult library',
  'adult video platform',
  'exclusive creator videos',
];

export const DEFAULT_OG_IMAGE = '/images/thumb_conflict_repair_1795107900131.jpg';

/**
 * Resolves the canonical base origin for metadata, sitemaps, and structured data.
 */
export function getSiteUrl(
  envAppUrl: string | undefined = process.env.APP_URL
): string {
  const raw = envAppUrl?.trim();
  if (raw && /^https?:\/\/[^/\s]+/i.test(raw)) {
    return raw.replace(/\/+$/, '');
  }
  return 'https://heylady.vip';
}

/**
 * Safely serializes structured data into a JSON-LD string for `<script type="application/ld+json">`,
 * escaping HTML-significant characters (`<`, `>`, `&`) and Unicode line separators (`\u2028`, `\u2029`)
 * so user-supplied titles or descriptions can never break out of `<script>` tags.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Builds an absolute canonical URL for any relative route path.
 */
export function buildCanonicalUrl(path = '/', siteUrl: string = getSiteUrl()): string {
  const normalizedBase = siteUrl.replace(/\/+$/, '');
  if (!path || path === '/') return `${normalizedBase}/`;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

/**
 * Resolves a relative image asset path into an absolute URL for OpenGraph and Schema.org.
 */
export function buildAbsoluteAssetUrl(
  assetPath: string | null | undefined,
  siteUrl: string = getSiteUrl()
): string {
  const trimmed = assetPath?.trim();
  if (!trimmed) return buildCanonicalUrl(DEFAULT_OG_IMAGE, siteUrl);
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('data:')) return buildCanonicalUrl(DEFAULT_OG_IMAGE, siteUrl);
  return buildCanonicalUrl(trimmed, siteUrl);
}

/**
 * Converts a duration in seconds into an ISO 8601 duration string (e.g. PT15M48S).
 */
export function formatIso8601Duration(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  let result = 'PT';
  if (hours > 0) result += `${hours}H`;
  if (minutes > 0) result += `${minutes}M`;
  if (seconds > 0 || result === 'PT') result += `${seconds}S`;
  return result;
}

/**
 * Builds Schema.org BreadcrumbList JSON-LD for hierarchical page discovery.
 */
export function buildBreadcrumbJsonLd(
  items: Array<{ name: string; path: string }>,
  siteUrl: string = getSiteUrl()
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: item.name,
      item: buildCanonicalUrl(item.path, siteUrl),
    })),
  };
}

/**
 * Builds Schema.org CollectionPage + ItemList JSON-LD for catalog feeds.
 */
export function buildItemListJsonLd(
  params: {
    name: string;
    description: string;
    path?: string;
    videos: VideoWithMeta[];
  },
  siteUrl: string = getSiteUrl()
) {
  const pageUrl = buildCanonicalUrl(params.path ?? '/', siteUrl);
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: params.name,
    description: params.description,
    url: pageUrl,
    isFamilyFriendly: false,
    contentRating: '18+',
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: Math.min(params.videos.length, 24),
      itemListElement: params.videos.slice(0, 24).map((video, idx) => ({
        '@type': 'ListItem',
        position: idx + 1,
        url: buildCanonicalUrl(`/watch/${video.id}`, siteUrl),
        name: video.title,
      })),
    },
  };
}

/**
 * Builds root Schema.org WebSite + Organization JSON-LD with sitelinks SearchAction
 * and compliant 18+ adult content classification for accurate search indexing.
 */
export function buildWebsiteJsonLd(siteUrl: string = getSiteUrl()) {
  const rootUrl = buildCanonicalUrl('/', siteUrl);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${rootUrl}#organization`,
        name: SITE_NAME,
        alternateName: 'Hey Lady 18+',
        url: rootUrl,
        logo: buildAbsoluteAssetUrl(DEFAULT_OG_IMAGE, siteUrl),
      },
      {
        '@type': 'WebSite',
        '@id': `${rootUrl}#website`,
        url: rootUrl,
        name: SITE_NAME,
        alternateName: 'Hey Lady Luxury 18+ Video Platform',
        description: SITE_DESCRIPTION,
        inLanguage: 'en-US',
        isFamilyFriendly: false,
        contentRating: '18+',
        audience: {
          '@type': 'PeopleAudience',
          requiredMinAge: 18,
        },
        publisher: { '@id': `${rootUrl}#organization` },
        keywords: SITE_KEYWORDS.join(', '),
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${rootUrl}?q={search_term_string}`,
          },
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@type': 'WebApplication',
        '@id': `${rootUrl}#webapp`,
        name: SITE_NAME,
        url: rootUrl,
        description: SITE_DESCRIPTION,
        applicationCategory: 'MultimediaApplication',
        operatingSystem: 'All',
        isFamilyFriendly: false,
        contentRating: '18+',
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
      },
    ],
  };
}

/**
 * Builds Schema.org VideoObject JSON-LD for individual video watch pages,
 * including `hasPart` Clip chapter markers for Google Video Key Moments rich results.
 */
export function buildVideoObjectJsonLd(
  video: VideoDetail | VideoWithMeta,
  siteUrl: string = getSiteUrl()
) {
  const watchUrl = buildCanonicalUrl(`/watch/${video.id}`, siteUrl);
  const creatorUrl = buildCanonicalUrl(`/creator/${video.creator.username}`, siteUrl);
  const chapters =
    'chapters' in video && Array.isArray(video.chapters)
      ? [...video.chapters].sort((a, b) => a.timestampSeconds - b.timestampSeconds)
      : [];

  const clips = chapters.map((ch, idx) => {
    const nextChapter = chapters[idx + 1];
    const startOffset = Math.max(0, Math.floor(ch.timestampSeconds));
    const endOffset = nextChapter
      ? Math.max(startOffset + 1, Math.floor(nextChapter.timestampSeconds))
      : Math.max(startOffset + 1, Math.floor(video.durationSeconds));
    return {
      '@type': 'Clip',
      name: ch.title,
      startOffset,
      endOffset,
      url: `${watchUrl}#t=${startOffset}`,
    };
  });

  const ratingSummary =
    'ratingSummary' in video && video.ratingSummary
      ? video.ratingSummary
      : undefined;

  const hasValidAggregateRating =
    Boolean(ratingSummary) &&
    Number(ratingSummary?.totalRatings) > 0 &&
    Number(ratingSummary?.averageRating) >= 1 &&
    Number(ratingSummary?.averageRating) <= 5;

  const reviews =
    hasValidAggregateRating && Array.isArray(ratingSummary?.recentReviews)
      ? ratingSummary.recentReviews
          .filter((item) => item.feedback && item.feedback.trim().length > 0)
          .slice(0, 3)
          .map((item) => ({
            '@type': 'Review',
            author: {
              '@type': 'Person',
              name: item.authorName || 'Verified Member',
            },
            datePublished: item.updatedAt,
            reviewBody: item.feedback,
            reviewRating: {
              '@type': 'Rating',
              ratingValue: item.rating,
              bestRating: 5,
              worstRating: 1,
            },
          }))
      : [];

  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: video.title,
    description: video.description,
    thumbnailUrl: [buildAbsoluteAssetUrl(video.thumbnailUrl, siteUrl)],
    uploadDate: video.createdAt,
    duration: formatIso8601Duration(video.durationSeconds),
    url: watchUrl,
    contentUrl: video.videoUrl,
    embedUrl: watchUrl,
    genre: video.category.name,
    isFamilyFriendly: false,
    contentRating: '18+',
    keywords: [video.category.name, video.creator.name, ...SITE_KEYWORDS.slice(0, 6)].join(', '),
    author: {
      '@type': 'Person',
      name: video.creator.name,
      url: creatorUrl,
    },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      logo: {
        '@type': 'ImageObject',
        url: buildAbsoluteAssetUrl(DEFAULT_OG_IMAGE, siteUrl),
      },
    },
    ...(clips.length > 0 ? { hasPart: clips } : {}),
    ...(hasValidAggregateRating && ratingSummary
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: Number(ratingSummary.averageRating.toFixed(1)),
            ratingCount: ratingSummary.totalRatings,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
    ...(reviews.length > 0 ? { review: reviews } : {}),
    interactionStatistic: [
      {
        '@type': 'InteractionCounter',
        interactionType: { '@type': 'WatchAction' },
        userInteractionCount: video.views,
      },
      {
        '@type': 'InteractionCounter',
        interactionType: { '@type': 'LikeAction' },
        userInteractionCount: video.likes,
      },
    ],
  };
}

/**
 * Builds Schema.org ProfilePage + Person JSON-LD for verified creator profile pages.
 */
export function buildCreatorJsonLd(
  creator: User,
  videos: VideoWithMeta[],
  siteUrl: string = getSiteUrl()
) {
  const profileUrl = buildCanonicalUrl(`/creator/${creator.username}`, siteUrl);
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url: profileUrl,
    name: `${creator.name} — ${SITE_NAME}`,
    isFamilyFriendly: false,
    mainEntity: {
      '@type': 'Person',
      name: creator.name,
      alternateName: `@${creator.username}`,
      description: creator.bio || creator.credentials,
      jobTitle: creator.credentials || 'Verified 18+ Creator',
      url: profileUrl,
      image: buildAbsoluteAssetUrl(creator.avatarUrl, siteUrl),
      interactionStatistic: {
        '@type': 'InteractionCounter',
        interactionType: { '@type': 'FollowAction' },
        userInteractionCount: creator.followersCount,
      },
    },
    hasPart: videos.slice(0, 12).map((video) => ({
      '@type': 'VideoObject',
      name: video.title,
      url: buildCanonicalUrl(`/watch/${video.id}`, siteUrl),
      thumbnailUrl: buildAbsoluteAssetUrl(video.thumbnailUrl, siteUrl),
      uploadDate: video.createdAt,
      duration: formatIso8601Duration(video.durationSeconds),
      isFamilyFriendly: false,
    })),
  };
}
