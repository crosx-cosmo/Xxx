import crypto from 'node:crypto';
import { cache } from 'react';
import { getNeonSql, isNeonConfigured } from './db';
import { buildIlikeSearchPattern } from './db-utils';
import {
  withNeonSchemaRecovery,
  withOptionalNeonRead,
} from './neon-init';
import {
  CACHE_TTL_MS,
  getServerCache,
  invalidateCatalogCaches,
  invalidateCategoryCaches,
} from './server-cache';
import { ensureViewerRowInDb, getOptionalViewerId } from './viewer-session';
import type {
  AdminCategoryPayload,
  AdminCommentItem,
  AdminDashboardStats,
  AdminVideoLinkPayload,
  Category,
  CategoryWithCount,
  CommentItem,
  User,
  VideoChapter,
  VideoDetail,
  VideoWithMeta,
  WatchHistoryEntry,
} from './types';
import {
  isLegacyMockCategory,
  LEGACY_MOCK_CATEGORY_IDS,
  LEGACY_MOCK_CATEGORY_SLUGS,
  slugifyCategory,
  validateCategoryPayload,
  validateUploadPayload,
} from './video-utils';
import {
  createEmptyReactionCounts,
  isValidVideoReactionType,
  normalizeReactionState,
  type VideoReactionState,
  type VideoReactionType,
} from './video-reactions';
import {
  createEmptyRatingDistribution,
  createEmptyVideoRatingSummary,
  isValidStarRating,
  normalizeVideoRatingSummary,
  sanitizeRatingFeedback,
  type VideoRatingReviewItem,
  type VideoRatingStar,
  type VideoRatingSummary,
} from './video-ratings';

interface RawUserRow {
  id: string;
  name: string;
  username: string;
  email: string;
  avatar_url: string | null;
  bio: string;
  credentials: string;
  is_educator: boolean;
  followers_count: number;
  created_at: string | Date;
}

interface RawVideoRow {
  id: string;
  user_id: string;
  category_id: string;
  title: string;
  description: string;
  video_url: string;
  thumbnail_url: string;
  duration_seconds: number;
  reflection_prompt: string;
  views: number;
  likes: number;
  created_at: string | Date;
  creator_name: string;
  creator_username: string;
  creator_email: string;
  creator_avatar_url: string | null;
  creator_bio: string;
  creator_credentials: string;
  creator_is_educator: boolean;
  creator_followers_count: number;
  creator_created_at: string | Date;
  category_name: string;
  category_slug: string;
  category_description: string;
  chapter_count: number;
  is_bookmarked: boolean;
  has_liked: boolean;
  watch_progress_seconds: number;
}

interface RawChapterRow {
  id: string;
  video_id: string;
  timestamp_seconds: number;
  title: string;
  summary: string;
}

function toIso(val: string | Date): string {
  return val instanceof Date ? val.toISOString() : new Date(val).toISOString();
}

function mapUserRow(row: RawUserRow): User {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    email: '',
    avatarUrl: row.avatar_url,
    bio: row.bio ?? '',
    credentials: row.credentials ?? '',
    isEducator: Boolean(row.is_educator),
    followersCount: Number(row.followers_count ?? 0),
    createdAt: toIso(row.created_at),
  };
}

function mapChapterRow(ch: RawChapterRow): VideoChapter {
  return {
    id: ch.id,
    videoId: ch.video_id,
    timestampSeconds: Number(ch.timestamp_seconds),
    title: ch.title,
    summary: ch.summary || undefined,
  };
}

function mapVideoRow(row: RawVideoRow): VideoWithMeta {
  return {
    id: row.id,
    userId: row.user_id,
    categoryId: row.category_id,
    title: row.title,
    description: row.description,
    videoUrl: row.video_url,
    thumbnailUrl: row.thumbnail_url,
    durationSeconds: Number(row.duration_seconds),
    reflectionPrompt: row.reflection_prompt,
    views: Number(row.views),
    likes: Number(row.likes ?? 0),
    createdAt: toIso(row.created_at),
    chapterCount: Number(row.chapter_count ?? 0),
    isBookmarked: Boolean(row.is_bookmarked),
    hasLiked: Boolean(row.has_liked),
    watchProgressSeconds: Number(row.watch_progress_seconds ?? 0),
    creator: {
      id: row.user_id,
      name: row.creator_name,
      username: row.creator_username,
      email: '',
      avatarUrl: row.creator_avatar_url,
      bio: row.creator_bio ?? '',
      credentials: row.creator_credentials ?? '',
      isEducator: Boolean(row.creator_is_educator),
      followersCount: Number(row.creator_followers_count ?? 0),
      createdAt: toIso(row.creator_created_at),
    },
    category: {
      id: row.category_id,
      name: row.category_name,
      slug: row.category_slug,
      description: row.category_description ?? '',
    },
  };
}

/**
 * Fetches hydrated videos using indexed LEFT JOINs with PostgreSQL constant
 * one-time filter short-circuiting when `viewerId` is null.
 */
async function queryHydratedVideos(params: {
  viewerId: string | null;
  categorySlug?: string | null;
  searchPattern?: string | null;
  creatorId?: string | null;
  videoId?: string | null;
  limit?: number;
}): Promise<VideoWithMeta[]> {
  const sql = getNeonSql();
  const viewerId = params.viewerId ?? null;
  const categorySlug =
    params.categorySlug && params.categorySlug !== 'all'
      ? params.categorySlug
      : null;
  const searchPattern = params.searchPattern ?? null;
  const creatorId = params.creatorId ?? null;
  const videoId = params.videoId ?? null;
  const limit = Math.min(Math.max(params.limit ?? 120, 1), 250);

  const rows = (await sql`
    SELECT
      v.id,
      v.user_id,
      v.category_id,
      v.title,
      v.description,
      v.video_url,
      v.thumbnail_url,
      v.duration_seconds,
      v.reflection_prompt,
      v.views,
      v.likes,
      v.created_at,
      u.name AS creator_name,
      u.username AS creator_username,
      u.email AS creator_email,
      u.avatar_url AS creator_avatar_url,
      COALESCE(u.bio, '') AS creator_bio,
      COALESCE(u.credentials, '') AS creator_credentials,
      u.is_educator AS creator_is_educator,
      u.followers_count AS creator_followers_count,
      u.created_at AS creator_created_at,
      c.name AS category_name,
      c.slug AS category_slug,
      COALESCE(c.description, '') AS category_description,
      (SELECT COUNT(*)::int FROM video_chapters vc WHERE vc.video_id = v.id) AS chapter_count,
      (b.video_id IS NOT NULL) AS is_bookmarked,
      (vl.video_id IS NOT NULL) AS has_liked,
      COALESCE(wh.progress_seconds, 0)::int AS watch_progress_seconds
    FROM videos v
    JOIN users u ON u.id = v.user_id
    JOIN categories c ON c.id = v.category_id
    LEFT JOIN bookmarks b
      ON ${viewerId}::text IS NOT NULL AND b.video_id = v.id AND b.user_id = ${viewerId}
    LEFT JOIN video_likes vl
      ON ${viewerId}::text IS NOT NULL AND vl.video_id = v.id AND vl.user_id = ${viewerId}
    LEFT JOIN watch_history wh
      ON ${viewerId}::text IS NOT NULL AND wh.video_id = v.id AND wh.user_id = ${viewerId}
    WHERE (${videoId}::text IS NULL OR v.id = ${videoId})
      AND (${categorySlug}::text IS NULL OR c.slug = ${categorySlug})
      AND (${creatorId}::text IS NULL OR v.user_id = ${creatorId})
      AND (
        ${searchPattern}::text IS NULL
        OR v.title ILIKE ${searchPattern} ESCAPE '\'
        OR v.description ILIKE ${searchPattern} ESCAPE '\'
        OR u.name ILIKE ${searchPattern} ESCAPE '\'
        OR c.name ILIKE ${searchPattern} ESCAPE '\'
      )
    ORDER BY v.created_at DESC
    LIMIT ${limit}
  `) as unknown as RawVideoRow[];

  return rows.map(mapVideoRow);
}

/**
 * Fetches up to 4 related videos directly in PostgreSQL (prioritizing same
 * category, then highest views) without loading the full catalog.
 */
