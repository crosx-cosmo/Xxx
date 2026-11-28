import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOptimisticVideoRating,
  calculateRatingMetricsFromDistribution,
  createEmptyRatingDistribution,
  createEmptyVideoRatingSummary,
  getStarDistributionPercentage,
  getStarRatingLabel,
  isValidStarRating,
  MAX_RATING_FEEDBACK_LENGTH,
  normalizeVideoRatingSummary,
  sanitizeRatingFeedback,
} from './video-ratings';

test('isValidStarRating validates integer ratings from 1 to 5', () => {
  assert.equal(isValidStarRating(1), true);
  assert.equal(isValidStarRating(3), true);
  assert.equal(isValidStarRating(5), true);
  assert.equal(isValidStarRating(0), false);
  assert.equal(isValidStarRating(6), false);
  assert.equal(isValidStarRating(4.5), false);
  assert.equal(isValidStarRating('5'), false);
  assert.equal(isValidStarRating(null), false);
});

test('getStarRatingLabel returns descriptive tier label for valid stars', () => {
  assert.equal(getStarRatingLabel(5), 'Masterpiece');
  assert.equal(getStarRatingLabel(4), 'Exceptional');
  assert.equal(getStarRatingLabel(1), 'Needs Work');
  assert.equal(getStarRatingLabel(null), 'Select a Star Rating');
});

test('sanitizeRatingFeedback strips control characters, trims, and caps at 500 chars', () => {
  assert.equal(sanitizeRatingFeedback('  Stunning 4K lighting!\u0000\u0007  '), 'Stunning 4K lighting!');
  const longText = 'A'.repeat(620);
  assert.equal(sanitizeRatingFeedback(longText).length, MAX_RATING_FEEDBACK_LENGTH);
  assert.equal(sanitizeRatingFeedback(null), '');
});

test('calculateRatingMetricsFromDistribution computes accurate average and total', () => {
  const empty = createEmptyRatingDistribution();
  assert.deepEqual(calculateRatingMetricsFromDistribution(empty), {
    averageRating: 0,
    totalRatings: 0,
  });

  const dist = {
    1: 1,
    2: 0,
    3: 2,
    4: 3,
    5: 14,
  };
  // sum = 1 + 6 + 12 + 70 = 89, total = 20 -> 4.45 -> 4.5
  const metrics = calculateRatingMetricsFromDistribution(dist);
  assert.equal(metrics.totalRatings, 20);
  assert.equal(metrics.averageRating, 4.5);
  assert.equal(getStarDistributionPercentage(dist, 5, 20), 70);
  assert.equal(getStarDistributionPercentage(dist, 4, 20), 15);
});

test('applyOptimisticVideoRating increments new rating and replaces existing viewer rating cleanly', () => {
  const initial = createEmptyVideoRatingSummary(true);

  const afterFirst = applyOptimisticVideoRating(
    initial,
    5,
    'Ultra crisp cinematography and sound design.'
  );
  assert.equal(afterFirst.totalRatings, 1);
  assert.equal(afterFirst.averageRating, 5);
  assert.equal(afterFirst.viewerRating, 5);
  assert.equal(afterFirst.distribution[5], 1);
  assert.equal(afterFirst.recentReviews.length, 1);
  assert.equal(afterFirst.recentReviews[0].rating, 5);

  const afterChange = applyOptimisticVideoRating(
    afterFirst,
    4,
    'Updated note after full watch.'
  );
  assert.equal(afterChange.totalRatings, 1);
  assert.equal(afterChange.averageRating, 4);
  assert.equal(afterChange.viewerRating, 4);
  assert.equal(afterChange.distribution[5], 0);
  assert.equal(afterChange.distribution[4], 1);
  assert.equal(afterChange.viewerFeedback, 'Updated note after full watch.');
});

test('normalizeVideoRatingSummary clamps negative or malformed numbers safely', () => {
  const normalized = normalizeVideoRatingSummary({
    distribution: {
      1: -4,
      2: 0,
      3: 2.9,
      4: 4,
      5: 6,
    },
    viewerRating: 5,
    viewerFeedback: '  Great pacing ',
    isAuthenticated: true,
  });

  assert.equal(normalized.distribution[1], 0);
  assert.equal(normalized.distribution[3], 2);
  assert.equal(normalized.totalRatings, 12);
  assert.equal(normalized.viewerRating, 5);
  assert.equal(normalized.viewerFeedback, 'Great pacing');
});
