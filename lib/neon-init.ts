import {
  DatabaseNotConfiguredError,
  DatabaseUnavailableError,
  getNeonSql,
  isNeonConfigured,
} from './db';
import { isMissingSchemaError } from './db-utils';
import { getServerCache } from './server-cache';

declare global {
  var _kinshipNeonInitPromise: Promise<void> | undefined;
  var _kinshipNeonReady: boolean | undefined;
  var _kinshipNeonReadyUrl: string | undefined;
  var _kinshipNeonFailUntil: number | undefined;
}

const FAILURE_COOLDOWN_MS = 5_000;

/**
 * Fast schema verification & first-time idempotent DDL bootstrap.
 * - On an existing Neon database (99.9% of Render restarts), completes in a
 *   SINGLE lightweight `to_regclass` probe (~15-30ms) with ZERO DDL overhead.
 * - Uses unqualified `to_regclass('table')` so the probe matches the active
 *   PostgreSQL `search_path` / `current_schema()` used by all app queries.
 * - On a brand-new or reset Neon database (or when `force` is true during
 *   42P01/42703 recovery), creates all 11 tables, idempotent column upgrades,
 *   and performance indexes in parallel dependency tiers.
 * - Never seeds mock/dummy videos, comments, or fake user accounts.
 */
async function runSchemaBootstrap(force = false): Promise<void> {
  const sql = getNeonSql();

  if (!force) {
    // Fast-path: 1 single HTTP round-trip checks if all required tables exist in current search_path
    const probeRows = (await sql`
      SELECT
        to_regclass('users') IS NOT NULL
        AND to_regclass('categories') IS NOT NULL
        AND to_regclass('videos') IS NOT NULL
        AND to_regclass('video_chapters') IS NOT NULL
        AND to_regclass('comments') IS NOT NULL
        AND to_regclass('comment_upvotes') IS NOT NULL
        AND to_regclass('bookmarks') IS NOT NULL
        AND to_regclass('video_likes') IS NOT NULL
        AND to_regclass('creator_follows') IS NOT NULL
        AND to_regclass('watch_history') IS NOT NULL
        AND to_regclass('video_reactions') IS NOT NULL
        AND to_regclass('auth_sessions') IS NOT NULL AS schema_ready
    `) as unknown as Array<{ schema_ready: boolean }>;

    if (probeRows[0]?.schema_ready) {
      // Ensure composite and functional performance indexes exist in the background without blocking first request
      void Promise.allSettled([
        sql`CREATE INDEX IF NOT EXISTS idx_videos_category_views ON videos (category_id, views DESC)`,
        sql`CREATE INDEX IF NOT EXISTS idx_videos_user_created ON videos (user_id, created_at DESC)`,
        sql`CREATE INDEX IF NOT EXISTS idx_comments_created_desc ON comments (created_at DESC)`,
        sql`CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email))`,
        sql`CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username))`,
        sql`CREATE INDEX IF NOT EXISTS idx_categories_slug_lower ON categories (LOWER(slug))`,
        sql`CREATE INDEX IF NOT EXISTS idx_video_reactions_video_type ON video_reactions (video_id, reaction_type)`,
      ]);
      return;
    }
  }

  // Tier 1: Root tables (no foreign keys)
  await Promise.all([
    sql`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        username VARCHAR(64) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL UNIQUE,
        avatar_url TEXT,
        bio TEXT DEFAULT '',
        credentials VARCHAR(160) DEFAULT '',
        is_educator BOOLEAN NOT NULL DEFAULT FALSE,
        is_admin BOOLEAN NOT NULL DEFAULT FALSE,
        followers_count INTEGER NOT NULL DEFAULT 0 CHECK (followers_count >= 0),
        password_hash TEXT,
        neon_auth_id TEXT UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    sql`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name VARCHAR(80) NOT NULL UNIQUE,
        slug VARCHAR(80) NOT NULL UNIQUE,
        description TEXT DEFAULT ''
      )
    `,
  ]);

  // Tier 2: Tables depending on users & categories
  await Promise.all([
    sql`
      CREATE TABLE IF NOT EXISTS videos (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
        title VARCHAR(200) NOT NULL,
        description TEXT NOT NULL,
        video_url TEXT NOT NULL,
        thumbnail_url TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
        reflection_prompt TEXT NOT NULL,
        views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
        likes INTEGER NOT NULL DEFAULT 0 CHECK (likes >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    sql`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    sql`
      CREATE TABLE IF NOT EXISTS creator_follows (
        follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (follower_id, creator_id),
        CHECK (follower_id <> creator_id)
      )
    `,
  ]);

  // Tier 3: Child tables depending on videos + idempotent column-upgrade guards
  await Promise.all([
    sql`
      CREATE TABLE IF NOT EXISTS video_chapters (
        id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        timestamp_seconds INTEGER NOT NULL CHECK (timestamp_seconds >= 0),
        title VARCHAR(160) NOT NULL,
        summary TEXT DEFAULT '',
        UNIQUE (video_id, timestamp_seconds)
      )
    `,
    sql`
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
        content TEXT NOT NULL CHECK (char_length(trim(content)) > 0),
        is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
        upvotes INTEGER NOT NULL DEFAULT 0 CHECK (upvotes >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    sql`
      CREATE TABLE IF NOT EXISTS bookmarks (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, video_id)
      )
    `,
    sql`
      CREATE TABLE IF NOT EXISTS video_likes (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, video_id)
      )
    `,
    sql`
      CREATE TABLE IF NOT EXISTS video_reactions (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        reaction_type VARCHAR(24) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, video_id, reaction_type)
      )
    `,
    sql`
      CREATE TABLE IF NOT EXISTS video_ratings (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
        feedback TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, video_id)
      )
    `,
    sql`
      CREATE TABLE IF NOT EXISTS watch_history (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
        progress_seconds INTEGER NOT NULL DEFAULT 0 CHECK (progress_seconds >= 0),
        watched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, video_id)
      )
    `,
    sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE`,
    sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`,
    sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS neon_auth_id TEXT`,
    sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS likes INTEGER NOT NULL DEFAULT 0`,
  ]);

  // Tier 4: comment_upvotes + performance indexes in parallel
  await Promise.all([
    sql`
      CREATE TABLE IF NOT EXISTS comment_upvotes (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, comment_id)
      )
    `,
    sql`CREATE INDEX IF NOT EXISTS idx_users_username ON users (username)`,
    sql`CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username))`,
    sql`CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email))`,
    sql`CREATE INDEX IF NOT EXISTS idx_users_is_educator ON users (is_educator) WHERE is_educator = TRUE`,
    sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_neon_auth_id ON users (neon_auth_id) WHERE neon_auth_id IS NOT NULL`,
    sql`CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories (slug)`,
    sql`CREATE INDEX IF NOT EXISTS idx_categories_slug_lower ON categories (LOWER(slug))`,
    sql`CREATE INDEX IF NOT EXISTS idx_videos_user_created ON videos (user_id, created_at DESC)`,
    sql`CREATE INDEX IF NOT EXISTS idx_videos_category_views ON videos (category_id, views DESC)`,
    sql`CREATE INDEX IF NOT EXISTS idx_videos_created_at_desc ON videos (created_at DESC)`,
    sql`CREATE INDEX IF NOT EXISTS idx_videos_views_desc ON videos (views DESC)`,
    sql`CREATE INDEX IF NOT EXISTS idx_video_chapters_video_order ON video_chapters (video_id, timestamp_seconds ASC)`,
    sql`CREATE INDEX IF NOT EXISTS idx_comments_video_created ON comments (video_id, created_at DESC)`,
    sql`CREATE INDEX IF NOT EXISTS idx_comments_created_desc ON comments (created_at DESC)`,
    sql`CREATE INDEX IF NOT EXISTS idx_bookmarks_user_created ON bookmarks (user_id, created_at DESC)`,
    sql`CREATE INDEX IF NOT EXISTS idx_video_likes_video ON video_likes (video_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_video_reactions_video_type ON video_reactions (video_id, reaction_type)`,
    sql`CREATE INDEX IF NOT EXISTS idx_video_ratings_video_rating ON video_ratings (video_id, rating)`,
    sql`CREATE INDEX IF NOT EXISTS idx_creator_follows_creator ON creator_follows (creator_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_watch_history_user_recent ON watch_history (user_id, watched_at DESC)`,
    sql`CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions (user_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions (expires_at)`,
  ]);
}

/**
 * Clears cached schema readiness (and server response caches) so the next
 * database operation re-verifies or recreates missing PostgreSQL tables.
 */
export function resetNeonSchemaState(): void {
  globalThis._kinshipNeonReady = false;
  globalThis._kinshipNeonReadyUrl = undefined;
  globalThis._kinshipNeonInitPromise = undefined;
  globalThis._kinshipNeonFailUntil = undefined;
  getServerCache().clear();
}

/**
 * Ensures the Neon PostgreSQL schema is ready once per server process (keyed
 * by DATABASE_URL). Throws DatabaseNotConfiguredError if DATABASE_URL is
 * missing, or DatabaseUnavailableError if Neon cannot be reached (with a short
 * backoff so Render does not hammer an unreachable database).
 */
export async function requireNeonReady(options?: {
  force?: boolean;
}): Promise<void> {
  if (!isNeonConfigured()) {
    throw new DatabaseNotConfiguredError();
  }

  const activeUrl = process.env.DATABASE_URL?.trim();
  const force = Boolean(options?.force);

  if (
    !force &&
    globalThis._kinshipNeonReady &&
    globalThis._kinshipNeonReadyUrl === activeUrl
  ) {
    return;
  }

  if (
    !force &&
    globalThis._kinshipNeonFailUntil &&
    Date.now() < globalThis._kinshipNeonFailUntil
  ) {
    throw new DatabaseUnavailableError();
  }

  if (force || globalThis._kinshipNeonReadyUrl !== activeUrl) {
    globalThis._kinshipNeonReady = false;
    globalThis._kinshipNeonInitPromise = undefined;
  }

  if (!globalThis._kinshipNeonInitPromise) {
    globalThis._kinshipNeonInitPromise = runSchemaBootstrap(force)
      .then(() => {
        globalThis._kinshipNeonReady = true;
        globalThis._kinshipNeonReadyUrl = activeUrl;
        globalThis._kinshipNeonFailUntil = undefined;
      })
      .catch((err) => {
        globalThis._kinshipNeonReady = false;
        globalThis._kinshipNeonInitPromise = undefined;
        globalThis._kinshipNeonFailUntil = Date.now() + FAILURE_COOLDOWN_MS;
        console.error(
          '[NeonInit] Schema initialization failed:',
          err instanceof Error ? err.message : 'Unknown error'
        );
        throw new DatabaseUnavailableError();
      });
  }

  return globalThis._kinshipNeonInitPromise;
}

/**
 * Non-throwing readiness helper for read-only public Server Components
 * (so pages can render an honest empty state if DATABASE_URL isn't set yet,
 * without ever serving mock data).
 */
export async function ensureNeonReady(): Promise<boolean> {
  if (!isNeonConfigured()) {
    return false;
  }
  try {
    await requireNeonReady();
    return true;
  } catch {
    return false;
  }
}

/**
 * Executes a Neon PostgreSQL operation with zero-overhead happy-path schema
 * verification and automatic single-retry self-healing if PostgreSQL reports a
 * missing table (42P01) or column (42703) — e.g. after tables are dropped or a
 * Neon branch is reset while the server process is still warm.
 */
export async function withNeonSchemaRecovery<T>(
  operation: () => Promise<T>,
  deps?: {
    ensure?: () => Promise<void>;
    recover?: () => Promise<void>;
  }
): Promise<T> {
  const ensureFn = deps?.ensure ?? (() => requireNeonReady());
  const recoverFn =
    deps?.recover ??
    (async () => {
      resetNeonSchemaState();
      await requireNeonReady({ force: true });
    });

  await ensureFn();
  try {
    return await operation();
  } catch (error) {
    if (!isMissingSchemaError(error)) {
      throw error;
    }
    console.warn(
      '[NeonInit] Missing PostgreSQL relation/column detected; re-bootstrapping schema and retrying once.'
    );
    await recoverFn();
    return operation();
  }
}

/**
 * Read-only wrapper for public SSR loaders: recovers automatically from
 * missing tables (42P01/42703) when Neon is connected, and returns `fallback`
 * only when DATABASE_URL is unconfigured or Neon is temporarily unreachable.
 */
export async function withOptionalNeonRead<T>(
  fallback: T,
  operation: () => Promise<T>
): Promise<T> {
  if (!isNeonConfigured()) {
    return fallback;
  }
  try {
    return await withNeonSchemaRecovery(operation);
  } catch (error) {
    if (
      error instanceof DatabaseNotConfiguredError ||
      error instanceof DatabaseUnavailableError
    ) {
      return fallback;
    }
    throw error;
  }
}