async function queryRelatedVideos(
  excludeVideoId: string,
  categoryId: string,
  viewerId: string | null
): Promise<VideoWithMeta[]> {
  const sql = getNeonSql();
  const rows = (await sql`
    SELECT
      v.id,
      v.user_id,
      v.category_id,
      v.title,
      v.description,
      v.video_url,
      v.thumbnail_url,
      v.duration_seconds,
      v.reflection_prompt,
      v.views,
      v.likes,
      v.created_at,
      u.name AS creator_name,
      u.username AS creator_username,
      u.email AS creator_email,
      u.avatar_url AS creator_avatar_url,
      COALESCE(u.bio, '') AS creator_bio,
      COALESCE(u.credentials, '') AS creator_credentials,
      u.is_educator AS creator_is_educator,
      u.followers_count AS creator_followers_count,
      u.created_at AS creator_created_at,
      c.name AS category_name,
      c.slug AS category_slug,
      COALESCE(c.description, '') AS category_description,
      (SELECT COUNT(*)::int FROM video_chapters vc WHERE vc.video_id = v.id) AS chapter_count,
      (b.video_id IS NOT NULL) AS is_bookmarked,
      (vl.video_id IS NOT NULL) AS has_liked,
      COALESCE(wh.progress_seconds, 0)::int AS watch_progress_seconds
    FROM videos v
    JOIN users u ON u.id = v.user_id
    JOIN categories c ON c.id = v.category_id
    LEFT JOIN bookmarks b
      ON ${viewerId}::text IS NOT NULL AND b.video_id = v.id AND b.user_id = ${viewerId}
    LEFT JOIN video_likes vl
      ON ${viewerId}::text IS NOT NULL AND vl.video_id = v.id AND vl.user_id = ${viewerId}
    LEFT JOIN watch_history wh
      ON ${viewerId}::text IS NOT NULL AND wh.video_id = v.id AND wh.user_id = ${viewerId}
    WHERE v.id <> ${excludeVideoId}
    ORDER BY (CASE WHEN v.category_id = ${categoryId} THEN 1 ELSE 0 END) DESC, v.views DESC
    LIMIT 4
  `) as unknown as RawVideoRow[];

  return rows.map(mapVideoRow);
}

/**
 * Per-request React cache + bounded server TTL cache for categories.
 */
export const getCategories = cache(async (): Promise<Category[]> => {
  if (!isNeonConfigured()) {
    return [];
  }

  return getServerCache().getOrLoad(
    'categories:all',
    CACHE_TTL_MS.CATEGORIES,
    () =>
      withOptionalNeonRead<Category[]>([], async () => {
        const sql = getNeonSql();
        // Single-round-trip CTE: purge unused legacy mock categories and load active categories
        const rows = (await sql`
          WITH purged AS (
            DELETE FROM categories c
            WHERE (
              c.id = ANY(${[...LEGACY_MOCK_CATEGORY_IDS]}::text[])
              OR c.slug = ANY(${[...LEGACY_MOCK_CATEGORY_SLUGS]}::text[])
            )
            AND NOT EXISTS (
              SELECT 1 FROM videos v WHERE v.category_id = c.id
            )
          )
          SELECT id::text, name, slug, COALESCE(description, '') AS description
          FROM categories
          ORDER BY name ASC
        `) as unknown as Category[];

        return rows.filter((row) => !isLegacyMockCategory(row));
      })
  );
});

export async function listVideos(options?: {
  categorySlug?: string;
  search?: string;
  viewerId?: string | null;
}): Promise<VideoWithMeta[]> {
  if (!isNeonConfigured()) {
    return [];
  }

  const viewerId =
    options?.viewerId !== undefined
      ? options.viewerId
      : await getOptionalViewerId();
  const categorySlug =
    options?.categorySlug && options.categorySlug !== 'all'
      ? options.categorySlug.trim()
      : null;
  const searchPattern = buildIlikeSearchPattern(options?.search);

  if (!viewerId && !searchPattern) {
    const cacheKey = `videos:public:${categorySlug ?? 'all'}`;
    return getServerCache().getOrLoad(
      cacheKey,
      CACHE_TTL_MS.VIDEOS_LIST,
      () =>
        withOptionalNeonRead<VideoWithMeta[]>([], () =>
          queryHydratedVideos({
            viewerId: null,
            categorySlug,
            searchPattern: null,
          })
        )
    );
  }

  return withOptionalNeonRead<VideoWithMeta[]>([], () =>
    queryHydratedVideos({
      viewerId,
      categorySlug,
      searchPattern,
    })
  );
}

/**
 * Memoized single-video detail fetch per request (deduplicates generateMetadata
 * and WatchPage renders on `/watch/[id]`).
 */
const loadVideoDetailBase = cache(
  async (
    videoId: string,
    viewerId: string | null
  ): Promise<VideoDetail | null> => {
    if (!isNeonConfigured()) {
      return null;
    }

    const fetchDetail = (): Promise<VideoDetail | null> =>
      withOptionalNeonRead<VideoDetail | null>(null, async () => {
        const sql = getNeonSql();

        const [videoRows, chapterRows, commentRows, reactionRows] =
          await Promise.all([
            queryHydratedVideos({ viewerId, videoId, limit: 1 }),
            sql`
              SELECT id, video_id, timestamp_seconds, title, COALESCE(summary, '') AS summary
              FROM video_chapters
              WHERE video_id = ${videoId}
              ORDER BY timestamp_seconds ASC
            `,
            sql`
              SELECT
                cm.id,
                cm.video_id,
                cm.user_id,
                cm.parent_id,
                cm.content,
                cm.is_anonymous,
                cm.upvotes,
                cm.created_at,
                u.name AS author_name,
                u.username AS author_username,
                u.avatar_url AS author_avatar_url,
                u.is_educator AS author_is_educator,
                (cu.comment_id IS NOT NULL) AS has_upvoted
              FROM comments cm
              JOIN users u ON u.id = cm.user_id
              LEFT JOIN comment_upvotes cu
                ON ${viewerId}::text IS NOT NULL AND cu.comment_id = cm.id AND cu.user_id = ${viewerId}
              WHERE cm.video_id = ${videoId}
              ORDER BY cm.created_at DESC
              LIMIT 200
            `,
            sql`
              SELECT
                reaction_type,
                COUNT(*)::int AS count,
                BOOL_OR(${viewerId}::text IS NOT NULL AND user_id = ${viewerId}) AS viewer_reacted
              FROM video_reactions
              WHERE video_id = ${videoId}
              GROUP BY reaction_type
            `,
          ]);

        const hydrated = videoRows[0];
        if (!hydrated) return null;

        const [relatedVideos, followRows] = await Promise.all([
          queryRelatedVideos(videoId, hydrated.categoryId, viewerId),
          viewerId
            ? sql`
                SELECT 1 FROM creator_follows
                WHERE follower_id = ${viewerId} AND creator_id = ${hydrated.userId}
                LIMIT 1
              `
            : Promise.resolve([]),
        ]);

        const chapters = (chapterRows as unknown as RawChapterRow[]).map(
          mapChapterRow
        );

        const comments: CommentItem[] = (
          commentRows as unknown as Array<{
            id: string;
            video_id: string;
            user_id: string;
            parent_id: string | null;
            content: string;
            is_anonymous: boolean;
            upvotes: number;
            created_at: string | Date;
            author_name: string;
            author_username: string;
            author_avatar_url: string | null;
            author_is_educator: boolean;
            has_upvoted: boolean;
          }>
        ).map((c) => ({
          id: c.id,
          videoId: c.video_id,
          userId: c.user_id,
          parentId: c.parent_id,
          content: c.content,
          isAnonymous: Boolean(c.is_anonymous),
          upvotes: Number(c.upvotes),
          createdAt: toIso(c.created_at),
          hasUpvoted: Boolean(c.has_upvoted),
          author: {
            id: c.user_id,
            name: c.author_name,
            username: c.author_username,
            avatarUrl: c.author_avatar_url,
            isEducator: Boolean(c.author_is_educator),
          },
        }));

        const rawReactionMap: Partial<Record<string, number>> = {};
        const viewerReactionsList: string[] = [];
        for (const r of reactionRows as unknown as Array<{
          reaction_type: string;
          count: number;
          viewer_reacted: boolean;
        }>) {
          if (isValidVideoReactionType(r.reaction_type)) {
            rawReactionMap[r.reaction_type] = Number(r.count ?? 0);
            if (r.viewer_reacted) {
              viewerReactionsList.push(r.reaction_type);
            }
          }
        }

        return {
          ...hydrated,
          chapters,
          comments,
          isFollowingCreator: followRows.length > 0,
          relatedVideos,
          reactions: normalizeReactionState({
            counts: rawReactionMap,
            viewerReactions: viewerReactionsList,
          }),
        };
      });

    if (!viewerId) {
      return getServerCache().getOrLoad(
        `video:${videoId}:public`,
        CACHE_TTL_MS.VIDEO_DETAIL,
        fetchDetail
      );
    }

    return fetchDetail();
  }
);

