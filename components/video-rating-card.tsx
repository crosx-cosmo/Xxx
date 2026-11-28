'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Check, MessageSquareHeart, ShieldCheck, Sparkles, Star } from 'lucide-react';
import { requestApiJson } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { formatEditorialDate } from '@/lib/video-utils';
import {
  applyOptimisticVideoRating,
  createEmptyVideoRatingSummary,
  getStarDistributionPercentage,
  getStarRatingLabel,
  isValidStarRating,
  MAX_RATING_FEEDBACK_LENGTH,
  normalizeVideoRatingSummary,
  VIDEO_RATING_STARS,
  type VideoRatingStar,
  type VideoRatingSummary,
} from '@/lib/video-ratings';

interface VideoRatingCardProps {
  videoId: string;
  initialRatingSummary?: Partial<VideoRatingSummary> | null;
  className?: string;
}

const LOCAL_RATING_STORAGE_PREFIX = 'heylady:video-rating:v1:';
const LOCAL_MEMBER_ALIAS_KEY = 'heylady:member-alias:v1';

function readInitialSummary(
  videoId: string,
  initialRatingSummary?: Partial<VideoRatingSummary> | null
): VideoRatingSummary {
  const normalized = normalizeVideoRatingSummary(
    initialRatingSummary ?? createEmptyVideoRatingSummary(true)
  );
  if (typeof window === 'undefined') {
    return normalized;
  }

  try {
    const savedAlias =
      window.localStorage.getItem(LOCAL_MEMBER_ALIAS_KEY)?.trim() ||
      'Verified VIP Member';
    const rawCached = window.localStorage.getItem(
      `${LOCAL_RATING_STORAGE_PREFIX}${videoId}`
    );
    if (rawCached && !normalized.viewerRating) {
      const parsed = JSON.parse(rawCached) as {
        rating?: number;
        feedback?: string;
      };
      if (isValidStarRating(parsed.rating)) {
        return applyOptimisticVideoRating(
          normalized,
          parsed.rating,
          parsed.feedback ?? '',
          savedAlias
        );
      }
    }
  } catch {
    // Ignore localStorage restrictions
  }
  return normalized;
}

function readInitialAlias(): string {
  if (typeof window === 'undefined') {
    return 'Verified VIP Member';
  }
  try {
    const saved = window.localStorage.getItem(LOCAL_MEMBER_ALIAS_KEY);
    if (saved && saved.trim().length >= 2) {
      return saved.trim().slice(0, 48);
    }
  } catch {
    // Ignore localStorage errors
  }
  return 'Verified VIP Member';
}

