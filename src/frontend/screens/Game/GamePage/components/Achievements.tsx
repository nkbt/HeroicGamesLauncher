import { GameAchievement, Runner } from 'common/types' // nk: #5
import { useAchievementsState } from 'frontend/nk/gameDetails/hooks' // nk: #5
import { useMemo } from 'react'

interface Props {
  appName: string // nk: #5
  runner: Runner // nk: #5
}

const Achievements = ({ appName, runner }: Props) => {
  // nk: #5
  const [achievements] = useAchievementsState(runner, appName) // nk: #5
  const sortedAchievements = useMemo(() => {
    const unlocked = achievements
      .filter((x) => x.date_unlocked !== null)
      .sort(
        (a, b) =>
          new Date(b.date_unlocked || '').getTime() -
          new Date(a.date_unlocked || '').getTime()
      )
    const locked = achievements
      .filter((x) => x.date_unlocked === null)
      .sort((a, b) => b.rarity - a.rarity)

    return [...unlocked, ...locked]
  }, [achievements])

  return (
    <div className="achievement-container">
      {sortedAchievements.map((x: GameAchievement) => {
        const isHiddenAchievement = !x.date_unlocked && !x.visible
        return (
          <div
            className={`achievement-item ${x.date_unlocked ? 'unlocked' : 'locked'} ${isHiddenAchievement ? 'hidden-achievement' : ''}`}
            key={x.achievement_id}
          >
            <div className={`achievement-icon rarity-${x.rarity_level_slug}`}>
              <img
                src={
                  x.date_unlocked ? x.image_url_unlocked : x.image_url_locked
                }
                alt={isHiddenAchievement ? 'Hidden Achievement' : x.name}
              />
            </div>
            <div className="achievement-text">
              <span className="achievement-title">
                {isHiddenAchievement ? 'Hidden Achievement' : x.name}
              </span>
              <span className="achievement-desc">
                {isHiddenAchievement ? '' : x.description}
              </span>
              <span className="achievement-rarity">
                {x.rarity_level_description} · {x.rarity}%
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default Achievements
