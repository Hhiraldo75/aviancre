import { useSelectedProperty } from '../../store/useAppStore'
import PortfolioList from './PortfolioList'
import PropertyDetail from './PropertyDetail'

export default function PropertyPanel() {
  const selected = useSelectedProperty()
  return selected ? <PropertyDetail property={selected} /> : <PortfolioList />
}
