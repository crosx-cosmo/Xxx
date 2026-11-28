import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAbsoluteAssetUrl,
  buildBreadcrumbJsonLd,
  buildCanonicalUrl,
  buildCreatorJsonLd,
  buildItemListJsonLd,
  buildVideoObjectJsonLd,
  buildWebsiteJsonLd,
  formatIso8601Duration,
  getSiteUrl,
  serializeJsonLd,
  SITE_KEYWORDS,
  SITE_NAME,
} from './seo';
import type { Category, User, VideoDetail, VideoWithMeta } from './types';

test('getSiteUrl and buildCanonicalUrl normalize origins and paths safely', () => {
  assert.equal(getSiteUrl('https://example.com///'), 'https://example.com');
  assert.equal(getSiteUrl(''), 'https://heylady.vip');
  assert.equal(getSiteUrl('not-a-url'), 'https://heylady.vip');

  assert.equal(buildCanonicalUrl('/', 'https://example.com/'), 'https://example.com/');
  assert.equal(
    buildCanonicalUrl('/watch/vid-1', 'https://example.com'),
    'https://example.com/watch/vid-1'
  );
  assert.equal(
    buildCanonicalUrl('educators', 'https://example.com'),
    'https://example.com/educators'
  );
});

test('buildAbsoluteAssetUrl resolves relative, absolute, and data URLs safely', () => {
  assert.equal(
    buildAbsoluteAssetUrl('/images/sample.jpg', 'https://example.com'),
    'https://example.com/images/sample.jpg'
  );
  assert.equal(
    buildAbsoluteAssetUrl('https://cdn.example.com/thumb.webp', 'https://example.com'),
    'https://cdn.example.com/thumb.webp'
  );
  assert.ok(
    buildAbsoluteAssetUrl('data:image/png;base64,abc', 'https://example.com').startsWith(
      'https://example.com/'
    )
  );
});

test('formatIso8601Duration formats seconds cleanly for Schema.org VideoObject', () => {
  assert.equal(formatIso8601Duration(0), 'PT0S');
  assert.equal(formatIso8601Duration(45), 'PT45S');
  assert.equal(formatIso8601Duration(948), 'PT15M48S');
  assert.equal(formatIso8601Duration(3600), 'PT1H');
  assert.equal(formatIso8601Duration(3665), 'PT1H1M5S');
});

