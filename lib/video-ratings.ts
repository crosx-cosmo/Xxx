export const VIDEO_RATING_STARS = [1, 2, 3, 4, 5] as const;

export type VideoRatingStar = (typeof VIDEO_RATING_STARS)[number];

export type VideoRatingDistribution = Record<VideoRatingStar, number>;

export const MAX_RATING_FEEDBACK_LENGTH = 500;

export interface VideoRatingReviewItem {
  userId: string;
  authorName: string;
  rating: VideoRatingStar;
  feedback: string;
  updatedAt: string;
}

export interface VideoRatingSummary {
  averageRating: number;
  totalRatings: number;
  distribution: VideoRatingDistribution;
  viewerRating: VideoRatingStar | null;
  viewerFeedback: string;
  isAuthenticated: boolean;
  recentReviews: VideoRatingReviewItem[];
}

export const STAR_RATING_LABELS: Record<VideoRatingStar, string> = {
  1: 'Needs Work',
  2: 'Fair',
  3: 'Good',
  4: 'Exceptional',
  5: 'Masterpiece',
};

export function isValidStarRating(value: unknown): value is VideoRatingStar {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 5
  );
}

export function getStarRatingLabel(rating: number | null | undefined): string {
  if (!isValidStarRating(rating)) {
    return 'Select a Star Rating';
  }
  return STAR_RATING_LABELS[rating];
}

export function sanitizeRatingFeedback(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, MAX_RATING_FEEDBACK_LENGTH);
}

export function createEmptyRatingDistribution(): VideoRatingDistribution {
  return {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };
}

export function createEmptyVideoRatingSummary(isAuthenticated = false): VideoRatingSummary {
  return {
    averageRating: 0,
    totalRatings: 0,
    distribution: createEmptyRatingDistribution(),
    viewerRating: null,
    viewerFeedback: '',
    isAuthenticated,
    recentReviews: [],
  };
}

export function calculateRatingMetricsFromDistribution(
  distribution: VideoRatingDistribution
): { averageRating: number; totalRatings: number } {
  let totalRatings = 0;
  let weightedSum = 0;

  for (const star of VIDEO_RATING_STARS) {
    const rawCount = Number(distribution[star]);
    const safeCount = Number.isFinite(rawCount) && rawCount > 0 ? Math.floor(rawCount) : 0;
    totalRatings += safeCount;
    weightedSum += star * safeCount;
  }

  if (totalRatings === 0) {
    return { averageRating: 0, totalRatings: 0 };
  }

  const averageRating = Math.round((weightedSum / totalRatings) * 10) / 10;
  return { averageRating, totalRatings };
}

export function getStarDistributionPercentage(
  distribution: VideoRatingDistribution,
  star: VideoRatingStar,
  totalRatings?: number
): number {
  const computedTotal =
    typeof totalRatings === 'number' && totalRatings >= 0
      ? totalRatings
      : calculateRatingMetricsFromDistribution(distribution).totalRatings;
  if (computedTotal <= 0) return 0;
  const count = Math.max(0, Math.floor(Number(distribution[star]) || 0));
  return Math.min(100, Math.round((count / computedTotal) * 100));
}

export function normalizeVideoRatingSummary(
  input?: Partial<VideoRatingSummary> | null
): VideoRatingSummary {
  const distribution = createEmptyRatingDistribution();

  if (input?.distribution && typeof input.distribution === 'object') {
    for (const star of VIDEO_RATING_STARS) {
      const raw = Number((input.distribution as Record<number, unknown>)[star]);
      distribution[star] =
        Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    }
  }

  const { averageRating, totalRatings } =
    calculateRatingMetricsFromDistribution(distribution);

  const viewerRating = isValidStarRating(input?.viewerRating)
    ? input.viewerRating
    : null;
  const viewerFeedback = sanitizeRatingFeedback(input?.viewerFeedback);
  const isAuthenticated = Boolean(input?.isAuthenticated);

  const recentReviews: VideoRatingReviewItem[] = Array.isArray(input?.recentReviews)
    ? input.recentReviews
        .filter((item): item is VideoRatingReviewItem =>
          Boolean(item && isValidStarRating(item.rating))
        )
        .slice(0, 6)
        .map((item) => ({
          userId: String(item.userId || 'member'),
          authorName: String(item.authorName || 'Verified Member').slice(0, 48),
          rating: item.rating,
          feedback: sanitizeRatingFeedback(item.feedback),
          updatedAt: String(item.updatedAt || new Date().toISOString()),
        }))
    : [];

  return {
    averageRating,
    totalRatings,
    distribution,
    viewerRating,
    viewerFeedback,
    isAuthenticated,
    recentReviews,
  };
}

export function applyOptimisticVideoRating(
  currentInput: Partial<VideoRatingSummary> | null | undefined,
  nextRating: VideoRatingStar,
  nextFeedbackInput = '',
  authorName = 'You (Verified Member)'
): VideoRatingSummary {
  const current = normalizeVideoRatingSummary(currentInput);
  if (!isValidStarRating(nextRating)) {
    return current;
  }

  const nextDistribution: VideoRatingDistribution = {
    ...current.distribution,
  };

  if (current.viewerRating && isValidStarRating(current.viewerRating)) {
    nextDistribution[current.viewerRating] = Math.max(
      0,
      nextDistribution[current.viewerRating] - 1
    );
  }

  nextDistribution[nextRating] = (nextDistribution[nextRating] || 0) + 1;

  const { averageRating, totalRatings } =
    calculateRatingMetricsFromDistribution(nextDistribution);
  const viewerFeedback = sanitizeRatingFeedback(nextFeedbackInput);

  let recentReviews = current.recentReviews.filter(
    (review) => review.userId !== 'viewer-self'
  );

  if (viewerFeedback.length > 0) {
    recentReviews = [
      {
        userId: 'viewer-self',
        authorName,
        rating: nextRating,
        feedback: viewerFeedback,
        updatedAt: new Date().toISOString(),
      },
      ...recentReviews,
    ].slice(0, 6);
  }

  return {
    averageRating,
    totalRatings,
    distribution: nextDistribution,
    viewerRating: nextRating,
    viewerFeedback,
    isAuthenticated: true,
    recentReviews,
  };
}