export async function getVideoDetail(
  videoId: string,
  incrementViews = false,
  viewerIdOverride?: string | null
): Promise<VideoDetail | null> {
  if (!isNeonConfigured()) {
    return null;
  }

  const viewerId =
    viewerIdOverride !== undefined
      ? viewerIdOverride
      : await getOptionalViewerId();

  const detail = await loadVideoDetailBase(videoId, viewerId);
  if (!detail) return null;

  if (incrementViews) {
    const sql = getNeonSql();
    const updates: Array<Promise<unknown>> = [
      sql`UPDATE videos SET views = views + 1 WHERE id = ${videoId}`,
    ];
    if (viewerId) {
      updates.push(
        ensureViewerRowInDb(viewerId).then(() =>
          sql`
            INSERT INTO watch_history (user_id, video_id, progress_seconds, watched_at)
            VALUES (${viewerId}, ${videoId}, 0, NOW())
            ON CONFLICT (user_id, video_id)
            DO UPDATE SET watched_at = NOW()
          `
        )
      );
    }
    void Promise.allSettled(updates);
    return {
      ...detail,
      views: detail.views + 1,
    };
  }

  return detail;
}

async function resolveOrCreateCategoryNeon(
  categoryId?: string,
  categoryName?: string
): Promise<string> {
  const sql = getNeonSql();
  const trimmedName = categoryName?.trim();

  if (trimmedName) {
    const baseSlug =
      slugifyCategory(trimmedName) || `topic-${crypto.randomUUID().slice(0, 4)}`;
    const existing = (await sql`
      SELECT id FROM categories
      WHERE LOWER(name) = LOWER(${trimmedName}) OR LOWER(slug) = LOWER(${baseSlug})
      LIMIT 1
    `) as unknown as Array<{ id: string }>;

    if (existing.length > 0) {
      return existing[0].id;
    }

    const newId = `cat-${crypto.randomUUID().slice(0, 8)}`;
    await sql`
      INSERT INTO categories (id, name, slug, description)
      VALUES (${newId}, ${trimmedName}, ${baseSlug}, '')
    `;
    invalidateCategoryCaches();
    return newId;
  }

  if (categoryId?.trim()) {
    const existingById = (await sql`
      SELECT id FROM categories WHERE id = ${categoryId.trim()} LIMIT 1
    `) as unknown as Array<{ id: string }>;
    if (existingById.length > 0) {
      return existingById[0].id;
    }
  }

  const firstExisting = (await sql`
    SELECT id FROM categories ORDER BY name ASC LIMIT 1
  `) as unknown as Array<{ id: string }>;
  if (firstExisting.length > 0) {
    return firstExisting[0].id;
  }

  const defaultId = 'cat-general';
  await sql`
    INSERT INTO categories (id, name, slug, description)
    VALUES (${defaultId}, 'General', 'general', 'Curated video releases')
    ON CONFLICT (slug) DO NOTHING
  `;
  const created = (await sql`
    SELECT id FROM categories WHERE slug = 'general' LIMIT 1
  `) as unknown as Array<{ id: string }>;
  invalidateCategoryCaches();
  return created[0]?.id ?? defaultId;
}

async function resolveOrCreateEducatorNeon(
  userId?: string,
  educatorName?: string
): Promise<string> {
  const sql = getNeonSql();
  const trimmedName = educatorName?.trim();

  if (trimmedName) {
    const baseSlug =
      slugifyCategory(trimmedName) || `creator-${crypto.randomUUID().slice(0, 4)}`;
    const existing = (await sql`
      SELECT id FROM users
      WHERE LOWER(name) = LOWER(${trimmedName}) OR LOWER(username) = LOWER(${baseSlug})
      LIMIT 1
    `) as unknown as Array<{ id: string }>;

    if (existing.length > 0) {
      return existing[0].id;
    }

    const shortId = crypto.randomUUID().slice(0, 8);
    const newId = `usr-${shortId}`;
    const usernameCheck = (await sql`
      SELECT id FROM users WHERE LOWER(username) = LOWER(${baseSlug}) LIMIT 1
    `) as unknown as Array<{ id: string }>;
    const uniqueUsername =
      usernameCheck.length > 0 ? `${baseSlug}-${shortId.slice(0, 4)}` : baseSlug;
    const email = `${uniqueUsername}@heylady.vip`;
    const now = new Date().toISOString();

    await sql`
      INSERT INTO users (id, name, username, email, avatar_url, bio, credentials, is_educator, followers_count, created_at)
      VALUES (${newId}, ${trimmedName}, ${uniqueUsername}, ${email}, ${null}, '', 'Featured Creator', TRUE, 0, ${now})
    `;
    return newId;
  }

  if (userId?.trim()) {
    const found = (await sql`
      SELECT id FROM users WHERE id = ${userId.trim()} LIMIT 1
    `) as unknown as Array<{ id: string }>;
    if (found.length > 0) {
      return found[0].id;
    }
  }

  const existingEducator = (await sql`
    SELECT id FROM users WHERE is_educator = TRUE ORDER BY created_at ASC LIMIT 1
  `) as unknown as Array<{ id: string }>;
  if (existingEducator.length > 0) {
    return existingEducator[0].id;
  }

  const defaultId = 'usr-editorial';
  await sql`
    INSERT INTO users (id, name, username, email, avatar_url, bio, credentials, is_educator, followers_count)
    VALUES (${defaultId}, 'Hey Lady Editorial', 'hey-lady-editorial', 'editorial@heylady.vip', NULL, 'Curated luxury 18+ releases and VIP creator collections.', 'Editorial Channel', TRUE, 0)
    ON CONFLICT (username) DO NOTHING
  `;
  const created = (await sql`
    SELECT id FROM users WHERE username = 'hey-lady-editorial' LIMIT 1
  `) as unknown as Array<{ id: string }>;
  return created[0]?.id ?? defaultId;
}

async function batchInsertChapters(
  videoId: string,
  chapterList: Array<{ timestampSeconds: number; title: string }>
): Promise<void> {
  if (chapterList.length === 0) return;
  const sql = getNeonSql();
  const ids = chapterList.map(() => `ch-${crypto.randomUUID().slice(0, 8)}`);
  const timestamps = chapterList.map((ch) => ch.timestampSeconds);
  const titles = chapterList.map((ch) => ch.title);

  await sql`
    INSERT INTO video_chapters (id, video_id, timestamp_seconds, title, summary)
    SELECT ch_id, ${videoId}, ts, title, ''
    FROM UNNEST(${ids}::text[], ${timestamps}::int[], ${titles}::text[])
      AS t(ch_id, ts, title)
    ON CONFLICT (video_id, timestamp_seconds) DO NOTHING
  `;
}

