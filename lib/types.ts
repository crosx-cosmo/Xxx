export interface User {
  id: string;
  name: string;
  username: string;
  email: string;
  avatarUrl: string | null;
  bio: string;
  credentials: string;
  isEducator: boolean;
  followersCount: number;
  createdAt: string;
}

export type AuthProviderKind = 'neon-auth' | 'neon-postgres' | 'unconfigured';

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  email: string;
  avatarUrl: string | null;
  isEducator: boolean;
  isAdmin: boolean;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
}

export interface CategoryWithCount extends Category {
  videoCount: number;
}

export interface AdminCategoryPayload {
  name: string;
  slug?: string;
  description?: string;
}

export interface VideoChapter {
  id: string;
  videoId: string;
  timestampSeconds: number;
  title: string;
  summary?: string;
}

export interface Video {
  id: string;
  userId: string;
  categoryId: string;
  title: string;
  description: string;
  /** External destination URL of the original source video (no video file uploaded/stored). */
  videoUrl: string;
  thumbnailUrl: string;
  durationSeconds: number;
  reflectionPrompt: string;
  /** Optional 18+ content rating code (defaults to '18+' via resolveContentRating). */
  contentRating?: import('./content-rating').ContentRatingCode;
  views: number;
  likes: number;
  createdAt: string;
}

export interface VideoWithMeta extends Video {
  creator: User;
  category: Category;
  chapterCount: number;
  isBookmarked?: boolean;
  hasLiked?: boolean;
  watchProgressSeconds?: number;
}

export interface CommentItem {
  id: string;
  videoId: string;
  userId: string;
  parentId: string | null;
  content: string;
  isAnonymous: boolean;
  upvotes: number;
  createdAt: string;
  author: Pick<User, 'id' | 'name' | 'username' | 'avatarUrl' | 'isEducator'>;
  hasUpvoted?: boolean;
}

export interface CommentNode extends CommentItem {
  replies: CommentNode[];
}

export interface AdminCommentItem extends CommentItem {
  videoTitle: string;
}

export interface WatchHistoryEntry {
  videoId: string;
  progressSeconds: number;
  watchedAt: string;
  video: VideoWithMeta;
}

export interface VideoDetail extends VideoWithMeta {
  chapters: VideoChapter[];
  comments: CommentItem[];
  isFollowingCreator: boolean;
  relatedVideos: VideoWithMeta[];
  reactions?: import('./video-reactions').VideoReactionState;
  ratingSummary?: import('./video-ratings').VideoRatingSummary;
}

export interface UploadChapterInput {
  timestamp: string;
  title: string;
}

export interface AdminVideoLinkPayload {
  title: string;
  description: string;
  categoryId?: string;
  categoryName?: string;
  userId?: string;
  educatorName?: string;
  videoUrl: string;
  thumbnailUrl: string;
  durationSeconds: number;
  reflectionPrompt: string;
  chapters: UploadChapterInput[];
}

/** Alias kept for backwards compatibility */
export type UploadVideoPayload = AdminVideoLinkPayload;

export interface AdminDashboardStats {
  totalVideos: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
}