test('SEO JSON-LD builders emit valid structured data with Hey Lady 18+ metadata and configured keywords', () => {
  assert.equal(SITE_NAME, 'Hey Lady');
  assert.ok(SITE_KEYWORDS.includes('Hot Sex Videos'));
  assert.ok(SITE_KEYWORDS.includes('Hey Lady'));

  const website = buildWebsiteJsonLd('https://heylady.test');
  assert.equal(website['@context'], 'https://schema.org');
  assert.equal(website['@graph'].length, 3);
  const webSiteNode = website['@graph'][1];
  const webAppNode = website['@graph'][2];
  assert.equal(webSiteNode['@type'], 'WebSite');
  assert.equal(webSiteNode.name, 'Hey Lady');
  assert.equal(webSiteNode.isFamilyFriendly, false);
  assert.equal(webSiteNode.contentRating, '18+');
  assert.ok((webSiteNode.keywords ?? '').includes('Hot Sex Videos'));
  assert.equal(webAppNode['@type'], 'WebApplication');
  assert.equal(webAppNode.applicationCategory, 'MultimediaApplication');

  const creator: User = {
    id: 'usr-test-1',
    name: 'Elena Noir',
    username: 'elena-noir',
    email: 'elena@heylady.test',
    avatarUrl: null,
    bio: 'Verified 18+ VIP creator',
    credentials: 'VIP Creator',
    isEducator: true,
    followersCount: 1200,
    createdAt: '2026-01-10T10:00:00.000Z',
  };

  const category: Category = {
    id: 'cat-test-1',
    name: 'VIP Exclusive',
    slug: 'vip-exclusive',
    description: 'Curated 18+ exclusive collections.',
  };

  const sampleVideo: VideoWithMeta = {
    id: 'vid-test-1',
    userId: creator.id,
    categoryId: category.id,
    title: 'After Hours Velvet Collection',
    description: 'Exclusive 18+ HD video presentation.',
    videoUrl: 'https://example.com/watch/1',
    thumbnailUrl: '/images/sample-thumb.jpg',
    durationSeconds: 948,
    reflectionPrompt: 'Share your favorite moment from this release.',
    views: 4200,
    likes: 310,
    createdAt: '2026-02-01T12:00:00.000Z',
    chapterCount: 2,
    creator,
    category,
    isBookmarked: false,
    hasLiked: false,
    watchProgressSeconds: 0,
  };

  const detailVideo: VideoDetail = {
    ...sampleVideo,
    chapters: [
      { id: 'ch-1', videoId: sampleVideo.id, timestampSeconds: 0, title: 'Opening Scene' },
      { id: 'ch-2', videoId: sampleVideo.id, timestampSeconds: 300, title: 'Main Feature' },
    ],
    comments: [],
    isFollowingCreator: false,
    relatedVideos: [],
    ratingSummary: {
      averageRating: 4.8,
      totalRatings: 16,
      distribution: { 1: 0, 2: 0, 3: 1, 4: 2, 5: 13 },
      viewerRating: 5,
      viewerFeedback: 'Breathtaking 4K quality.',
      isAuthenticated: true,
      recentReviews: [
        {
          userId: 'usr-reviewer-1',
          authorName: 'VIP Critic',
          rating: 5,
          feedback: 'Breathtaking 4K quality.',
          updatedAt: '2026-02-02T12:00:00.000Z',
        },
      ],
    },
  };

  const videoLd = buildVideoObjectJsonLd(detailVideo, 'https://heylady.test');
  assert.equal(videoLd['@type'], 'VideoObject');
  assert.equal(videoLd.url, `https://heylady.test/watch/${sampleVideo.id}`);
  assert.equal(videoLd.isFamilyFriendly, false);
  assert.equal(videoLd.contentRating, '18+');
  assert.ok(videoLd.duration.startsWith('PT'));
  assert.equal(videoLd.hasPart?.length, 2);
  assert.equal(videoLd.hasPart?.[0]['@type'], 'Clip');
  assert.equal(videoLd.hasPart?.[0].startOffset, 0);
  assert.equal(videoLd.hasPart?.[0].endOffset, 300);
  assert.equal(videoLd.aggregateRating?.['@type'], 'AggregateRating');
  assert.equal(videoLd.aggregateRating?.ratingValue, 4.8);
  assert.equal(videoLd.aggregateRating?.ratingCount, 16);
  assert.equal(videoLd.review?.length, 1);
  assert.equal(videoLd.review?.[0].reviewRating.ratingValue, 5);

  const creatorLd = buildCreatorJsonLd(creator, [sampleVideo], 'https://heylady.test');
  assert.equal(creatorLd['@type'], 'ProfilePage');
  assert.equal(creatorLd.mainEntity.name, creator.name);
  assert.equal(creatorLd.hasPart.length, 1);

  const breadcrumbLd = buildBreadcrumbJsonLd(
    [
      { name: 'Home', path: '/' },
      { name: 'VIP Exclusive', path: '/?category=vip-exclusive' },
    ],
    'https://heylady.test'
  );
  assert.equal(breadcrumbLd['@type'], 'BreadcrumbList');
  assert.equal(breadcrumbLd.itemListElement.length, 2);

  const itemListLd = buildItemListJsonLd(
    {
      name: 'Hey Lady Catalog',
      description: 'Curated releases',
      path: '/',
      videos: [sampleVideo],
    },
    'https://heylady.test'
  );
  assert.equal(itemListLd['@type'], 'CollectionPage');
  assert.equal(itemListLd.mainEntity.numberOfItems, 1);

  const unsafePayload = {
    title: '</script><script>alert("xss")</script>&test',
  };
  const serialized = serializeJsonLd(unsafePayload);
  assert.equal(serialized.includes('</script>'), false);
  assert.equal(serialized.includes('<script>'), false);
  assert.ok(serialized.includes('\\u003c/script\\u003e'));
  assert.ok(serialized.includes('\\u0026test'));
});