export async function createVideo(
  payload: AdminVideoLinkPayload
): Promise<{ video?: VideoWithMeta; errors?: Record<string, string> }> {
  const validation = validateUploadPayload(payload);
  if (!validation.valid) {
    return { errors: validation.errors };
  }

  return withNeonSchemaRecovery(async () => {
    const sql = getNeonSql();

    const videoId = `vid-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const durationSeconds = Math.max(1, Math.round(payload.durationSeconds || 600));
    const chapterList =
      validation.parsedChapters.length > 0
        ? validation.parsedChapters
        : [{ timestampSeconds: 0, title: 'Video Overview' }];

    const [resolvedCategoryId, resolvedUserId] = await Promise.all([
      resolveOrCreateCategoryNeon(payload.categoryId, payload.categoryName),
      resolveOrCreateEducatorNeon(payload.userId, payload.educatorName),
    ]);

    await sql`
      INSERT INTO videos (id, user_id, category_id, title, description, video_url, thumbnail_url, duration_seconds, reflection_prompt, views, likes, created_at)
      VALUES (${videoId}, ${resolvedUserId}, ${resolvedCategoryId}, ${payload.title.trim()}, ${payload.description.trim()}, ${payload.videoUrl.trim()}, ${payload.thumbnailUrl.trim()}, ${durationSeconds}, ${payload.reflectionPrompt.trim()}, 0, 0, ${now})
    `;

    await batchInsertChapters(videoId, chapterList);
    invalidateCatalogCaches(videoId);

    const createdRows = await queryHydratedVideos({
      viewerId: null,
      videoId,
      limit: 1,
    });
    return { video: createdRows[0] };
  });
}

export async function updateVideo(
  videoId: string,
  payload: AdminVideoLinkPayload
): Promise<{
  video?: VideoWithMeta;
  errors?: Record<string, string>;
  notFound?: boolean;
}> {
  const validation = validateUploadPayload(payload);
  if (!validation.valid) {
    return { errors: validation.errors };
  }

  return withNeonSchemaRecovery(async () => {
    const sql = getNeonSql();

    const existingRows = (await sql`
      SELECT id, user_id, duration_seconds FROM videos WHERE id = ${videoId} LIMIT 1
    `) as unknown as Array<{ id: string; user_id: string; duration_seconds: number }>;

    if (existingRows.length === 0) {
      return { notFound: true };
    }

    const chapterList =
      validation.parsedChapters.length > 0
        ? validation.parsedChapters
        : [{ timestampSeconds: 0, title: 'Video Overview' }];

    const durationSeconds = Math.max(
      1,
      Math.round(payload.durationSeconds || Number(existingRows[0].duration_seconds))
    );

    const [resolvedCategoryId, nextUserId] = await Promise.all([
      resolveOrCreateCategoryNeon(payload.categoryId, payload.categoryName),
      payload.educatorName?.trim()
        ? resolveOrCreateEducatorNeon(payload.userId, payload.educatorName)
        : Promise.resolve(payload.userId?.trim() || existingRows[0].user_id),
    ]);

    await Promise.all([
      sql`
        UPDATE videos
        SET
          title = ${payload.title.trim()},
          description = ${payload.description.trim()},
          category_id = ${resolvedCategoryId},
          user_id = ${nextUserId},
          video_url = ${payload.videoUrl.trim()},
          thumbnail_url = ${payload.thumbnailUrl.trim()},
          duration_seconds = ${durationSeconds},
          reflection_prompt = ${payload.reflectionPrompt.trim()}
        WHERE id = ${videoId}
      `,
      sql`DELETE FROM video_chapters WHERE video_id = ${videoId}`,
    ]);

    await batchInsertChapters(videoId, chapterList);
    invalidateCatalogCaches(videoId);

    const updatedRows = await queryHydratedVideos({
      viewerId: null,
      videoId,
      limit: 1,
    });
    return { video: updatedRows[0] };
  });
}

export async function deleteVideo(videoId: string): Promise<boolean> {
  return withNeonSchemaRecovery(async () => {
    const sql = getNeonSql();
    const deletedRows = await sql`
      DELETE FROM videos WHERE id = ${videoId} RETURNING id
    `;
    if (deletedRows.length > 0) {
      invalidateCatalogCaches(videoId);
      return true;
    }
    return false;
  });
}

/**
 * Atomic 1-round-trip CTE toggle for video likes.
 */
export async function toggleVideoLike(
  videoId: string,
  viewerId: string
): Promise<{ videoId: string; likes: number; hasLiked: boolean } | null> {
  return withNeonSchemaRecovery(async () => {
    await ensureViewerRowInDb(viewerId);
    const sql = getNeonSql();

    const rows = (await sql`
      WITH del AS (
        DELETE FROM video_likes
        WHERE user_id = ${viewerId} AND video_id = ${videoId}
        RETURNING 1
      ),
      ins AS (
        INSERT INTO video_likes (user_id, video_id)
        SELECT ${viewerId}, v.id
        FROM videos v
        WHERE v.id = ${videoId} AND NOT EXISTS (SELECT 1 FROM del)
        ON CONFLICT DO NOTHING
        RETURNING 1
      ),
      upd AS (
        UPDATE videos
        SET likes = GREATEST(
          0,
          likes + CASE
            WHEN EXISTS (SELECT 1 FROM ins) THEN 1
            WHEN EXISTS (SELECT 1 FROM del) THEN -1
            ELSE 0
          END
        )
        WHERE id = ${videoId}
        RETURNING likes
      )
      SELECT upd.likes, EXISTS (SELECT 1 FROM ins) AS has_liked
      FROM upd
    `) as unknown as Array<{ likes: number; has_liked: boolean }>;

    if (rows.length === 0) return null;

    invalidateCatalogCaches(videoId);
    return {
      videoId,
      likes: Number(rows[0].likes ?? 0),
      hasLiked: Boolean(rows[0].has_liked),
    };
  });
}

/**
 * Fetches current reaction counts and active viewer reactions for a video.
 */
export async function getVideoReactions(
  videoId: string,
  viewerIdOverride?: string | null
): Promise<VideoReactionState> {
  const emptyState: VideoReactionState = {
    counts: createEmptyReactionCounts(),
    viewerReactions: [],
  };
  if (!isNeonConfigured()) {
    return emptyState;
  }

  const viewerId =
    viewerIdOverride !== undefined
      ? viewerIdOverride
      : await getOptionalViewerId();

  return withOptionalNeonRead<VideoReactionState>(emptyState, async () => {
    const sql = getNeonSql();
    const rows = (await sql`
      SELECT
        reaction_type,
        COUNT(*)::int AS count,
        BOOL_OR(${viewerId}::text IS NOT NULL AND user_id = ${viewerId}) AS viewer_reacted
      FROM video_reactions
      WHERE video_id = ${videoId}
      GROUP BY reaction_type
    `) as unknown as Array<{
      reaction_type: string;
      count: number;
      viewer_reacted: boolean;
    }>;

    const counts: Partial<Record<string, number>> = {};
    const viewerReactions: string[] = [];
    for (const r of rows) {
      if (isValidVideoReactionType(r.reaction_type)) {
        counts[r.reaction_type] = Number(r.count ?? 0);
        if (r.viewer_reacted) {
          viewerReactions.push(r.reaction_type);
        }
      }
    }

    return normalizeReactionState({ counts, viewerReactions });
  });
}

/**
 * Atomic 1-round-trip CTE toggle for an emoji reaction on a video.
 */
export async function toggleVideoReaction(
  videoId: string,
  viewerId: string,
  reactionType: VideoReactionType
): Promise<
  | (VideoReactionState & {
      videoId: string;
      reactionType: VideoReactionType;
      active: boolean;
    })
  | null
> {
  if (!isValidVideoReactionType(reactionType)) {
    return null;
  }

  return withNeonSchemaRecovery(async () => {
    await ensureViewerRowInDb(viewerId);
    const sql = getNeonSql();

    const vidRows = (await sql`
      SELECT id FROM videos WHERE id = ${videoId} LIMIT 1
    `) as unknown as Array<{ id: string }>;
    if (vidRows.length === 0) {
      return null;
    }

    const toggleRows = (await sql`
      WITH del AS (
        DELETE FROM video_reactions
        WHERE user_id = ${viewerId}
          AND video_id = ${videoId}
          AND reaction_type = ${reactionType}
        RETURNING 1
      ),
      ins AS (
        INSERT INTO video_reactions (user_id, video_id, reaction_type)
        SELECT ${viewerId}, ${videoId}, ${reactionType}
        WHERE NOT EXISTS (SELECT 1 FROM del)
        ON CONFLICT DO NOTHING
        RETURNING 1
      )
      SELECT EXISTS (SELECT 1 FROM ins) AS active
    `) as unknown as Array<{ active: boolean }>;

    const active = Boolean(toggleRows[0]?.active);
    const updatedState = await getVideoReactions(videoId, viewerId);
    invalidateCatalogCaches(videoId);

    return {
      videoId,
      reactionType,
      active,
      ...updatedState,
    };
  });
}

/**
 * Fetches 5-star rating distribution, average rating, viewer rating, and recent feedback for a video.
 */
export async function getVideoRatingSummary(
  videoId: string,
  viewerIdOverride?: string | null
): Promise<VideoRatingSummary> {
  const viewerId =
    viewerIdOverride !== undefined
      ? viewerIdOverride
      : await getOptionalViewerId();

  const emptySummary = createEmptyVideoRatingSummary(Boolean(viewerId));
  if (!isNeonConfigured()) {
    return emptySummary;
  }

  return withOptionalNeonRead<VideoRatingSummary>(emptySummary, async () => {
    const sql = getNeonSql();
    const [distRows, viewerRows, reviewRows] = await Promise.all([
      sql`
        SELECT rating::int AS rating, COUNT(*)::int AS count
        FROM video_ratings
        WHERE video_id = ${videoId}
        GROUP BY rating
      `,
      viewerId
        ? sql`
            SELECT rating::int AS rating, COALESCE(feedback, '') AS feedback
            FROM video_ratings
            WHERE video_id = ${videoId} AND user_id = ${viewerId}
            LIMIT 1
          `
        : Promise.resolve([]),
      sql`
        SELECT
          vr.user_id,
          vr.rating::int AS rating,
          COALESCE(vr.feedback, '') AS feedback,
          vr.updated_at,
          COALESCE(NULLIF(TRIM(u.name), ''), 'Verified Member') AS author_name
        FROM video_ratings vr
        JOIN users u ON u.id = vr.user_id
        WHERE vr.video_id = ${videoId}
          AND char_length(trim(vr.feedback)) > 0
        ORDER BY vr.updated_at DESC
        LIMIT 6
      `,
    ]);

    const distribution = createEmptyRatingDistribution();
    for (const row of distRows as unknown as Array<{
      rating: number;
      count: number;
    }>) {
      const r = Number(row.rating);
      if (isValidStarRating(r)) {
        distribution[r] = Number(row.count ?? 0);
      }
    }

    const viewerRow = (
      viewerRows as unknown as Array<{ rating: number; feedback: string }>
    )[0];
    const viewerRating =
      viewerRow && isValidStarRating(Number(viewerRow.rating))
        ? (Number(viewerRow.rating) as VideoRatingStar)
        : null;
    const viewerFeedback = viewerRow
      ? sanitizeRatingFeedback(viewerRow.feedback)
      : '';

    const recentReviews: VideoRatingReviewItem[] = (
      reviewRows as unknown as Array<{
        user_id: string;
        rating: number;
        feedback: string;
        updated_at: string | Date;
        author_name: string;
      }>
    )
      .filter((item) => isValidStarRating(Number(item.rating)))
      .map((item) => ({
        userId: item.user_id,
        authorName: item.author_name || 'Verified Member',
        rating: Number(item.rating) as VideoRatingStar,
        feedback: sanitizeRatingFeedback(item.feedback),
        updatedAt: toIso(item.updated_at),
      }));

    return normalizeVideoRatingSummary({
      distribution,
      viewerRating,
      viewerFeedback,
      isAuthenticated: true,
      recentReviews,
    });
  });
}

/**
 * Atomic PostgreSQL upsert for an authenticated viewer's 1-5 star rating and feedback.
 */
export async function submitVideoRating(params: {
  videoId: string;
  viewerId: string;
  rating: VideoRatingStar;
  feedback?: string;
  authorName?: string;
}): Promise<(VideoRatingSummary & { videoId: string }) | null> {
  const { videoId, viewerId, rating } = params;
  if (!isValidStarRating(rating)) {
    return null;
  }
  const cleanFeedback = sanitizeRatingFeedback(params.feedback ?? '');
  const cleanAuthorName = (params.authorName ?? '').trim().slice(0, 48);

  return withNeonSchemaRecovery(async () => {
    await ensureViewerRowInDb(viewerId);
    const sql = getNeonSql();

    const vidRows = (await sql`
      SELECT id FROM videos WHERE id = ${videoId} LIMIT 1
    `) as unknown as Array<{ id: string }>;
    if (vidRows.length === 0) {
      return null;
    }

    if (cleanAuthorName.length >= 2) {
      await sql`
        UPDATE users
        SET name = ${cleanAuthorName}
        WHERE id = ${viewerId} AND is_admin = FALSE AND is_educator = FALSE
      `;
    }

    await sql`
      INSERT INTO video_ratings (user_id, video_id, rating, feedback, updated_at)
      VALUES (${viewerId}, ${videoId}, ${rating}, ${cleanFeedback}, NOW())
      ON CONFLICT (user_id, video_id)
      DO UPDATE SET
        rating = EXCLUDED.rating,
        feedback = EXCLUDED.feedback,
        updated_at = NOW()
    `;

    invalidateCatalogCaches(videoId);
    const summary = await getVideoRatingSummary(videoId, viewerId);

    return {
      videoId,
      ...summary,
    };
  });
}

export async function recordSourcePlayClick(
  videoId: string,
  viewerId?: string | null
): Promise<{ videoId: string; views: number; sourceUrl: string } | null> {
  return withNeonSchemaRecovery(async () => {
    const sql = getNeonSql();

    const rows = (await sql`
      UPDATE videos
      SET views = views + 1
      WHERE id = ${videoId}
      RETURNING id, views, video_url, duration_seconds
    `) as unknown as Array<{
      id: string;
      views: number;
      video_url: string;
      duration_seconds: number;
    }>;

    if (rows.length === 0) return null;
    const row = rows[0];

    if (viewerId) {
      const minProgress = Math.floor(Number(row.duration_seconds) * 0.15);
      await ensureViewerRowInDb(viewerId);
      await sql`
        INSERT INTO watch_history (user_id, video_id, progress_seconds, watched_at)
        VALUES (${viewerId}, ${videoId}, ${minProgress}, NOW())
        ON CONFLICT (user_id, video_id)
        DO UPDATE SET
          progress_seconds = GREATEST(watch_history.progress_seconds, ${minProgress}),
          watched_at = NOW()
      `;
    }

    invalidateCatalogCaches(videoId);
    return {
      videoId: row.id,
      views: Number(row.views),
      sourceUrl: row.video_url,
    };
  });
}

export async function listAdminComments(): Promise<AdminCommentItem[]> {
  if (!isNeonConfigured()) {
    return [];
  }
  return withNeonSchemaRecovery(async () => {
    const sql = getNeonSql();

    const rows = (await sql`
      SELECT
        cm.id,
        cm.video_id,
        cm.user_id,
        cm.parent_id,
        cm.content,
        cm.is_anonymous,
        cm.upvotes,
        cm.created_at,
        u.name AS author_name,
        u.username AS author_username,
        u.avatar_url AS author_avatar_url,
        u.is_educator AS author_is_educator,
        v.title AS video_title
      FROM comments cm
      JOIN users u ON u.id = cm.user_id
      JOIN videos v ON v.id = cm.video_id
      ORDER BY cm.created_at DESC
      LIMIT 300
    `) as unknown as Array<{
      id: string;
      video_id: string;
      user_id: string;
      parent_id: string | null;
      content: string;
      is_anonymous: boolean;
      upvotes: number;
      created_at: string | Date;
      author_name: string;
      author_username: string;
      author_avatar_url: string | null;
      author_is_educator: boolean;
      video_title: string;
    }>;

    return rows.map((c) => ({
      id: c.id,
      videoId: c.video_id,
      videoTitle: c.video_title,
      userId: c.user_id,
      parentId: c.parent_id,
      content: c.content,
      isAnonymous: Boolean(c.is_anonymous),
      upvotes: Number(c.upvotes),
      createdAt: toIso(c.created_at),
      author: {
        id: c.user_id,
        name: c.author_name,
        username: c.author_username,
        avatarUrl: c.author_avatar_url,
        isEducator: Boolean(c.author_is_educator),
      },
    }));
  });
}

/**
 * Atomic 1-round-trip recursive delete for a comment and any nested replies.
 */
export async function deleteCommentByAdmin(commentId: string): Promise<boolean> {
  return withNeonSchemaRecovery(async () => {
    const sql = getNeonSql();
    const deleted = (await sql`
      WITH RECURSIVE subtree AS (
        SELECT id, video_id FROM comments WHERE id = ${commentId}
        UNION ALL
        SELECT c.id, c.video_id FROM comments c INNER JOIN subtree s ON c.parent_id = s.id
      )
      DELETE FROM comments
      WHERE id IN (SELECT id FROM subtree)
      RETURNING id, video_id
    `) as unknown as Array<{ id: string; video_id: string }>;

    if (deleted.length > 0) {
      invalidateCatalogCaches(deleted[0].video_id);
      return true;
    }
    return false;
  });
}

export async function getAdminCatalog(): Promise<{
  videos: Array<VideoWithMeta & { chapters: VideoChapter[] }>;
  categories: CategoryWithCount[];
  educators: User[];
  comments: AdminCommentItem[];
  stats: AdminDashboardStats;
}> {
  if (!isNeonConfigured()) {
    return {
      videos: [],
      categories: [],
      educators: [],
      comments: [],
      stats: { totalVideos: 0, totalViews: 0, totalLikes: 0, totalComments: 0 },
    };
  }

  return withNeonSchemaRecovery(async () => {
    const sql = getNeonSql();

    const [hydratedVideos, categories, educatorRows, comments] =
      await Promise.all([
        queryHydratedVideos({ viewerId: null, limit: 250 }),
        getCategories(),
        sql`
          SELECT id, name, username, email, avatar_url, COALESCE(bio, '') AS bio,
                 COALESCE(credentials, '') AS credentials, is_educator, followers_count, created_at
          FROM users
          WHERE is_educator = TRUE
          ORDER BY followers_count DESC
        `,
        listAdminComments(),
      ]);

    const videoIds = hydratedVideos.map((v) => v.id);
    const chapterRows =
      videoIds.length > 0
        ? ((await sql`
            SELECT id, video_id, timestamp_seconds, title, COALESCE(summary, '') AS summary
            FROM video_chapters
            WHERE video_id = ANY(${videoIds}::text[])
            ORDER BY timestamp_seconds ASC
          `) as unknown as RawChapterRow[])
        : [];

    const chaptersByVideo = new Map<string, VideoChapter[]>();
    for (const ch of chapterRows) {
      const list = chaptersByVideo.get(ch.video_id) ?? [];
      list.push(mapChapterRow(ch));
      chaptersByVideo.set(ch.video_id, list);
    }

    const videos = hydratedVideos.map((v) => ({
      ...v,
      chapters: chaptersByVideo.get(v.id) ?? [],
    }));

    const educators = (educatorRows as unknown as RawUserRow[]).map(mapUserRow);

    const categoryCountMap = new Map<string, number>();
    for (const v of videos) {
      categoryCountMap.set(v.categoryId, (categoryCountMap.get(v.categoryId) ?? 0) + 1);
    }

    return {
      videos,
      categories: categories.map((cat) => ({
        ...cat,
        videoCount: categoryCountMap.get(cat.id) ?? 0,
      })),
      educators,
      comments,
      stats: {
        totalVideos: videos.length,
        totalViews: videos.reduce((sum, v) => sum + v.views, 0),
        totalLikes: videos.reduce((sum, v) => sum + v.likes, 0),
        totalComments: comments.length,
      },
    };
  });
}

export async function addComment(params: {
  videoId: string;
  viewerId: string;
  content: string;
  isAnonymous: boolean;
  parentId?: string | null;
}): Promise<{ comment?: CommentItem; error?: string }> {
  const trimmed = params.content.trim();
  if (!trimmed) {
    return { error: 'Please write a reflection or question before posting.' };
  }
  if (trimmed.length > 2000) {
    return { error: 'Comments must be under 2,000 characters.' };
  }
  const normalizedParentId = params.parentId?.trim() || null;

  return withNeonSchemaRecovery(async () => {
    await ensureViewerRowInDb(params.viewerId);
    const sql = getNeonSql();

    const [vidRows, userRows, parentRows] = await Promise.all([
      sql`SELECT id FROM videos WHERE id = ${params.videoId} LIMIT 1`,
      sql`
        SELECT id, name, username, avatar_url, is_educator
        FROM users
        WHERE id = ${params.viewerId}
        LIMIT 1
      `,
      normalizedParentId
        ? sql`
            SELECT id FROM comments
            WHERE id = ${normalizedParentId} AND video_id = ${params.videoId}
            LIMIT 1
          `
        : Promise.resolve([{ id: null }]),
    ]);

    if (vidRows.length === 0) {
      return { error: 'Video not found.' };
    }
    if (normalizedParentId && parentRows.length === 0) {
      return { error: 'Parent comment not found on this video.' };
    }

    const authorRow = (
      userRows as unknown as Array<{
        id: string;
        name: string;
        username: string;
        avatar_url: string | null;
        is_educator: boolean;
      }>
    )[0];

    const commentId = `cmt-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    await sql`
      WITH inserted_comment AS (
        INSERT INTO comments (id, video_id, user_id, parent_id, content, is_anonymous, upvotes, created_at)
        VALUES (${commentId}, ${params.videoId}, ${params.viewerId}, ${normalizedParentId}, ${trimmed}, ${Boolean(params.isAnonymous)}, 1, ${now})
        RETURNING id
      )
      INSERT INTO comment_upvotes (user_id, comment_id)
      SELECT ${params.viewerId}, id FROM inserted_comment
      ON CONFLICT DO NOTHING
    `;

    invalidateCatalogCaches(params.videoId);

    return {
      comment: {
        id: commentId,
        videoId: params.videoId,
        userId: params.viewerId,
        parentId: normalizedParentId,
        content: trimmed,
        isAnonymous: Boolean(params.isAnonymous),
        upvotes: 1,
        createdAt: now,
        author: {
          id: authorRow?.id ?? params.viewerId,
          name: authorRow?.name ?? 'Community Member',
          username: authorRow?.username ?? 'member',
          avatarUrl: authorRow?.avatar_url ?? null,
          isEducator: Boolean(authorRow?.is_educator),
        },
        hasUpvoted: true,
      },
    };
  });
}

