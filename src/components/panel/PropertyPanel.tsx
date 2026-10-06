import { useAppStore, useSelectedProperty } from '../../store/useAppStore'
import ParcelDetail from './ParcelDetail'
import PortfolioList from './PortfolioList'
import PropertyDetail from './PropertyDetail'

export default function PropertyPanel() {
  const selected = useSelectedProperty()
  const parcel = useAppStore((s) => s.parcel)
  if (selected) return <PropertyDetail property={selected} />
  if (parcel.status !== 'idle') return <ParcelDetail lookup={parcel} />
  return <PortfolioList />
}
