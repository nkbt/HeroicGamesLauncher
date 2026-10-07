import React, { useEffect, useState } from 'react'
import classNames from 'classnames'
import { isImageLoaded, markImageLoaded } from 'frontend/nk/loadedImages' // nk: #4

interface CachedImageProps {
  src: string
  fallback?: string
  className?: string
  onLoad?: (e: React.SyntheticEvent<HTMLImageElement, Event>) => void
  onError?: (e: React.SyntheticEvent<HTMLImageElement, Event>) => void
}

type Props = React.ImgHTMLAttributes<HTMLImageElement> & CachedImageProps

const CachedImage = (props: Props) => {
  const [useCache, setUseCache] = useState(
    props.src?.startsWith('http') || false
  )
  const [loaded, setLoaded] = useState(() => isImageLoaded(props.src)) // nk: #4
  const [useFallback, setUseFallback] = useState(false)

  useEffect(() => {
    setLoaded(isImageLoaded(props.src)) // nk: #4 no fade replay
    setUseFallback(false)
    setUseCache(props.src?.startsWith('http') || false)
  }, [props.src])

  const onError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    // if not cached, tried with the real
    if (useCache) {
      setUseCache(false)
    } else {
      // if not cached and can't access real, try with the fallback
      if (props.fallback) {
        setUseFallback(true)
        setUseCache(props.fallback.startsWith('http'))
      }
    }
    props.onError?.(e)
  }

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    setLoaded(true)
    if (!useFallback) markImageLoaded(props.src) // nk: #4
    props.onLoad?.(e)
  }

  let src = useFallback ? props.fallback : props.src
  src = useCache && src ? `imagecache://${encodeURIComponent(src)}` : src

  return (
    <img
      loading="lazy"
      {...props}
      src={src}
      onLoad={handleLoad}
      onError={onError}
      className={classNames(props.className, {
        loaded,
        loading: !loaded
      })}
    />
  )
}

export default CachedImage