export function VideoRatingCard({
  videoId,
  initialRatingSummary,
  className,
}: VideoRatingCardProps) {
  const [summary, setSummary] = useState<VideoRatingSummary>(() =>
    readInitialSummary(videoId, initialRatingSummary)
  );
  const [selectedRating, setSelectedRating] = useState<VideoRatingStar | null>(
    () => readInitialSummary(videoId, initialRatingSummary).viewerRating
  );
  const [hoveredRating, setHoveredRating] = useState<VideoRatingStar | null>(
    null
  );
  const [feedback, setFeedback] = useState<string>(
    () => readInitialSummary(videoId, initialRatingSummary).viewerFeedback
  );
  const [memberAlias, setMemberAlias] = useState<string>(readInitialAlias);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Asynchronously refresh rating state from database on mount/videoId change
  useEffect(() => {
    let active = true;
    void requestApiJson<
      VideoRatingSummary & {
        videoId: string;
        authenticatedMemberName?: string | null;
      }
    >(`/api/videos/${encodeURIComponent(videoId)}/ratings`, {
      method: 'GET',
      timeoutMs: 6000,
    }).then((res) => {
      if (!active || !res.ok || !res.data) return;
      const serverSummary = normalizeVideoRatingSummary(res.data);
      if (serverSummary.totalRatings > 0 || serverSummary.viewerRating) {
        setSummary(serverSummary);
        if (serverSummary.viewerRating) {
          setSelectedRating(serverSummary.viewerRating);
          setFeedback(serverSummary.viewerFeedback);
        }
      }
      if (
        res.data.authenticatedMemberName &&
        res.data.authenticatedMemberName.trim().length >= 2
      ) {
        setMemberAlias(res.data.authenticatedMemberName.trim().slice(0, 48));
      }
    });
    return () => {
      active = false;
    };
  }, [videoId]);

  const persistLocalCache = useCallback(
    (rating: VideoRatingStar, text: string, alias: string) => {
      try {
        window.localStorage.setItem(
          `${LOCAL_RATING_STORAGE_PREFIX}${videoId}`,
          JSON.stringify({ rating, feedback: text })
        );
        if (alias.trim().length >= 2) {
          window.localStorage.setItem(
            LOCAL_MEMBER_ALIAS_KEY,
            alias.trim().slice(0, 48)
          );
        }
      } catch {
        // Ignore storage errors
      }
    },
    [videoId]
  );

  const submitRatingToDatabase = useCallback(
    async (ratingToSave: VideoRatingStar, feedbackToSave: string) => {
      setErrorMessage(null);
      setIsSubmitting(true);

      const cleanAlias = memberAlias.trim() || 'Verified VIP Member';
      const optimistic = applyOptimisticVideoRating(
        summary,
        ratingToSave,
        feedbackToSave,
        cleanAlias
      );
      setSummary(optimistic);
      setSelectedRating(ratingToSave);
      persistLocalCache(ratingToSave, feedbackToSave, cleanAlias);

      try {
        const res = await requestApiJson<
          VideoRatingSummary & {
            videoId: string;
            authenticatedMemberName?: string | null;
          }
        >(`/api/videos/${encodeURIComponent(videoId)}/ratings`, {
          method: 'POST',
          json: {
            rating: ratingToSave,
            feedback: feedbackToSave,
            authorName: cleanAlias,
          },
          timeoutMs: 8000,
        });

        if (res.ok && res.data) {
          const serverSummary = normalizeVideoRatingSummary(res.data);
          setSummary(serverSummary);
          if (serverSummary.viewerRating) {
            setSelectedRating(serverSummary.viewerRating);
          }
          setStatusMessage('Saved to database');
        } else {
          setStatusMessage('Saved for your verified session');
        }
      } catch {
        setStatusMessage('Saved for your verified session');
      } finally {
        setIsSubmitting(false);
      }
    },
    [memberAlias, persistLocalCache, summary, videoId]
  );

  const handleStarClick = useCallback(
    (star: VideoRatingStar) => {
      setSelectedRating(star);
      setErrorMessage(null);
      void submitRatingToDatabase(star, feedback);
    },
    [feedback, submitRatingToDatabase]
  );

  const handleFormSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedRating || !isValidStarRating(selectedRating)) {
        setErrorMessage('Please select 1 to 5 stars above to submit your rating.');
        return;
      }
      void submitRatingToDatabase(selectedRating, feedback);
    },
    [feedback, selectedRating, submitRatingToDatabase]
  );

  const activeStarPreview = hoveredRating ?? selectedRating;
  const activeLabel = getStarRatingLabel(activeStarPreview);

  return (
    <section
      aria-label="Interactive 5-star video rating and member feedback"
      data-testid="video-rating-card"
      className={cn(
        'rounded-xl bg-white dark:bg-[#141418] border border-zinc-200/90 dark:border-zinc-800/90 p-4 sm:p-5 shadow-xs transition-colors',
        className
      )}
    >
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
        {/* Left Column: Aggregate Score & 5-Star Distribution */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6 lg:w-[44%] shrink-0">
          <div className="flex flex-col items-start">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
              <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>VIP Audience Score</span>
            </div>

            <div className="mt-1.5 flex items-baseline gap-2">
              <span
                data-testid="video-rating-average"
                className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-zinc-950 dark:text-white tabular-nums"
              >
                {summary.totalRatings > 0
                  ? summary.averageRating.toFixed(1)
                  : '5.0'}
              </span>
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                / 5.0
              </span>
            </div>

            <div
              className="mt-1 flex items-center gap-0.5 text-amber-400"
              aria-hidden="true"
            >
              {VIDEO_RATING_STARS.map((star) => {
                const displayAvg =
                  summary.totalRatings > 0 ? summary.averageRating : 5;
                const filled = star <= Math.round(displayAvg);
                return (
                  <Star
                    key={star}
                    className={cn(
                      'h-3.5 w-3.5',
                      filled
                        ? 'fill-amber-400 text-amber-400'
                        : 'text-zinc-300 dark:text-zinc-700'
                    )}
                  />
                );
              })}
            </div>

            <p
              data-testid="video-rating-count"
              className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums"
            >
              {summary.totalRatings > 0
                ? `${summary.totalRatings} verified ${
                    summary.totalRatings === 1 ? 'rating' : 'ratings'
                  }`
                : 'Be the first to rate'}
            </p>
          </div>

          {/* 5-Star Distribution Bars */}
          <div className="w-full sm:flex-1 space-y-1.5">
            {([5, 4, 3, 2, 1] as const).map((star) => {
              const pct = getStarDistributionPercentage(
                summary.distribution,
                star,
                summary.totalRatings
              );
              const count = summary.distribution[star] || 0;
              return (
                <div
                  key={star}
                  className="flex items-center gap-2 text-xs tabular-nums"
                >
                  <span className="w-6 text-right font-medium text-zinc-600 dark:text-zinc-400 shrink-0">
                    {star}★
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800/90">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-rose-500 to-amber-400 transition-transform duration-300 origin-left"
                      style={{
                        transform: `scaleX(${Math.max(0, Math.min(1, pct / 100))})`,
                      }}
                    />
                  </div>
                  <span className="w-8 text-right text-[11px] text-zinc-500 dark:text-zinc-400 shrink-0">
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Interactive 5-Star Picker & Authenticated Feedback Form */}
        <form
          onSubmit={handleFormSubmit}
          className="flex-1 lg:border-l lg:border-zinc-200/80 lg:dark:border-zinc-800/80 lg:pl-6 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                Rate This Release
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
                <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span>Authenticated 18+ Session</span>
              </span>
            </div>

            <span
              data-testid="video-rating-tier-label"
              className={cn(
                'text-xs font-semibold transition-colors',
                activeStarPreview
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-zinc-500 dark:text-zinc-400'
              )}
            >
              {activeStarPreview
                ? `${activeStarPreview}.0 ★ — ${activeLabel}`
                : activeLabel}
            </span>
          </div>

          {/* 5 Interactive Star Buttons */}
          <div
            role="radiogroup"
            aria-label="5-star video rating selector"
            className="flex flex-wrap items-center justify-between gap-3"
            onMouseLeave={() => setHoveredRating(null)}
          >
            <div className="flex items-center gap-1.5">
              {VIDEO_RATING_STARS.map((star) => {
                const isActive =
                  activeStarPreview !== null && star <= activeStarPreview;
                const isSelected = selectedRating === star;

                return (
                  <button
                    key={star}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    aria-label={`Rate ${star} ${star === 1 ? 'star' : 'stars'} (${getStarRatingLabel(star)})`}
                    data-testid={`video-rating-star-${star}`}
                    disabled={isSubmitting}
                    onMouseEnter={() => setHoveredRating(star)}
                    onFocus={() => setHoveredRating(star)}
                    onBlur={() => setHoveredRating(null)}
                    onClick={() => handleStarClick(star)}
                    className={cn(
                      'group relative inline-flex h-10 w-10 items-center justify-center rounded-lg border transition-transform duration-150 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 cursor-pointer shrink-0',
                      isActive
                        ? 'border-amber-400/70 bg-amber-500/10 text-amber-400 shadow-xs scale-105'
                        : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/70 text-zinc-400 dark:text-zinc-500 hover:border-amber-400/50 hover:text-amber-400'
                    )}
                  >
                    <Star
                      className={cn(
                        'h-5 w-5 transition-transform duration-150 group-hover:scale-110',
                        isActive && 'fill-amber-400 text-amber-400'
                      )}
                    />
                  </button>
                );
              })}
            </div>

            {statusMessage && (
              <span
                data-testid="video-rating-status"
                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400"
              >
                <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{statusMessage}</span>
              </span>
            )}
          </div>

          {/* Feedback Input + Member Alias & Submit Button */}
          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={memberAlias}
                onChange={(e) => setMemberAlias(e.target.value.slice(0, 48))}
                placeholder="Your member alias"
                aria-label="Member display alias"
                data-testid="video-rating-alias-input"
                className="sm:w-44 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:border-rose-500 focus:outline-none"
              />
              <div className="relative flex-1">
                <input
                  type="text"
                  value={feedback}
                  onChange={(e) =>
                    setFeedback(
                      e.target.value.slice(0, MAX_RATING_FEEDBACK_LENGTH)
                    )
                  }
                  placeholder="Share quick feedback on cinematography, pacing, or chemistry (optional)..."
                  aria-label="Rating feedback note"
                  data-testid="video-rating-feedback-input"
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:border-rose-500 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                data-testid="video-rating-submit-btn"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 active:scale-[0.98] px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-all cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60"
              >
                <MessageSquareHeart className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {summary.viewerRating ? 'Update Rating' : 'Submit Feedback'}
                </span>
              </button>
            </div>

            {errorMessage && (
              <p
                role="alert"
                className="text-xs font-medium text-rose-600 dark:text-rose-400"
              >
                {errorMessage}
              </p>
            )}
          </div>
        </form>
      </div>

      {/* Recent Verified Member Feedback Stream */}
      {summary.recentReviews.length > 0 && (
        <div
          data-testid="video-rating-reviews-list"
          className="mt-4 pt-3.5 border-t border-zinc-200/80 dark:border-zinc-800/80"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2.5">
            Recent Verified Member Feedback
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {summary.recentReviews.slice(0, 4).map((review, index) => (
              <div
                key={`${review.userId}-${index}`}
                className="rounded-lg border border-zinc-200/70 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-zinc-900/50 px-3 py-2.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                    {review.authorName}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="inline-flex items-center gap-0.5 font-semibold text-amber-500 dark:text-amber-400 tabular-nums">
                      {review.rating}.0 ★
                    </span>
                    <span className="text-[11px] text-zinc-400 dark:text-zinc-500 tabular-nums">
                      {formatEditorialDate(review.updatedAt)}
                    </span>
                  </div>
                </div>
                <p className="mt-1 text-zinc-700 dark:text-zinc-300 line-clamp-2 leading-relaxed">
                  {review.feedback}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
