// nk: #3 - Library header buttons for the date-added sort.
// Each button is a bare <button> so `.FormControl--segmented > button.active`
// styling applies (FormControl/index.css).
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowDown19,
  faArrowDown91,
  faCalendarDays as calendarSolid
} from '@fortawesome/free-solid-svg-icons'
import { faCalendarDays as calendarLight } from '@fortawesome/free-regular-svg-icons'
import { useLibrarySortPrefs } from './prefs'
import './sortButtons.css'

export function SortByDateAddedButton() {
  const { t } = useTranslation()
  const sortBy = useLibrarySortPrefs((s) => s.sortBy)
  const setSortBy = useLibrarySortPrefs((s) => s.setSortBy)
  const active = sortBy === 'dateAdded'

  return (
    <button
      className={classNames('FormControl__button', { active })}
      title={
        active
          ? t('library.sortByName', 'Sort by name')
          : t('library.sortByDateAdded', 'Sort by date added')
      }
      aria-pressed={active}
      onClick={() => setSortBy(active ? 'title' : 'dateAdded')}
    >
      <FontAwesomeIcon
        className="FormControl__segmentedFaIcon"
        icon={active ? calendarSolid : calendarLight}
        data-tour="library-sort-date-added"
      />
    </button>
  )
}

export function DateSortDirectionButton() {
  const { t } = useTranslation()
  const newestFirst = useLibrarySortPrefs((s) => s.dateNewestFirst)
  const setNewestFirst = useLibrarySortPrefs((s) => s.setDateNewestFirst)

  return (
    <button
      className="FormControl__button"
      title={
        newestFirst
          ? t('library.sortNewestFirst', 'Newest first')
          : t('library.sortOldestFirst', 'Oldest first')
      }
      onClick={() => setNewestFirst(!newestFirst)}
    >
      <FontAwesomeIcon
        className="FormControl__segmentedFaIcon"
        icon={newestFirst ? faArrowDown91 : faArrowDown19}
        data-tour="library-sort-az"
      />
    </button>
  )
}

/**
 * Rendered by ActionIcons right before the upstream A<->Z button, which is
 * hidden while date mode is on (the direction button takes its place).
 */
export function NkSortButtons() {
  const dateMode = useLibrarySortPrefs((s) => s.sortBy === 'dateAdded')
  return (
    <>
      <SortByDateAddedButton />
      {dateMode && <DateSortDirectionButton />}
    </>
  )
}