/**
 * Atomic 1-round-trip CTE toggle for comment upvotes.
 */
export async function toggleCommentUpvote(
  commentId: string,
  viewerId: string
): Promise<{ commentId: string; upvotes: number; hasUpvoted: boolean } | null> {
  return withNeonSchemaRecovery(async () => {
    await ensureViewerRowInDb(viewerId);
    const sql = getNeonSql();

    const rows = (await sql`
      WITH del AS (
        DELETE FROM comment_upvotes
        WHERE user_id = ${viewerId} AND comment_id = ${commentId}
        RETURNING 1
      ),
      ins AS (
        INSERT INTO comment_upvotes (user_id, comment_id)
        SELECT ${viewerId}, c.id
        FROM comments c
        WHERE c.id = ${commentId} AND NOT EXISTS (SELECT 1 FROM del)
        ON CONFLICT DO NOTHING
        RETURNING 1
      ),
      upd AS (
        UPDATE comments
        SET upvotes = GREATEST(
          0,
          upvotes + CASE
            WHEN EXISTS (SELECT 1 FROM ins) THEN 1
            WHEN EXISTS (SELECT 1 FROM del) THEN -1
            ELSE 0
          END
        )
        WHERE id = ${commentId}
        RETURNING upvotes, video_id
      )
      SELECT upd.upvotes, upd.video_id, EXISTS (SELECT 1 FROM ins) AS has_upvoted
      FROM upd
    `) as unknown as Array<{
      upvotes: number;
      video_id: string;
      has_upvoted: boolean;
    }>;

    if (rows.length === 0) return null;

    invalidateCatalogCaches(rows[0].video_id);
    return {
      commentId,
      upvotes: Number(rows[0].upvotes ?? 0),
      hasUpvoted: Boolean(rows[0].has_upvoted),
    };
  });
}

