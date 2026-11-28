import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAdminUser } from '@/lib/admin-auth';
import { mapApiError } from '@/lib/db-utils';
import {
  PRIVATE_NO_STORE_CACHE_CONTROL,
  RATE_LIMIT_TIERS,
  enforceRateLimit,
  isSecureRequest,
  parseJsonBody,
  verifySameOriginMutation,
} from '@/lib/http-utils';
import { getVideoRatingSummary, submitVideoRating } from '@/lib/repository';
import {
  isValidStarRating,
  sanitizeRatingFeedback,
} from '@/lib/video-ratings';
import {
  attachViewerCookie,
  getOptionalViewerId,
  resolveOrCreateViewerId,
} from '@/lib/viewer-session';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const limited = enforceRateLimit(
    request,
    RATE_LIMIT_TIERS.PUBLIC_READ,
    'video-ratings-get'
  );
  if (limited) return limited;

  try {
    const { id } = await context.params;
    const authUser = await getCurrentAdminUser().catch(() => null);
    const viewerId = authUser?.id ?? (await getOptionalViewerId());
    const summary = await getVideoRatingSummary(id, viewerId);

    return NextResponse.json(
      {
        videoId: id,
        ...summary,
        isAuthenticated: true,
        authenticatedMemberName: authUser?.name ?? null,
      },
      { headers: { 'Cache-Control': PRIVATE_NO_STORE_CACHE_CONTROL } }
    );
  } catch (error) {
    console.error('[GET /api/videos/[id]/ratings] Error:', error);
    const { status, message } = mapApiError(
      error,
      'Unable to load video ratings.'
    );
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const originError = verifySameOriginMutation(request);
  if (originError) return originError;

  const limited = enforceRateLimit(
    request,
    RATE_LIMIT_TIERS.WRITE_MUTATION,
    'video-ratings-post'
  );
  if (limited) return limited;

  const { data: body, errorResponse } = await parseJsonBody<{
    rating?: unknown;
    feedback?: unknown;
    authorName?: unknown;
  }>(request, 8192);
  if (errorResponse) return errorResponse;

  const numericRating = Number(body?.rating);
  if (!isValidStarRating(numericRating)) {
    return NextResponse.json(
      { error: 'Please select a star rating between 1 and 5.' },
      {
        status: 400,
        headers: { 'Cache-Control': PRIVATE_NO_STORE_CACHE_CONTROL },
      }
    );
  }

  const feedback = sanitizeRatingFeedback(body?.feedback);
  const authorName =
    typeof body?.authorName === 'string'
      ? body.authorName.trim().slice(0, 48)
      : '';

  try {
    const { id } = await context.params;
    const authUser = await getCurrentAdminUser().catch(() => null);
    const resolvedViewer = authUser
      ? { viewerId: authUser.id, isNew: false }
      : await resolveOrCreateViewerId();

    const result = await submitVideoRating({
      videoId: id,
      viewerId: resolvedViewer.viewerId,
      rating: numericRating,
      feedback,
      authorName: authUser?.name || authorName || 'Verified VIP Member',
    });

    if (!result) {
      return NextResponse.json(
        { error: 'Video not found.' },
        {
          status: 404,
          headers: { 'Cache-Control': PRIVATE_NO_STORE_CACHE_CONTROL },
        }
      );
    }

    const response = NextResponse.json(
      {
        ...result,
        isAuthenticated: true,
        authenticatedMemberName:
          authUser?.name || authorName || 'Verified VIP Member',
      },
      {
        headers: { 'Cache-Control': PRIVATE_NO_STORE_CACHE_CONTROL },
      }
    );

    if (resolvedViewer.isNew) {
      attachViewerCookie(
        response,
        resolvedViewer.viewerId,
        isSecureRequest(request)
      );
    }
    return response;
  } catch (error) {
    console.error('[POST /api/videos/[id]/ratings] Error:', error);
    const { status, message } = mapApiError(
      error,
      'Unable to save your rating right now.'
    );
    return NextResponse.json({ error: message }, { status });
  }
}
