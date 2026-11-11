// Player overlays that mimic where a short-video app puts its buttons and texts, so you can see what
// your video will look like in the feed (simplified drawings, no logos). Sizes use the frame width (cqw).
import {
  BatteryFull,
  Bookmark,
  Camera,
  Forward,
  Heart,
  MessageCircle,
  MoreHorizontal,
  MoreVertical,
  Music2,
  Plus,
  Repeat2,
  Search,
  Send,
  Signal,
  ThumbsDown,
  ThumbsUp,
  Wifi
} from 'lucide-react'

export type SocialView = 'none' | 'safe' | 'tiktok' | 'shorts' | 'reels'

export const SOCIAL_VIEWS: { id: SocialView; label: string }[] = [
  { id: 'tiktok', label: 'TikTok' },
  { id: 'shorts', label: 'YouTube Shorts' },
  { id: 'reels', label: 'Instagram Reels' },
  { id: 'safe', label: 'Safe zones only' }
]

function StatusBar(): React.JSX.Element {
  return (
    <div className="so-status">
      <span>9:41</span>
      <span className="so-status-icons">
        <Signal />
        <Wifi />
        <BatteryFull />
      </span>
    </div>
  )
}

function Action({ icon, count }: { icon: React.ReactNode; count?: string }): React.JSX.Element {
  return (
    <div className="so-action">
      {icon}
      {count && <span>{count}</span>}
    </div>
  )
}

function Avatar({ plus }: { plus?: boolean }): React.JSX.Element {
  return (
    <div className="so-avatar">
      {plus && (
        <span className="so-avatar-plus">
          <Plus />
        </span>
      )}
    </div>
  )
}

export default function SocialPreview({ view }: { view: SocialView }): React.JSX.Element | null {
  if (view === 'none' || view === 'safe') return null
  return (
    <div className={`social so-${view}`}>
      <div className="so-shade-top" />
      <div className="so-shade-bottom" />
      <StatusBar />
      {view === 'tiktok' && (
        <>
          <div className="so-top so-top-center">
            <span className="dim">Following</span>
            <span className="on">For You</span>
            <Search className="so-top-right" />
          </div>
          <div className="so-rail">
            <Avatar plus />
            <Action icon={<Heart fill="currentColor" />} count="2.8M" />
            <Action icon={<MessageCircle fill="currentColor" />} count="12.4K" />
            <Action icon={<Bookmark fill="currentColor" />} count="98K" />
            <Action icon={<Forward fill="currentColor" />} count="31K" />
            <div className="so-disc">
              <Music2 />
            </div>
          </div>
          <div className="so-bottom">
            <b>Your name</b>
            <p>Here is the description of your video #fyp</p>
            <span className="so-music">
              <Music2 /> Original sound · Your name
            </span>
          </div>
        </>
      )}
      {view === 'reels' && (
        <>
          <div className="so-top so-top-left">
            <b>Reels</b>
            <Camera className="so-top-right" />
          </div>
          <div className="so-rail">
            <Action icon={<Heart />} count="2.8M" />
            <Action icon={<MessageCircle />} count="12.4K" />
            <Action icon={<Send />} count="31K" />
            <Action icon={<MoreHorizontal />} />
            <div className="so-square" />
          </div>
          <div className="so-bottom">
            <span className="so-user">
              <Avatar /> <b>yourname</b> <span className="so-pill">Follow</span>
            </span>
            <p>Here is the description of your video…</p>
            <span className="so-music">
              <Music2 /> yourname · Original audio
            </span>
          </div>
        </>
      )}
      {view === 'shorts' && (
        <>
          <div className="so-top so-top-icons">
            <Search />
            <MoreVertical />
          </div>
          <div className="so-rail">
            <Action icon={<ThumbsUp fill="currentColor" />} count="2.8M" />
            <Action icon={<ThumbsDown fill="currentColor" />} count="Dislike" />
            <Action icon={<MessageCircle fill="currentColor" />} count="12K" />
            <Action icon={<Forward fill="currentColor" />} count="Share" />
            <Action icon={<Repeat2 />} count="Remix" />
            <div className="so-square" />
          </div>
          <div className="so-bottom">
            <span className="so-user">
              <Avatar /> <b>@yourname</b> <span className="so-pill light">Subscribe</span>
            </span>
            <p>Here is the description of your video</p>
          </div>
        </>
      )}
    </div>
  )
}