/**
 * Atomic 1-round-trip CTE toggle for video bookmarks.
 */
export async function toggleBookmark(
  videoId: string,
  viewerId: string
): Promise<{ videoId: string; isBookmarked: boolean }> {
  return withNeonSchemaRecovery(async () => {
    await ensureViewerRowInDb(viewerId);
    const sql = getNeonSql();

    const rows = (await sql`
      WITH del AS (
        DELETE FROM bookmarks
        WHERE user_id = ${viewerId} AND video_id = ${videoId}
        RETURNING 1
      ),
      ins AS (
        INSERT INTO bookmarks (user_id, video_id)
        SELECT ${viewerId}, v.id
        FROM videos v
        WHERE v.id = ${videoId} AND NOT EXISTS (SELECT 1 FROM del)
        ON CONFLICT DO NOTHING
        RETURNING 1
      )
      SELECT EXISTS (SELECT 1 FROM ins) AS is_bookmarked
    `) as unknown as Array<{ is_bookmarked: boolean }>;

    return {
      videoId,
      isBookmarked: Boolean(rows[0]?.is_bookmarked),
    };
  });
}

export async function recordWatchHistory(
  videoId: string,
  progressSeconds: number,
  viewerId: string
): Promise<void> {
  return withNeonSchemaRecovery(async () => {
    await ensureViewerRowInDb(viewerId);
    const safeProgress = Math.max(0, Math.floor(progressSeconds));
    const sql = getNeonSql();

    await sql`
      INSERT INTO watch_history (user_id, video_id, progress_seconds, watched_at)
      SELECT ${viewerId}, v.id, ${safeProgress}, NOW()
      FROM videos v
      WHERE v.id = ${videoId}
      ON CONFLICT (user_id, video_id)
      DO UPDATE SET progress_seconds = ${safeProgress}, watched_at = NOW()
    `;
  });
}

