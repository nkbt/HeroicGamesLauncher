import * as Misc from './misc'
import * as Helpers from './helpers'
import * as Library from './library'
import * as Menu from './menu'
import * as Settings from './settings'
import * as Wine from './wine'
import * as DownloadManager from './downloadmanager'
import * as Zoom from './zoom'
import * as Nk from './nk' // nk: #4

export default {
  ...Nk, // nk: #4 (first, so upstream entries win on a name clash)
  ...Misc,
  ...Helpers,
  ...Library,
  ...Menu,
  ...Settings,
  ...Wine,
  ...DownloadManager,
  ...Zoom
}