export async function clearWatchHistory(viewerId: string): Promise<void> {
  return withNeonSchemaRecovery(async () => {
    const sql = getNeonSql();
    await sql`DELETE FROM watch_history WHERE user_id = ${viewerId}`;
  });
}

/**
 * Targeted SQL INNER JOIN queries for bookmarks and watch history.
 * Returns immediately with 0 DB queries when the visitor has no viewer cookie yet.
 */
export async function getUserLibrary(viewerIdOverride?: string | null): Promise<{
  bookmarks: VideoWithMeta[];
  history: WatchHistoryEntry[];
}> {
  if (!isNeonConfigured()) {
    return { bookmarks: [], history: [] };
  }

  const viewerId =
    viewerIdOverride !== undefined
      ? viewerIdOverride
      : await getOptionalViewerId();

  if (!viewerId) {
    return { bookmarks: [], history: [] };
  }

  return withOptionalNeonRead({ bookmarks: [], history: [] }, async () => {
    const sql = getNeonSql();
    const [bookmarkRows, historyRows] = await Promise.all([
      sql`
        SELECT
          v.id, v.user_id, v.category_id, v.title, v.description,
          v.video_url, v.thumbnail_url, v.duration_seconds, v.reflection_prompt,
          v.views, v.likes, v.created_at,
          u.name AS creator_name, u.username AS creator_username, u.email AS creator_email,
          u.avatar_url AS creator_avatar_url, COALESCE(u.bio, '') AS creator_bio,
          COALESCE(u.credentials, '') AS creator_credentials, u.is_educator AS creator_is_educator,
          u.followers_count AS creator_followers_count, u.created_at AS creator_created_at,
          c.name AS category_name, c.slug AS category_slug, COALESCE(c.description, '') AS category_description,
          (SELECT COUNT(*)::int FROM video_chapters vc WHERE vc.video_id = v.id) AS chapter_count,
          TRUE AS is_bookmarked,
          (vl.video_id IS NOT NULL) AS has_liked,
          COALESCE(wh.progress_seconds, 0)::int AS watch_progress_seconds
        FROM bookmarks b
        JOIN videos v ON v.id = b.video_id
        JOIN users u ON u.id = v.user_id
        JOIN categories c ON c.id = v.category_id
        LEFT JOIN video_likes vl ON vl.video_id = v.id AND vl.user_id = ${viewerId}
        LEFT JOIN watch_history wh ON wh.video_id = v.id AND wh.user_id = ${viewerId}
        WHERE b.user_id = ${viewerId}
        ORDER BY b.created_at DESC
        LIMIT 100
      `,
      sql`
        SELECT
          wh.progress_seconds AS history_progress_seconds,
          wh.watched_at AS history_watched_at,
          v.id, v.user_id, v.category_id, v.title, v.description,
          v.video_url, v.thumbnail_url, v.duration_seconds, v.reflection_prompt,
          v.views, v.likes, v.created_at,
          u.name AS creator_name, u.username AS creator_username, u.email AS creator_email,
          u.avatar_url AS creator_avatar_url, COALESCE(u.bio, '') AS creator_bio,
          COALESCE(u.credentials, '') AS creator_credentials, u.is_educator AS creator_is_educator,
          u.followers_count AS creator_followers_count, u.created_at AS creator_created_at,
          c.name AS category_name, c.slug AS category_slug, COALESCE(c.description, '') AS category_description,
          (SELECT COUNT(*)::int FROM video_chapters vc WHERE vc.video_id = v.id) AS chapter_count,
          (b.video_id IS NOT NULL) AS is_bookmarked,
          (vl.video_id IS NOT NULL) AS has_liked,
          wh.progress_seconds::int AS watch_progress_seconds
        FROM watch_history wh
        JOIN videos v ON v.id = wh.video_id
        JOIN users u ON u.id = v.user_id
        JOIN categories c ON c.id = v.category_id
        LEFT JOIN bookmarks b ON b.video_id = v.id AND b.user_id = ${viewerId}
        LEFT JOIN video_likes vl ON vl.video_id = v.id AND vl.user_id = ${viewerId}
        WHERE wh.user_id = ${viewerId}
        ORDER BY wh.watched_at DESC
        LIMIT 50
      `,
    ]);

    const bookmarks = (bookmarkRows as unknown as RawVideoRow[]).map(mapVideoRow);
    const history: WatchHistoryEntry[] = (
      historyRows as unknown as Array<
        RawVideoRow & {
          history_progress_seconds: number;
          history_watched_at: string | Date;
        }
      >
    ).map((row) => ({
      videoId: row.id,
      progressSeconds: Number(row.history_progress_seconds ?? 0),
      watchedAt: toIso(row.history_watched_at),
      video: mapVideoRow(row),
    }));

    return { bookmarks, history };
  });
}

export const listEducators = cache(
  async (): Promise<
    Array<User & { videoCount: number; totalViews: number; isFollowing: boolean }>
  > => {
    if (!isNeonConfigured()) {
      return [];
    }

    const viewerId = await getOptionalViewerId();

    const load = () =>
      withOptionalNeonRead<
        Array<User & { videoCount: number; totalViews: number; isFollowing: boolean }>
      >([], async () => {
        const sql = getNeonSql();
        const rows = (await sql`
          SELECT
            u.id,
            u.name,
            u.username,
            u.email,
            u.avatar_url,
            COALESCE(u.bio, '') AS bio,
            COALESCE(u.credentials, '') AS credentials,
            u.is_educator,
            u.followers_count,
            u.created_at,
            COUNT(v.id)::int AS video_count,
            COALESCE(SUM(v.views), 0)::int AS total_views,
            (cf.creator_id IS NOT NULL) AS is_following
          FROM users u
          LEFT JOIN videos v ON v.user_id = u.id
          LEFT JOIN creator_follows cf
            ON ${viewerId}::text IS NOT NULL AND cf.creator_id = u.id AND cf.follower_id = ${viewerId}
          WHERE u.is_educator = TRUE
          GROUP BY u.id, cf.creator_id
          ORDER BY u.followers_count DESC
        `) as unknown as Array<
          RawUserRow & {
            video_count: number;
            total_views: number;
            is_following: boolean;
          }
        >;

        return rows.map((u) => ({
          ...mapUserRow(u),
          videoCount: Number(u.video_count),
          totalViews: Number(u.total_views),
          isFollowing: Boolean(u.is_following),
        }));
      });

    if (!viewerId) {
      return getServerCache().getOrLoad(
        'educators:public',
        CACHE_TTL_MS.EDUCATORS,
        load
      );
    }
    return load();
  }
);

/**
 * Per-request memoized creator profile fetch (deduplicates generateMetadata
 * and CreatorPage renders). Filters videos directly in PostgreSQL by creator ID.
 */
export const getCreatorProfile = cache(
  async (
    username: string
  ): Promise<{
    creator: User;
    videos: VideoWithMeta[];
    totalViews: number;
    isFollowing: boolean;
  } | null> => {
    if (!isNeonConfigured()) {
      return null;
    }

    const viewerId = await getOptionalViewerId();

    const load = () =>
      withOptionalNeonRead<{
        creator: User;
        videos: VideoWithMeta[];
        totalViews: number;
        isFollowing: boolean;
      } | null>(null, async () => {
        const sql = getNeonSql();
        const userRows = (await sql`
          SELECT id, name, username, email, avatar_url, COALESCE(bio, '') AS bio,
                 COALESCE(credentials, '') AS credentials, is_educator, followers_count, created_at
          FROM users
          WHERE username = ${username}
          LIMIT 1
        `) as unknown as RawUserRow[];

        if (userRows.length === 0) return null;
        const creator = mapUserRow(userRows[0]);

        const [videos, followRows] = await Promise.all([
          queryHydratedVideos({ viewerId, creatorId: creator.id, limit: 100 }),
          viewerId
            ? sql`
                SELECT 1 FROM creator_follows
                WHERE follower_id = ${viewerId} AND creator_id = ${creator.id}
                LIMIT 1
              `
            : Promise.resolve([]),
        ]);

        const totalViews = videos.reduce((acc, v) => acc + v.views, 0);

        return {
          creator,
          videos,
          totalViews,
          isFollowing: followRows.length > 0,
        };
      });

    if (!viewerId) {
      return getServerCache().getOrLoad(
        `creator:${username}:public`,
        CACHE_TTL_MS.CREATOR_PROFILE,
        load
      );
    }

    return load();
  }
);

/**
 * Atomic 1-round-trip CTE toggle for creator follows.
 */
export async function toggleFollowCreator(
  creatorId: string,
  viewerId: string
): Promise<{
  creatorId: string;
  isFollowing: boolean;
  followersCount: number;
} | null> {
  return withNeonSchemaRecovery(async () => {
    await ensureViewerRowInDb(viewerId);
    const sql = getNeonSql();

    const rows = (await sql`
      WITH del AS (
        DELETE FROM creator_follows
        WHERE follower_id = ${viewerId} AND creator_id = ${creatorId}
        RETURNING 1
      ),
      ins AS (
        INSERT INTO creator_follows (follower_id, creator_id)
        SELECT ${viewerId}, u.id
        FROM users u
        WHERE u.id = ${creatorId} AND u.id <> ${viewerId} AND NOT EXISTS (SELECT 1 FROM del)
        ON CONFLICT DO NOTHING
        RETURNING 1
      ),
      upd AS (
        UPDATE users
        SET followers_count = GREATEST(
          0,
          followers_count + CASE
            WHEN EXISTS (SELECT 1 FROM ins) THEN 1
            WHEN EXISTS (SELECT 1 FROM del) THEN -1
            ELSE 0
          END
        )
        WHERE id = ${creatorId}
        RETURNING followers_count
      )
      SELECT upd.followers_count, EXISTS (SELECT 1 FROM ins) AS is_following
      FROM upd
    `) as unknown as Array<{ followers_count: number; is_following: boolean }>;

    if (rows.length === 0) return null;

    invalidateCatalogCaches();
    return {
      creatorId,
      isFollowing: Boolean(rows[0].is_following),
      followersCount: Number(rows[0].followers_count ?? 0),
    };
  });
}

export async function createCategory(
  payload: AdminCategoryPayload
): Promise<{ category?: CategoryWithCount; errors?: Record<string, string> }> {
  const validation = validateCategoryPayload(payload);
  if (!validation.valid) {
    return { errors: validation.errors };
  }

  return withNeonSchemaRecovery<{
    category?: CategoryWithCount;
    errors?: Record<string, string>;
  }>(async () => {
    const sql = getNeonSql();
    const { name, slug, description } = validation.normalized;
    const id = `cat-${crypto.randomUUID().slice(0, 8)}`;

    const conflict = (await sql`
      SELECT id, name, slug FROM categories
      WHERE LOWER(name) = LOWER(${name}) OR LOWER(slug) = LOWER(${slug})
      LIMIT 1
    `) as unknown as Array<{ id: string; name: string; slug: string }>;

    if (conflict.length > 0) {
      const errors: Record<string, string> =
        conflict[0].slug.toLowerCase() === slug.toLowerCase()
          ? { slug: 'A category with this slug already exists.' }
          : { name: 'A category with this name already exists.' };
      return { errors };
    }

    await sql`
      INSERT INTO categories (id, name, slug, description)
      VALUES (${id}, ${name}, ${slug}, ${description})
    `;

    invalidateCategoryCaches();
    return { category: { id, name, slug, description, videoCount: 0 } };
  });
}

export async function updateCategory(
  categoryId: string,
  payload: AdminCategoryPayload
): Promise<{
  category?: CategoryWithCount;
  errors?: Record<string, string>;
  notFound?: boolean;
}> {
  const validation = validateCategoryPayload(payload);
  if (!validation.valid) {
    return { errors: validation.errors };
  }

  return withNeonSchemaRecovery<{
    category?: CategoryWithCount;
    errors?: Record<string, string>;
    notFound?: boolean;
  }>(async () => {
    const sql = getNeonSql();
    const { name, slug, description } = validation.normalized;

    const [existing, conflict] = await Promise.all([
      sql`SELECT id FROM categories WHERE id = ${categoryId} LIMIT 1`,
      sql`
        SELECT id, name, slug FROM categories
        WHERE id <> ${categoryId}
          AND (LOWER(name) = LOWER(${name}) OR LOWER(slug) = LOWER(${slug}))
        LIMIT 1
      `,
    ]);

    if (existing.length === 0) {
      return { notFound: true };
    }

    const conflictRows = conflict as unknown as Array<{
      id: string;
      name: string;
      slug: string;
    }>;
    if (conflictRows.length > 0) {
      const errors: Record<string, string> =
        conflictRows[0].slug.toLowerCase() === slug.toLowerCase()
          ? { slug: 'Another category already uses this slug.' }
          : { name: 'Another category already uses this name.' };
      return { errors };
    }

    const [, countRows] = await Promise.all([
      sql`
        UPDATE categories
        SET name = ${name}, slug = ${slug}, description = ${description}
        WHERE id = ${categoryId}
      `,
      sql`SELECT COUNT(*)::int AS cnt FROM videos WHERE category_id = ${categoryId}`,
    ]);

    invalidateCategoryCaches();
    return {
      category: {
        id: categoryId,
        name,
        slug,
        description,
        videoCount: Number((countRows as unknown as Array<{ cnt: number }>)[0]?.cnt ?? 0),
      },
    };
  });
}

export async function deleteCategory(
  categoryId: string
): Promise<{ deleted: boolean; notFound?: boolean; error?: string }> {
  return withNeonSchemaRecovery(async () => {
    const sql = getNeonSql();

    const checkRows = (await sql`
      SELECT c.id, COUNT(v.id)::int AS cnt
      FROM categories c
      LEFT JOIN videos v ON v.category_id = c.id
      WHERE c.id = ${categoryId}
      GROUP BY c.id
    `) as unknown as Array<{ id: string; cnt: number }>;

    if (checkRows.length === 0) {
      return { deleted: false, notFound: true };
    }

    const count = Number(checkRows[0].cnt ?? 0);
    if (count > 0) {
      return {
        deleted: false,
        error: `Cannot delete this category while ${count} ${count === 1 ? 'video is' : 'videos are'} assigned to it. Reassign those videos first.`,
      };
    }

    await sql`DELETE FROM categories WHERE id = ${categoryId}`;
    invalidateCategoryCaches();
    return { deleted: true };
  });
}
